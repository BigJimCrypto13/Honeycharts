import { isValidCA, clipText, safeImageUrl } from "./sanitize.js";

const TOKEN_TTL = 20000;
const LIST_TTL = 60000;
const RUG_TTL = 180000;
const BATCH_SIZE = 30;
const FEED_LIMIT = 18;

const memory = new Map();
const inflight = new Map();

export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function batchUrl(cas) {
  const joined = cas.map((ca) => encodeURIComponent(ca)).join(",");
  return `https://api.dexscreener.com/tokens/v1/solana/${joined}`;
}

export function pickBestPair(pairs, ca) {
  const list = (Array.isArray(pairs) ? pairs : []).filter(
    (pair) => pair && pair.chainId === "solana" && pair.baseToken && pair.baseToken.address === ca,
  );
  list.sort((a, b) => (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0));
  return list[0] || null;
}

export async function fetchJson(url, { ttl = TOKEN_TTL, force = false, signal } = {}) {
  if (!force) {
    const hit = memory.get(url);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    const pending = inflight.get(url);
    if (pending) return pending;
  }

  const run = requestJson(url, signal);
  if (!force) inflight.set(url, run);
  try {
    const data = await run;
    memory.set(url, { at: Date.now(), data });
    return data;
  } finally {
    if (!force) inflight.delete(url);
  }
}

async function requestJson(url, signal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, 15000);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 429) throw new ApiError("rate", 429);
    if (!response.ok) throw new ApiError("http", response.status);
    try {
      return await response.json();
    } catch {
      throw new ApiError("parse", response.status);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError("network", 0);
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export async function fetchTokenDetail(ca, options = {}) {
  if (!isValidCA(ca)) throw new ApiError("http", 0);
  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`;
  const data = await fetchJson(url, { ttl: TOKEN_TTL, ...options });
  const pairs = data && Array.isArray(data.pairs) ? data.pairs : [];
  return pickBestPair(pairs, ca);
}

export async function fetchTokenPairs(cas, options = {}) {
  const unique = [];
  const seen = new Set();
  for (const ca of cas) {
    if (!isValidCA(ca) || seen.has(ca)) continue;
    seen.add(ca);
    unique.push(ca);
  }
  const out = new Map();
  for (let index = 0; index < unique.length; index += BATCH_SIZE) {
    const chunk = unique.slice(index, index + BATCH_SIZE);
    try {
      const data = await fetchJson(batchUrl(chunk), { ttl: TOKEN_TTL, ...options });
      const pairs = Array.isArray(data) ? data : [];
      const grouped = new Map();
      for (const pair of pairs) {
        const address = pair && pair.baseToken && pair.baseToken.address;
        if (!isValidCA(address)) continue;
        if (!grouped.has(address)) grouped.set(address, []);
        grouped.get(address).push(pair);
      }
      for (const ca of chunk) {
        out.set(ca, { pair: pickBestPair(grouped.get(ca) || [], ca), error: null });
      }
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      for (const ca of chunk) out.set(ca, { pair: null, error });
    }
  }
  return out;
}

export async function fetchRugcheck(ca, options = {}) {
  if (!isValidCA(ca)) throw new ApiError("http", 0);
  const url = `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(ca)}/report`;
  const data = await fetchJson(url, { ttl: RUG_TTL, ...options });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError("parse", 200);
  if (typeof data.mint === "string" && data.mint !== ca) throw new ApiError("mismatch", 200);
  return data;
}

function clampPage(page) {
  const number = Number(page);
  if (!Number.isInteger(number) || number < 1 || number > 10) return 1;
  return number;
}

export function geckoPoolsUrl(kind, page = 1) {
  const slug = kind === "new" ? "new_pools" : "trending_pools";
  return `https://api.geckoterminal.com/api/v2/networks/solana/${slug}?include=base_token,quote_token&page=${clampPage(page)}`;
}

const DEX_SLUGS = new Set(["pump-fun", "pumpswap"]);

