import { clipText } from "./sanitize.js";
import { formatCompactUsd, asFinite } from "./format.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function bandKey(score, incomplete) {
  if (incomplete) return "incomplete";
  if (score >= 80) return "high";
  if (score >= 50) return "mid";
  return "low";
}

export function bandCopy(score, incomplete) {
  if (incomplete) {
    return {
      band: "Incomplete",
      summary: "RugCheck did not load, so this number leaves out mint, freeze, LP, and holder checks.",
    };
  }
  if (score >= 80) {
    return {
      band: "Fewer flags",
      summary: "Fewer of the flags we check showed up. That is not a safety rating.",
    };
  }
  if (score >= 50) {
    return {
      band: "Mixed flags",
      summary: "Some flags we check showed up. Read them before you do anything else.",
    };
  }
  return {
    band: "Many flags",
    summary: "Several flags we check showed up. This is not a verdict, and it can still be wrong.",
  };
}

export function meterStep(score) {
  return Math.max(0, Math.min(100, Math.round(score / 5) * 5));
}

export function buildHoneyScore(pair, report, options = {}) {
  const reportError = options.reportError || null;
  const incomplete = !report || Boolean(reportError);
  const flags = [];
  let penalty = 0;
  let rugged = false;

  if (incomplete) {
    flags.push({
      level: "warn",
      title: "RugCheck report did not load",
      detail: reportErrorDetail(reportError),
      points: 0,
    });
  } else {
    const authorities = authorityFlags(report);
    flags.push(...authorities.flags);
    penalty += authorities.penalty;

    const lp = lpFlags(report);
    flags.push(lp.flag);
    penalty += lp.penalty;

    const holders = holderFlags(report);
    flags.push(...holders.flags);
    penalty += holders.penalty;

    const fee = transferFeeFlag(report);
    if (fee) {
      flags.push(fee.flag);
      penalty += fee.penalty;
    }

    const risks = riskFlags(report.risks);
    flags.push(...risks.flags);
    penalty += risks.penalty;

    rugged = report.rugged === true;
    if (rugged) {
      flags.push({
        level: "danger",
        title: "RugCheck marked this token as rugged",
        detail: "Verify that independently. The Honey Score is capped because of this flag.",
        points: 0,
      });
    }
  }

  const market = marketFlags(pair);
  flags.push(...market.flags);
  penalty += market.penalty;

  let score = (incomplete ? 55 : 100) - penalty;
  if (rugged) score = Math.min(score, 8);
  if (incomplete) score = Math.min(score, 55);
  score = clamp(score);

  const rugcheckIndex = !incomplete ? normalisedIndex(report.score_normalised) : null;
  const copy = bandCopy(score, incomplete);
  return {
    score,
    incomplete,
    rugged,
    band: copy.band,
    summary: copy.summary,
    flags,
    rugcheckIndex,
  };
}

function reportErrorDetail(code) {
  if (code === "rate") {
    return "RugCheck rate-limited the request. Mint, freeze, LP, and holder checks are missing, so the number is capped at 55.";
  }
  if (code === "mismatch") {
    return "The RugCheck response did not match this contract address, so it was ignored. The number is capped at 55.";
  }
  return "Mint authority, freeze authority, LP lock, and holder checks are missing. The number is capped at 55 and is incomplete.";
}

function authorityFlags(report) {
  const flags = [];
  let penalty = 0;
  const mint = readAuthority(report, "mintAuthority");
  const freeze = readAuthority(report, "freezeAuthority");
  if (mint === "active") {
    penalty += 25;
    flags.push({
      level: "danger",
      title: "Mint authority is active",
      detail: "Whoever holds it can create more tokens.",
      points: -25,
    });
  } else if (mint === "unknown") {
    penalty += 8;
    flags.push({
      level: "warn",
      title: "Mint authority was not reported",
      detail: "RugCheck did not say whether new tokens can still be minted.",
      points: -8,
    });
  } else {
    flags.push({
      level: "info",
      title: "Mint authority looks revoked",
      detail: "RugCheck reports no active mint authority. Confirm it on chain if this matters to you.",
      points: 0,
    });
  }
  if (freeze === "active") {
    penalty += 20;
    flags.push({
      level: "danger",
      title: "Freeze authority is active",
      detail: "Whoever holds it may be able to freeze token accounts.",
      points: -20,
    });
  } else if (freeze === "unknown") {
    penalty += 8;
    flags.push({
      level: "warn",
      title: "Freeze authority was not reported",
      detail: "RugCheck did not say whether accounts can still be frozen.",
      points: -8,
    });
  } else {
    flags.push({
      level: "info",
      title: "Freeze authority looks revoked",
      detail: "RugCheck reports no active freeze authority. Confirm it on chain if this matters to you.",
      points: 0,
    });
  }
  return { flags, penalty };
}

