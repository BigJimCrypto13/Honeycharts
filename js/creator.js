import { asFinite, formatCompactUsd } from "./format.js";
import { isValidCA } from "./sanitize.js";

// A launched coin is a loss only when a figure actually exists.
// Missing prices, volumes, and liquidity are not treated as zero.
//
// Drawdown: DexScreener's 5-minute, 1-hour, 6-hour, or 24-hour change is
// below -90 (more than 90% down from the price at the start of that window).
// The same percent is applied to market cap only when price is missing or zero.
// There is no all-time peak in this feed. A coin that collapsed earlier than
// 24 hours, then went flat, does not get a drawdown from these windows.
//
// Liquidity removed: USD liquidity is under $100 and at least one reported
// volume or trade count is above zero.
//
// No trading: the pair is older than 24 hours, every volume and trade window
// that DexScreener did return is zero, and liquidity is under $100 or the
// price is zero.
//
// RugCheck's rugged flag counts only for a report that was actually loaded.

export const DRAWDOWN_PCT = 90;
export const DUST_LIQUIDITY_USD = 100;
export const NO_TRADE_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const SERIAL_MIN_LOSSES = 2;

const WINDOWS = ["m5", "h1", "h6", "h24"];
const WINDOW_LABEL = {
  m5: "5-minute",
  h1: "1-hour",
  h6: "6-hour",
  h24: "24-hour",
};

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export const SKIP_MINTS = new Set([WSOL, USDC, USDT, SYSTEM_PROGRAM]);

export const HEURISTIC_SUMMARY = "A coin counts as a loss only when the figures exist. A DexScreener price or market-cap change below -90% counts as down more than 90% from the start of that 5-minute, 1-hour, 6-hour, or 24-hour window. Liquidity under $100 counts as removed when volume or trades in those windows are above zero. A pair older than 24 hours counts as no trading when the returned volume and trade counts are zero and liquidity is under $100 or the price is zero. Missing figures stay as not enough data. They are not treated as zero.";

export function readRugcheckCreator(report) {
  if (!report || typeof report !== "object") return null;
  return pubkeyOf(report.creator);
}

export function firstSigner(tx) {
  const keys = accountKeys(tx);
  if (!keys) return null;
  for (const key of keys) {
    if (typeof key === "string") return isValidCA(key) ? key : null;
    if (key && typeof key === "object" && key.signer === true && isValidCA(key.pubkey)) {
      return key.pubkey;
    }
  }
  return null;
}

export function mintsInitializedBy(tx, wallet) {
  if (!isValidCA(wallet) || firstSigner(tx) !== wallet) return [];
  const found = [];
  const seen = new Set();
  for (const ix of instructionsOf(tx)) {
    const parsed = ix && ix.parsed;
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.type !== "initializeMint" && parsed.type !== "initializeMint2") continue;
    const info = parsed.info && typeof parsed.info === "object" ? parsed.info : null;
    const mint = pubkeyOf(info && (info.mint || info.mintAddress));
    if (!mint || mint === wallet || SKIP_MINTS.has(mint) || seen.has(mint)) continue;
    seen.add(mint);
    found.push(mint);
  }
  return found;
}

export function snapshotFromPair(pair, extras = {}) {
  const rugged = extras && extras.rugged === true ? true : null;
  if (!pair || typeof pair !== "object") {
    return {
      hasPair: false,
      priceUsd: null,
      priceChange: blankWindows(),
      marketCap: null,
      liquidityUsd: null,
      volume: blankWindows(),
      txns: blankWindows(),
      pairCreatedAt: null,
      rugged,
    };
  }
  const change = pair.priceChange && typeof pair.priceChange === "object" ? pair.priceChange : {};
  const volume = pair.volume && typeof pair.volume === "object" ? pair.volume : {};
  const txns = pair.txns && typeof pair.txns === "object" ? pair.txns : {};
  return {
    hasPair: true,
    priceUsd: asFinite(pair.priceUsd),
    priceChange: readWindows(change),
    marketCap: asFinite(pair.marketCap != null ? pair.marketCap : pair.fdv),
    liquidityUsd: asFinite(pair.liquidity && pair.liquidity.usd),
    volume: readWindows(volume),
    txns: readTxnWindows(txns),
    pairCreatedAt: asFinite(pair.pairCreatedAt),
    rugged,
  };
}