export function geckoDexPoolsUrl(dex, page = 1, sort = "") {
  if (!DEX_SLUGS.has(dex)) return "";
  const base = `https://api.geckoterminal.com/api/v2/networks/solana/dexes/${dex}/pools?include=base_token,quote_token&page=${clampPage(page)}`;
  if (sort === "h24_volume_usd_desc") return `${base}&sort=h24_volume_usd_desc`;
  return base;
}

export function jupiterBoardUrl(kind) {
  if (kind === "recent") return "https://api.jup.ag/tokens/v2/recent?limit=30";
  if (kind === "traded") return "https://api.jup.ag/tokens/v2/toptraded/24h?limit=50";
  return "https://api.jup.ag/tokens/v2/toptrending/1h?limit=50";
}

export function jupiterFallbackUrl(kind) {
  return jupiterBoardUrl(kind).replace("https://api.jup.ag/", "https://lite-api.jup.ag/");
}

export function geckoTokenInfoUrl(ca) {
  return `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(ca)}/info`;
}

export function geckoTokenPoolsUrl(ca) {
  return `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(ca)}/pools?page=1`;
}

export function geckoOhlcvUrl(pool) {
  if (typeof pool !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(pool)) return "";
  return `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=60&currency=usd`;
}

function withoutPage(options) {
  const rest = { ...options };
  delete rest.page;
  delete rest.sort;
  return rest;
}

export async function fetchGeckoPools(kind, options = {}) {
  const data = await fetchJson(geckoPoolsUrl(kind, options.page), { ttl: 15000, ...withoutPage(options) });
  if (!data || typeof data !== "object" || Array.isArray(data)) return { data: [], included: [] };
  return data;
}

export async function fetchGeckoDexPools(dex, options = {}) {
  const url = geckoDexPoolsUrl(dex, options.page, options.sort || "");
  if (!url) return { data: [], included: [] };
  try {
    const data = await fetchJson(url, { ttl: 15000, ...withoutPage(options) });
    if (!data || typeof data !== "object" || Array.isArray(data)) return { data: [], included: [] };
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    return { data: [], included: [] };
  }
}

export async function fetchJupiterBoard(kind, options = {}) {
  try {
    const data = await fetchJson(jupiterBoardUrl(kind), { ttl: 12000, ...options });
    if (Array.isArray(data)) return data;
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
  }
  const data = await fetchJson(jupiterFallbackUrl(kind), { ttl: 12000, ...options });
  return Array.isArray(data) ? data : [];
}

export async function fetchLatestProfiles(options = {}) {
  try {
    const data = await fetchJson("https://api.dexscreener.com/token-profiles/latest/v1", { ttl: 20000, ...options });
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const entry of data) {
      if (!entry || entry.chainId !== "solana" || !isValidCA(entry.tokenAddress)) continue;
      out.push({
        ca: entry.tokenAddress,
        icon: typeof entry.icon === "string" ? entry.icon : "",
      });
    }
    return out;
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    return [];
  }
}

export async function fetchSolanaFeed(kind, options = {}) {
  const url = kind === "boosts"
    ? "https://api.dexscreener.com/token-boosts/top/v1"
    : "https://api.dexscreener.com/token-profiles/latest/v1";
  const data = await fetchJson(url, { ttl: LIST_TTL, ...options });
  if (!Array.isArray(data)) return { items: [], total: 0 };
  const items = [];
  const seen = new Set();
  for (const entry of data) {
    if (!entry || entry.chainId !== "solana" || !isValidCA(entry.tokenAddress)) continue;
    if (seen.has(entry.tokenAddress)) continue;
    seen.add(entry.tokenAddress);
    const amount = Number(entry.totalAmount);
    items.push({
      ca: entry.tokenAddress,
      description: clipText(entry.description, 160),
      icon: safeImageUrl(entry.icon),
      boosted: kind === "boosts",
      amount: Number.isFinite(amount) && amount >= 0 && amount < 1e9 ? amount : null,
    });
  }
  return { items: items.slice(0, FEED_LIMIT), total: items.length };
}

export function clearApiCache() {
  memory.clear();
  inflight.clear();
}
