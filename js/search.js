import { asFinite } from "./format.js";
import { clipText, isValidCA, safeImageUrl } from "./sanitize.js";

export const SEARCH_RESULT_LIMIT = 8;
export const MIN_NAME_QUERY = 2;

// Name search is DexScreener's public search, Solana pairs only.
// Pairs are folded to one row per base-token address. A row is ranked by
// USD liquidity multiplied by 24h volume, so a deep pool that nobody is
// trading sinks below a market with both. Liquidity, then volume, breaks
// a tie. Missing figures stay null, sort last, and are not shown as zero.
//
// Jupiter's token search is optional. It adds a verified or strict-list
// marker when it recognizes the mint, and it supplies rows only when
// DexScreener returns no Solana pair.

export function normalizeSearchQuery(raw) {
  if (typeof raw !== "string") return "";
  let text = raw.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  text = text.replace(/^\$+/, "").trim().replace(/\s+/g, " ");
  if (text.length > 32) text = text.slice(0, 32).trim();
  return text;
}

export function dexSearchUrl(query) {
  return `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
}

export function jupiterSearchUrl(query) {
  return `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(query)}`;
}

export function buildSearchResults(dexPayload, jupiterPayload) {
  const marks = jupiterMarks(jupiterPayload);
  const dexRows = rowsFromDex(dexPayload);
  if (dexRows.length) {
    return dexRows.slice(0, SEARCH_RESULT_LIMIT).map((row) => applyMark(row, marks.get(row.ca)));
  }
  return rowsFromJupiter(marks).slice(0, SEARCH_RESULT_LIMIT);
}

function rowsFromDex(payload) {
  const pairs = payload && Array.isArray(payload.pairs) ? payload.pairs : [];
  const grouped = new Map();
  for (const pair of pairs) {
    if (!pair || pair.chainId !== "solana" || !pair.baseToken) continue;
    const ca = pair.baseToken.address;
    if (!isValidCA(ca)) continue;
    const liquidityUsd = asFinite(pair.liquidity && pair.liquidity.usd);
    const volumeH24 = asFinite(pair.volume && pair.volume.h24);
    const candidate = {
      ca,
      name: clipText(pair.baseToken.name, 64),
      symbol: clipText(pair.baseToken.symbol, 16),
      priceUsd: asFinite(pair.priceUsd),
      marketCap: asFinite(pair.marketCap != null ? pair.marketCap : pair.fdv),
      liquidityUsd,
      volumeH24,
      image: safeImageUrl(pair.info && pair.info.imageUrl),
      verified: false,
      strict: false,
      source: "dex",
    };
    const prev = grouped.get(ca);
    if (!prev || compareDesc(candidate, prev) < 0) grouped.set(ca, candidate);
  }
  return [...grouped.values()].sort(compareDesc);
}

function compareDesc(a, b) {
  const score = rankScore(b) - rankScore(a);
  if (score !== 0) return score;
  const liq = rankNumber(b.liquidityUsd) - rankNumber(a.liquidityUsd);
  if (liq !== 0) return liq;
  return rankNumber(b.volumeH24) - rankNumber(a.volumeH24);
}

function rankScore(row) {
  if (row.liquidityUsd == null || row.volumeH24 == null) return -1;
  if (row.liquidityUsd < 0 || row.volumeH24 < 0) return -1;
  return row.liquidityUsd * row.volumeH24;
}

function rankNumber(value) {
  return value == null ? -1 : value;
}

function jupiterMarks(payload) {
  const list = Array.isArray(payload) ? payload : [];
  const marks = new Map();
  for (const token of list) {
    if (!token || typeof token !== "object") continue;
    const ca = typeof token.id === "string" ? token.id : "";
    if (!isValidCA(ca) || marks.has(ca)) continue;
    const tags = Array.isArray(token.tags) ? token.tags : [];
    const strict = tags.includes("strict");
    const verified = strict || token.isVerified === true || tags.includes("verified");
    marks.set(ca, {
      ca,
      name: clipText(token.name, 64),
      symbol: clipText(token.symbol, 16),
      priceUsd: asFinite(token.usdPrice),
      marketCap: asFinite(token.mcap),
      liquidityUsd: asFinite(token.liquidity),
      volumeH24: jupiterVolume(token.stats24h),
      image: safeImageUrl(token.icon),
      verified,
      strict,
    });
  }
  return marks;
}

function jupiterVolume(stats) {
  if (!stats || typeof stats !== "object") return null;
  const buy = asFinite(stats.buyVolume);
  const sell = asFinite(stats.sellVolume);
  if (buy == null && sell == null) return null;
  return (buy == null ? 0 : buy) + (sell == null ? 0 : sell);
}

function applyMark(row, mark) {
  if (!mark) return row;
  return { ...row, verified: mark.verified, strict: mark.strict };
}

function rowsFromJupiter(marks) {
  const rows = [];
  for (const mark of marks.values()) {
    rows.push({ ...mark, source: "jupiter" });
  }
  rows.sort(compareDesc);
  return rows;
}

export function markerLabel(result) {
  if (!result) return "";
  if (result.strict) return "Strict list";
  if (result.verified) return "Verified";
  return "";
}