export function classifyLaunch(snapshot, now = Date.now()) {
  const data = snapshot && typeof snapshot === "object" ? snapshot : {};
  const price = asFinite(data.priceUsd);
  const changes = readWindows(data.priceChange);
  const marketCap = asFinite(data.marketCap);
  const liquidity = asFinite(data.liquidityUsd);
  const volume = readWindows(data.volume);
  const txns = readWindows(data.txns);
  const reasons = [];

  if (data.rugged === true) {
    reasons.push({ code: "rugged", text: "RugCheck marked this token rugged." });
  }

  const priceDrop = worstDrop(price, changes);
  if (priceDrop) {
    reasons.push({
      code: "drawdown",
      text: `Price is down ${formatDrop(priceDrop.pct)} from the start of the ${WINDOW_LABEL[priceDrop.window]} window DexScreener reported.`,
    });
  } else if (price == null || price === 0) {
    const capDrop = worstDrop(marketCap, changes);
    if (capDrop) {
      reasons.push({
        code: "drawdown",
        text: `Market cap is down ${formatDrop(capDrop.pct)} from the start of the ${WINDOW_LABEL[capDrop.window]} window DexScreener reported.`,
      });
    }
  }

  if (liquidity != null && liquidity < DUST_LIQUIDITY_USD && hasTradeEvidence(volume, txns)) {
    reasons.push({
      code: "liquidity",
      text: `Liquidity is ${formatCompactUsd(liquidity)} after DexScreener reported volume or trades.`,
    });
  }

  const created = asFinite(data.pairCreatedAt);
  const age = created == null || !Number.isFinite(now) ? null : now - created;
  const volumePresent = presentValues(volume);
  const txnPresent = presentValues(txns);
  const noVolume = volumePresent.length > 0 && volumePresent.every((value) => value === 0);
  const noTxns = txnPresent.length > 0 && txnPresent.every((value) => value === 0);
  const deadQuote = (liquidity != null && liquidity < DUST_LIQUIDITY_USD) || price === 0;
  if (
    data.hasPair === true
    && age != null
    && age >= NO_TRADE_MIN_AGE_MS
    && noVolume
    && noTxns
    && deadQuote
    && !hasTradeEvidence(volume, txns)
  ) {
    reasons.push({
      code: "no-trading",
      text: "This pair is older than 24 hours, the volume and trade counts DexScreener returned are zero, and liquidity is under $100 or the price is zero.",
    });
  }

  if (reasons.length) return { outcome: "loss", reasons };

  if (liquidity != null && liquidity >= DUST_LIQUIDITY_USD) {
    return {
      outcome: "alive",
      reasons: [{ code: "alive", text: "DexScreener reports at least $100 of liquidity and no loss figure." }],
    };
  }
  if (price != null && price > 0 && presentValues(changes).length > 0) {
    return {
      outcome: "alive",
      reasons: [{ code: "alive", text: "DexScreener's reported price change is not down more than 90%." }],
    };
  }
  return {
    outcome: "unknown",
    reasons: [{ code: "unknown", text: "not enough data" }],
  };
}

export function summarizeLaunches(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let losses = 0;
  let alive = 0;
  let unknown = 0;
  let drawdownLosses = 0;
  for (const row of list) {
    if (!row || row.outcome === "alive") {
      if (row && row.outcome === "alive") alive += 1;
      else unknown += 1;
      continue;
    }
    if (row.outcome === "loss") {
      losses += 1;
      if (Array.isArray(row.reasons) && row.reasons.some((reason) => reason && reason.code === "drawdown")) {
        drawdownLosses += 1;
      }
      continue;
    }
    unknown += 1;
  }
  const known = losses + alive;
  const summary = {
    losses,
    alive,
    unknown,
    known,
    drawdownLosses,
    serial: losses >= SERIAL_MIN_LOSSES,
    rows: list,
    penalty: 0,
    headline: "not enough data",
    unknownLine: "",
  };
  summary.penalty = serialRuggerPenalty(summary);
  summary.headline = historyHeadline(summary);
  summary.unknownLine = unknownLine(summary);
  return summary;
}

export function serialRuggerPenalty(summary) {
  if (!summary || summary.losses < SERIAL_MIN_LOSSES || summary.known < SERIAL_MIN_LOSSES) return 0;
  const extra = summary.losses - SERIAL_MIN_LOSSES;
  const rateBoost = Math.round((summary.losses / summary.known) * 10);
  return Math.min(30, 12 + extra * 4 + rateBoost);
}