function readAuthority(report, key) {
  const top = report[key];
  const token = report.token && typeof report.token === "object" ? report.token : null;
  const nested = token ? token[key] : undefined;
  if (authorityActive(top) || authorityActive(nested)) return "active";
  if (top === null || nested === null) return "revoked";
  return "unknown";
}

function authorityActive(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== SYSTEM_PROGRAM;
  }
  if (typeof value === "object") {
    if (typeof value.address === "string") return authorityActive(value.address);
    return Object.keys(value).length > 0;
  }
  return false;
}

function lpFlags(report) {
  const rows = lpMarkets(report);
  const lockedUsd = lockerUsd(report);
  const lockerNote = lockedUsd > 0
    ? ` RugCheck also lists lockers totaling about ${formatCompactUsd(lockedUsd)}.`
    : "";

  if (!rows.length) {
    return {
      penalty: 8,
      flag: {
        level: "warn",
        title: "LP lock status is unclear",
        detail: `RugCheck did not report a standard LP token we could score. Some concentrated-liquidity pools look like this, so this is not proof that liquidity is unlocked.${lockerNote}`,
        points: -8,
      },
    };
  }

  let weight = 0;
  let weighted = 0;
  let deepest = rows[0];
  for (const row of rows) {
    if (row.usd > deepest.usd) deepest = row;
    if (row.usd > 0) {
      weight += row.usd;
      weighted += row.pct * row.usd;
    }
  }
  const avg = weight > 0
    ? weighted / weight
    : rows.reduce((sum, row) => sum + row.pct, 0) / rows.length;
  const detail = `The deepest standard LP pool in the RugCheck report shows ${formatPctPlain(deepest.pct)} locked or burned (${formatCompactUsd(deepest.usd)}). The liquidity-weighted average across standard LP pools is ${formatPctPlain(avg)}.${lockerNote}`;

  let status = "unlocked";
  if ((deepest.pct >= 95 && avg >= 50) || avg >= 80) status = "locked";
  else if (deepest.pct >= 50 || avg >= 40) status = "partial";

  const table = {
    locked: { penalty: 0, level: "info", title: "Deepest standard LP pool looks locked or burned" },
    partial: { penalty: 10, level: "warn", title: "LP lock is only partial" },
    unlocked: { penalty: 20, level: "danger", title: "LP does not look locked or burned" },
  };
  const picked = table[status];
  return {
    penalty: picked.penalty,
    flag: {
      level: picked.level,
      title: picked.title,
      detail: status === "unlocked"
        ? `${detail} Unlocked liquidity can be pulled. RugCheck can miss some pool types.`
        : detail,
      points: -picked.penalty,
    },
  };
}

function lpMarkets(report) {
  const markets = Array.isArray(report.markets) ? report.markets : [];
  const rows = [];
  for (const market of markets) {
    if (!market || typeof market !== "object") continue;
    const lp = market.lp;
    if (!lp || typeof lp !== "object") continue;
    const mint = typeof lp.lpMint === "string" ? lp.lpMint : "";
    if (!mint || mint === SYSTEM_PROGRAM) continue;
    const supply = asFinite(lp.lpTotalSupply);
    const pct = asFinite(lp.lpLockedPct);
    if (supply == null || supply <= 0 || pct == null || pct < 0 || pct > 100) continue;
    const usd = Math.max(0, asFinite(lp.baseUSD) || 0) + Math.max(0, asFinite(lp.quoteUSD) || 0);
    rows.push({ pct, usd });
  }
  return rows;
}

function lockerUsd(report) {
  const lockers = report.lockers;
  if (!lockers || typeof lockers !== "object" || Array.isArray(lockers)) return 0;
  let total = 0;
  for (const value of Object.values(lockers)) {
    if (!value || typeof value !== "object") continue;
    const amount = asFinite(value.usdcLocked);
    if (amount != null && amount > 0) total += amount;
  }
  return total;
}

function holderFlags(report) {
  const holders = Array.isArray(report.topHolders) ? report.topHolders : [];
  const pcts = holders
    .map((holder) => asPercent(holder && holder.pct))
    .filter((pct) => pct != null)
    .sort((a, b) => b - a);
  if (!pcts.length) {
    return {
      penalty: 5,
      flags: [{
        level: "warn",
        title: "Top holders were not listed",
        detail: "RugCheck did not return a holder list we could read.",
        points: -5,
      }],
    };
  }
  const top = pcts[0];
  const top10 = pcts.slice(0, 10).reduce((sum, pct) => sum + pct, 0);
  if (top10 > 100.5) {
    return {
      penalty: 5,
      flags: [{
        level: "warn",
        title: "Holder percentages look inconsistent",
        detail: "The holder list added up to more than the supply, so it was not scored.",
        points: -5,
      }],
    };
  }
  const count = asFinite(report.totalHolders);
  const countNote = count != null && count >= 0 && count < 1e12
    ? ` Reported holder count: ${Math.round(count).toLocaleString("en-US")}.`
    : "";
  const flags = [];
  let penalty = 0;
  if (top >= 40) {
    penalty += 15;
    flags.push({
      level: "danger",
      title: "One wallet holds a large share of supply",
      detail: `The largest listed holder has about ${formatPctPlain(top)} of supply.${countNote}`,
      points: -15,
    });
  } else if (top >= 20) {
    penalty += 10;
    flags.push({
      level: "warn",
      title: "One wallet holds over 20% of supply",
      detail: `The largest listed holder has about ${formatPctPlain(top)} of supply.${countNote}`,
      points: -10,
    });
  }
  if (top10 >= 70) {
    penalty += 10;
    flags.push({
      level: "danger",
      title: "Top wallets hold most of the supply",
      detail: `The top 10 listed holders combine to about ${formatPctPlain(top10)}. Pools and exchanges can appear in this list.`,
      points: -10,
    });
  } else if (top10 >= 50) {
    penalty += 8;
    flags.push({
      level: "warn",
      title: "Top wallets hold over half of supply",
      detail: `The top 10 listed holders combine to about ${formatPctPlain(top10)}. Pools and exchanges can appear in this list.`,
      points: -8,
    });
  }
  if (top < 20 && top10 < 50) {
    flags.push({
      level: "info",
      title: "Listed holder concentration is not extreme",
      detail: `The largest listed holder has about ${formatPctPlain(top)}. The top 10 combine to about ${formatPctPlain(top10)}. Pools and exchanges can appear in this list.${countNote}`,
      points: 0,
    });
  }
  return { flags, penalty };
}

function asPercent(value) {
  const number = asFinite(value);
  if (number == null || number < 0 || number > 100) return null;
  return number;
}

function transferFeeFlag(report) {
  const fee = report.transferFee;
  if (!fee || typeof fee !== "object") return null;
  const pct = asFinite(fee.pct);
  if (pct == null || pct <= 0 || pct > 100) return null;
  if (pct > 5) {
    return {
      penalty: 10,
      flag: {
        level: "danger",
        title: "Transfer fee is above 5%",
        detail: `RugCheck reports a transfer fee of about ${formatPctPlain(pct)}.`,
        points: -10,
      },
    };
  }
  return {
    penalty: 5,
    flag: {
      level: "warn",
      title: "Token has a transfer fee",
      detail: `RugCheck reports a transfer fee of about ${formatPctPlain(pct)}.`,
      points: -5,
    },
  };
}