export function historyHeadline(summary) {
  if (!summary || summary.known === 0) return "not enough data";
  if (summary.drawdownLosses === summary.losses) {
    return `${summary.losses} of ${summary.known} coins from this wallet lost over 90%`;
  }
  return `${summary.losses} of ${summary.known} coins from this wallet died or lost over 90%`;
}

export function unknownLine(summary) {
  if (!summary || summary.unknown <= 0 || summary.known === 0) return "";
  return `${summary.unknown} more: not enough data`;
}

export function creatorScoreFlags(summary) {
  if (!summary) return { penalty: 0, flags: [] };
  const penalty = serialRuggerPenalty(summary);
  if (summary.serial && penalty > 0) {
    const extra = summary.unknownLine ? ` ${summary.unknownLine}.` : "";
    return {
      penalty,
      flags: [{
        level: "danger",
        title: "Serial Rugger",
        detail: `${summary.headline}.${extra} Only coins with price, liquidity, or trading figures are counted.`,
        points: -penalty,
      }],
    };
  }
  if (summary.known === 0) {
    return {
      penalty: 0,
      flags: [{
        level: "info",
        title: "Creator history: not enough data",
        detail: "Losses are not counted unless price, liquidity, or trading figures are present.",
        points: 0,
      }],
    };
  }
  const extra = summary.unknownLine ? ` ${summary.unknownLine}.` : "";
  return {
    penalty: 0,
    flags: [{
      level: summary.losses > 0 ? "warn" : "info",
      title: "Creator launch history",
      detail: `${summary.headline}.${extra}`,
      points: 0,
    }],
  };
}

function worstDrop(current, changes) {
  let worst = null;
  for (const key of WINDOWS) {
    const change = changes[key];
    if (change == null || change < -100) continue;
    let pct = null;
    if (change < -DRAWDOWN_PCT) pct = Math.abs(change);
    else if (current != null && current > 0 && change > -100) {
      const past = current / (1 + change / 100);
      if (Number.isFinite(past) && past > current) pct = ((past - current) / past) * 100;
    }
    if (pct == null || pct <= DRAWDOWN_PCT) continue;
    if (!worst || pct > worst.pct) worst = { pct, window: key };
  }
  return worst;
}

function hasTradeEvidence(volume, txns) {
  return WINDOWS.some((key) => (
    (volume[key] != null && volume[key] > 0) || (txns[key] != null && txns[key] > 0)
  ));
}

function presentValues(windows) {
  const values = [];
  for (const key of WINDOWS) {
    if (windows[key] != null) values.push(windows[key]);
  }
  return values;
}

function blankWindows() {
  return { m5: null, h1: null, h6: null, h24: null };
}

function readWindows(source) {
  const out = blankWindows();
  if (!source || typeof source !== "object") return out;
  for (const key of WINDOWS) out[key] = asFinite(source[key]);
  return out;
}

function readTxnWindows(source) {
  const out = blankWindows();
  if (!source || typeof source !== "object") return out;
  for (const key of WINDOWS) {
    const row = source[key];
    if (typeof row === "number" || typeof row === "string") {
      out[key] = asFinite(row);
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const buys = asFinite(row.buys);
    const sells = asFinite(row.sells);
    if (buys == null && sells == null) continue;
    out[key] = (buys != null && buys > 0 ? buys : 0) + (sells != null && sells > 0 ? sells : 0);
  }
  return out;
}

function formatDrop(pct) {
  return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
}

function pubkeyOf(value) {
  if (typeof value === "string" && isValidCA(value.trim())) return value.trim();
  if (value && typeof value === "object" && typeof value.address === "string" && isValidCA(value.address.trim())) {
    return value.address.trim();
  }
  return null;
}

function accountKeys(tx) {
  const message = tx && tx.transaction && tx.transaction.message;
  const keys = message && message.accountKeys;
  return Array.isArray(keys) ? keys : null;
}

function instructionsOf(tx) {
  const list = [];
  const message = tx && tx.transaction && tx.transaction.message;
  const outer = message && message.instructions;
  if (Array.isArray(outer)) list.push(...outer);
  const inner = tx && tx.meta && tx.meta.innerInstructions;
  if (Array.isArray(inner)) {
    for (const group of inner) {
      const ixs = group && group.instructions;
      if (Array.isArray(ixs)) list.push(...ixs);
    }
  }
  return list;
}