function riskFlags(risks) {
  const list = Array.isArray(risks) ? risks : [];
  const flags = [];
  let penalty = 0;
  let dangerSeen = 0;
  let warnSeen = 0;
  let displayed = 0;
  let omitted = 0;
  for (const risk of list) {
    if (!risk || typeof risk !== "object") continue;
    const level = normalizeLevel(risk.level);
    let points = 0;
    if (level === "danger" && dangerSeen < 3) {
      points = -8;
      dangerSeen += 1;
    } else if (level === "warn" && warnSeen < 3) {
      points = -4;
      warnSeen += 1;
    }
    const title = clipText(risk.name, 80);
    const detail = clipText(risk.description, 220);
    if (!title && !detail) continue;
    penalty += -points;
    if (displayed >= 8) {
      omitted += 1;
      continue;
    }
    flags.push({
      level,
      title: title || "RugCheck flag",
      detail: detail || "RugCheck included this flag without a description.",
      points,
    });
    displayed += 1;
  }
  if (omitted > 0) {
    flags.push({
      level: "info",
      title: `${omitted} more RugCheck flags are not listed here`,
      detail: "Open the RugCheck report for the rest. Extra flags past the first warnings are not given more points.",
      points: 0,
    });
  }
  return { flags, penalty };
}

function normalizeLevel(level) {
  const value = String(level || "").toLowerCase();
  if (value === "danger" || value === "critical" || value === "error") return "danger";
  if (value === "warn" || value === "warning") return "warn";
  return "info";
}

function marketFlags(pair) {
  const flags = [];
  let penalty = 0;
  if (!pair) {
    penalty += 10;
    flags.push({
      level: "warn",
      title: "No Solana pair data",
      detail: "DexScreener did not return a pair where this address is the base token.",
      points: -10,
    });
    return { flags, penalty };
  }

  const liquidity = asFinite(pair.liquidity && pair.liquidity.usd);
  if (liquidity == null) {
    penalty += 8;
    flags.push({
      level: "warn",
      title: "Liquidity figure is missing",
      detail: "DexScreener did not report USD liquidity for the deepest pair.",
      points: -8,
    });
  } else if (liquidity < 5000) {
    penalty += 20;
    flags.push({
      level: "danger",
      title: "Liquidity is very thin",
      detail: `The deepest pair shows about ${formatCompactUsd(liquidity)}. A small trade can move the price a lot, and liquidity can disappear.`,
      points: -20,
    });
  } else if (liquidity < 25000) {
    penalty += 10;
    flags.push({
      level: "warn",
      title: "Liquidity is modest",
      detail: `The deepest pair shows about ${formatCompactUsd(liquidity)}. That can still be pulled or moved by a larger trade.`,
      points: -10,
    });
  } else {
    flags.push({
      level: "info",
      title: "Liquidity is above $25,000 on the deepest pair",
      detail: `DexScreener reports about ${formatCompactUsd(liquidity)} on that pair. Liquidity is not a promise that it stays.`,
      points: 0,
    });
  }

  const age = pairAgeMs(pair);
  if (age == null) {
    penalty += 5;
    flags.push({
      level: "warn",
      title: "Pair age is missing",
      detail: "DexScreener did not report when this pair was created.",
      points: -5,
    });
  } else if (age < 60 * 60 * 1000) {
    penalty += 15;
    flags.push({
      level: "danger",
      title: "This pair is less than an hour old",
      detail: "New pairs have very little history. Age is not proof either way.",
      points: -15,
    });
  } else if (age < 24 * 60 * 60 * 1000) {
    penalty += 10;
    flags.push({
      level: "warn",
      title: "This pair is less than a day old",
      detail: "There is not much trading history yet.",
      points: -10,
    });
  } else if (age < 7 * 24 * 60 * 60 * 1000) {
    penalty += 5;
    flags.push({
      level: "warn",
      title: "This pair is less than a week old",
      detail: "A week of trading is still a short record.",
      points: -5,
    });
  } else {
    flags.push({
      level: "info",
      title: "This pair has been trading for a while",
      detail: "An older pair is not proof of anything. It only means the market is not brand new.",
      points: 0,
    });
  }
  return { flags, penalty };
}

function pairAgeMs(pair) {
  const created = asFinite(pair.pairCreatedAt);
  if (created == null || created <= 0) return null;
  const age = Date.now() - created;
  if (age < -5 * 60 * 1000) return null;
  return Math.max(0, age);
}

function normalisedIndex(value) {
  const number = asFinite(value);
  if (number == null || number < 0 || number > 100) return null;
  return Math.round(number);
}

function formatPctPlain(value) {
  return `${value.toFixed(1)}%`;
}

function clamp(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}
