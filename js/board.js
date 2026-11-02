// Public-list shaping for the home board and the token About card.
// Numbers stay null when a feed omits them. Nothing here is treated as zero.

import { asFinite } from "./format.js";
import { clipText, isValidCA, safeHttpUrl } from "./sanitize.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const BTC_MINT = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
export const ETH_MINT = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";

export const QUOTE_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);
export const GRADUATED_LIQUIDITY = 50000;
export const WINDOW_IDS = ["m5", "h1", "h6", "h24"];

// Public pair feeds publish 5m, 1h, 6h, and 24h. They do not publish 4h or 12h.
export const BOARD_WINDOWS = [
  { id: "m5", label: "5m", title: "5 minute change" },
  { id: "h1", label: "1h", title: "1 hour change" },
  { id: "h6", label: "6h", title: "6 hour change. Public feeds do not publish a 4 hour or 12 hour window." },
  { id: "h24", label: "24h", title: "24 hour change" },
];

const JUPITER_WINDOWS = [
  ["m5", "stats5m"],
  ["h1", "stats1h"],
  ["h6", "stats6h"],
  ["h24", "stats24h"],
];

export function emptyWindows() {
  return { m5: null, h1: null, h6: null, h24: null };
}

export function emptyTxns() {
  const blank = () => ({
    buys: null,
    sells: null,
    buyers: null,
    sellers: null,
    buyVolume: null,
    sellVolume: null,
  });
  return { m5: blank(), h1: blank(), h6: blank(), h24: blank() };
}

export function parseGeckoPools(payload) {
  const included = new Map();
  const list = payload && Array.isArray(payload.included) ? payload.included : [];
  for (const item of list) {
    if (item && typeof item.id === "string") included.set(item.id, item.attributes || {});
  }
  const pools = payload && Array.isArray(payload.data) ? payload.data : [];
  const rows = [];
  const seen = new Set();
  for (const pool of pools) {
    const row = rowFromGeckoPool(pool, included);
    if (!row || seen.has(row.ca)) continue;
    seen.add(row.ca);
    rows.push(row);
  }
  return rows;
}

export function parseJupiterTokens(payload) {
  const list = Array.isArray(payload) ? payload : [];
  const rows = [];
  const seen = new Set();
  for (const token of list) {
    const row = rowFromJupiter(token);
    if (!row || seen.has(row.ca)) continue;
    seen.add(row.ca);
    rows.push(row);
  }
  return rows;
}

export function withRank(rows, field, offset = 0) {
  return rows.map((row, index) => {
    const next = cloneRow(row);
    next[field] = offset + index;
    return next;
  });
}

export function mergeCoinRows(groups) {
  const map = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const row of group) {
      if (!row || !isValidCA(row.ca) || QUOTE_MINTS.has(row.ca)) continue;
      const prev = map.get(row.ca);
      map.set(row.ca, prev ? fillRow(prev, row) : cloneRow(row));
    }
  }
  return [...map.values()];
}

export function overlayDexPair(row, pair) {
  const next = cloneRow(row);
  if (!pair || typeof pair !== "object") return next;
  const price = asFinite(pair.priceUsd);
  if (price != null && price >= 0) next.priceUsd = price;
  const mcap = asFinite(pair.marketCap != null ? pair.marketCap : pair.fdv);
  if (mcap != null && mcap >= 0) next.marketCap = mcap;
  const liq = asFinite(pair.liquidity && pair.liquidity.usd);
  if (liq != null && liq >= 0) next.liquidity = liq;
  const created = asFinite(pair.pairCreatedAt);
  if (created != null && created > 0) next.createdAt = created;
  const image = pair.info && pair.info.imageUrl;
  if (typeof image === "string" && image) next.image = image;
  const name = pair.baseToken && pair.baseToken.name;
  const symbol = pair.baseToken && pair.baseToken.symbol;
  if (typeof name === "string" && name.trim()) next.name = clipText(name, 64);
  if (typeof symbol === "string" && symbol.trim()) next.symbol = clipText(symbol, 16);
  if (typeof pair.dexId === "string" && pair.dexId) next.dex = clipText(pair.dexId, 32);
  const change = pair.priceChange && typeof pair.priceChange === "object" ? pair.priceChange : {};
  const volume = pair.volume && typeof pair.volume === "object" ? pair.volume : {};
  const txns = pair.txns && typeof pair.txns === "object" ? pair.txns : {};
  for (const id of WINDOW_IDS) {
    const pct = asFinite(change[id]);
    if (pct != null) next.change[id] = pct;
    const vol = nonNegative(volume[id]);
    if (vol != null) next.volume[id] = vol;
    const bucket = txns[id] && typeof txns[id] === "object" ? txns[id] : null;
    if (!bucket) continue;
    const buys = nonNegative(bucket.buys);
    const sells = nonNegative(bucket.sells);
    if (buys != null) next.txns[id].buys = buys;
    if (sells != null) next.txns[id].sells = sells;
  }
  return next;
}

export function applyDexMap(rows, fetched) {
  if (!fetched || typeof fetched.get !== "function") return rows.map(cloneRow);
  return rows.map((row) => {
    const entry = fetched.get(row.ca);
    if (!entry || !entry.pair) return cloneRow(row);
    return overlayDexPair(row, entry.pair);
  });
}

export function ensureHiveRows(rows, hiveTokens, fetched) {
  const have = new Set(rows.map((row) => row.ca));
  const extra = [];
  const list = Array.isArray(hiveTokens) ? hiveTokens : [];
  for (const token of list) {
    if (!token || !isValidCA(token.ca) || have.has(token.ca) || QUOTE_MINTS.has(token.ca)) continue;
    const entry = fetched && typeof fetched.get === "function" ? fetched.get(token.ca) : null;
    const shell = blankRow(token.ca);
    shell.name = clipText(token.name || "", 64);
    shell.symbol = clipText(token.symbol || "", 16);
    extra.push(entry && entry.pair ? overlayDexPair(shell, entry.pair) : shell);
    have.add(token.ca);
  }
  return rows.concat(extra);
}

export function readMajors(fetched) {
  const read = (ca) => {
    const entry = fetched && typeof fetched.get === "function" ? fetched.get(ca) : null;
    const pair = entry && entry.pair;
    if (!pair) return null;
    const price = asFinite(pair.priceUsd);
    if (price == null || price < 0) return null;
    return {
      price,
      change: asFinite(pair.priceChange && pair.priceChange.h24),
    };
  };
  return { sol: read(SOL_MINT), btc: read(BTC_MINT), eth: read(ETH_MINT) };
}

export function effectiveSort(filter, sortKey, sortDir) {
  if (sortKey && sortKey !== "default") {
    return { key: sortKey, dir: sortDir === "asc" ? "asc" : "desc" };
  }
  if (filter === "held") return { key: "holders", dir: "desc" };
  if (filter === "new") return { key: "age", dir: "desc" };
  if (filter === "graduated") return { key: "liq", dir: "desc" };
  if (filter === "hive") return { key: "hive", dir: "asc" };
  return { key: "rank", dir: "asc" };
}

export function selectTable(rows, options = {}) {
  const filter = options.filter || "trending";
  const windowId = WINDOW_IDS.includes(options.windowId) ? options.windowId : "h24";
  const hiveOrder = Array.isArray(options.hiveOrder) ? options.hiveOrder : [];
  const hiveIndex = new Map(hiveOrder.map((ca, index) => [ca, index]));
  const sort = effectiveSort(filter, options.sortKey, options.sortDir);
  let list = Array.isArray(rows) ? rows.filter((row) => row && isValidCA(row.ca)) : [];
  if (filter === "trending") list = list.filter((row) => row.trendingRank != null);
  else if (filter === "held") list = list.filter((row) => row.holders != null);
  else if (filter === "new") list = list.filter((row) => row.newRank != null);
  else if (filter === "graduated") list = list.filter((row) => (row.liquidity || 0) >= GRADUATED_LIQUIDITY);
  else if (filter === "hive") list = list.filter((row) => hiveIndex.has(row.ca));
  list.sort((a, b) => compareRows(a, b, sort, windowId, hiveIndex));
  const limit = Number.isFinite(options.limit) ? options.limit : 18;
  return list.slice(0, Math.max(0, limit));
}

export function topMovers(rows, windowId, limit = 12) {
  const id = WINDOW_IDS.includes(windowId) ? windowId : "h24";
  const list = (Array.isArray(rows) ? rows : []).filter((row) => {
    const change = row && row.change && row.change[id];
    return typeof change === "number" && Number.isFinite(change);
  });
  list.sort((a, b) => Math.abs(b.change[id]) - Math.abs(a.change[id]));
  return list.slice(0, limit);
}

export function splitStep(part, other) {
  if (typeof part !== "number" || typeof other !== "number") return null;
  if (!Number.isFinite(part) || !Number.isFinite(other)) return null;
  if (part < 0 || other < 0) return null;
  const total = part + other;
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((part / total) * 20) * 5));
}

export function buildTokenAbout({ geckoInfo, geckoPool, jupiterToken, pair } = {}) {
  const info = geckoInfo && geckoInfo.data && geckoInfo.data.attributes ? geckoInfo.data.attributes : {};
  const token = jupiterToken && isValidCA(jupiterToken.id) ? jupiterToken : null;
  const pool = geckoPool && geckoPool.attributes ? geckoPool : null;
  const poolTx = pool && pool.attributes && pool.attributes.transactions ? pool.attributes.transactions : {};
  const description = clipText(typeof info.description === "string" ? info.description : "", 360);
  const links = aboutLinks(info, pair);
  const windows = {};
  for (const id of WINDOW_IDS) {
    const jup = token && token[jupKey(id)] && typeof token[jupKey(id)] === "object" ? token[jupKey(id)] : {};
    const gt = poolTx[id] && typeof poolTx[id] === "object" ? poolTx[id] : {};
    const dexTx = pair && pair.txns && pair.txns[id] && typeof pair.txns[id] === "object" ? pair.txns[id] : {};
    const dexVol = pair && pair.volume ? nonNegative(pair.volume[id]) : null;
    const dexChange = pair && pair.priceChange ? asFinite(pair.priceChange[id]) : null;
    windows[id] = {
      change: dexChange != null ? dexChange : asFinite(jup.priceChange),
      buys: firstCount(dexTx.buys, jup.numBuys),
      sells: firstCount(dexTx.sells, jup.numSells),
      buyers: firstCount(gt.buyers),
      sellers: firstCount(gt.sellers),
      buyVolume: nonNegative(jup.buyVolume),
      sellVolume: nonNegative(jup.sellVolume),
      volume: dexVol != null ? dexVol : sumVolumes(jup.buyVolume, jup.sellVolume),
    };
  }
  return { description, links, windows };
}

export function pickGeckoPool(payload) {
  const pools = payload && Array.isArray(payload.data) ? payload.data : [];
  let best = null;
  let bestLiq = -1;
  for (const pool of pools) {
    const liq = nonNegative(pool && pool.attributes && pool.attributes.reserve_in_usd);
    if (liq == null || liq < bestLiq) continue;
    best = pool;
    bestLiq = liq;
  }
  return best;
}

export function pickJupiterToken(payload, ca) {
  const list = Array.isArray(payload) ? payload : [];
  return list.find((token) => token && token.id === ca) || null;
}

export function xSearchUrl(symbol, ca) {
  const ticker = clipText(typeof symbol === "string" ? symbol : "", 16);
  const query = ticker ? `$${ticker}` : ca;
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

function aboutLinks(info, pair) {
  const out = [];
  const seen = new Set();
  const push = (kind, href, label) => {
    const safe = safeHttpUrl(href);
    if (!safe || !safe.startsWith("https://") || seen.has(safe)) return;
    seen.add(safe);
    out.push({ kind, href: safe, label });
  };
  const sites = Array.isArray(info.websites) ? info.websites : [];
  for (const site of sites) {
    if (typeof site === "string") push("website", site, "Website");
  }
  const handle = typeof info.twitter_handle === "string" ? info.twitter_handle.replace(/^@/, "").trim() : "";
  if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) push("twitter", `https://x.com/${handle}`, "X");
  const telegram = typeof info.telegram_handle === "string" ? info.telegram_handle.replace(/^@/, "").trim() : "";
  if (/^[A-Za-z0-9_]{5,32}$/.test(telegram)) push("telegram", `https://t.me/${telegram}`, "Telegram");
  if (pair && pair.info && typeof pair.info === "object") {
    const websites = Array.isArray(pair.info.websites) ? pair.info.websites : [];
    for (const site of websites) push("website", site && site.url, "Website");
    const socials = Array.isArray(pair.info.socials) ? pair.info.socials : [];
    for (const social of socials) {
      const type = social && social.type;
      if (type === "twitter") push("twitter", social.url, "X");
      else if (type === "telegram") push("telegram", social.url, "Telegram");
    }
  }
  return out.slice(0, 4);
}

function jupKey(id) {
  return JUPITER_WINDOWS.find((entry) => entry[0] === id)[1];
}

function firstCount(...values) {
  for (const value of values) {
    const number = nonNegative(value);
    if (number != null) return number;
  }
  return null;
}

function sumVolumes(buy, sell) {
  const left = nonNegative(buy);
  const right = nonNegative(sell);
  if (left == null && right == null) return null;
  return (left || 0) + (right || 0);
}

function compareRows(a, b, sort, windowId, hiveIndex) {
  const av = sortValue(a, sort.key, windowId, hiveIndex);
  const bv = sortValue(b, sort.key, windowId, hiveIndex);
  const aNil = av == null;
  const bNil = bv == null;
  if (aNil && bNil) return a.ca < b.ca ? -1 : a.ca > b.ca ? 1 : 0;
  if (aNil) return 1;
  if (bNil) return -1;
  const dir = sort.dir === "asc" ? 1 : -1;
  if (av === bv) return a.ca < b.ca ? -1 : a.ca > b.ca ? 1 : 0;
  return av < bv ? -dir : dir;
}

function sortValue(row, key, windowId, hiveIndex) {
  if (key === "rank") return row.trendingRank == null ? null : row.trendingRank;
  if (key === "holders") return row.holders;
  if (key === "mcap") return row.marketCap;
  if (key === "liq") return row.liquidity;
  if (key === "change") return row.change ? row.change[windowId] : null;
  if (key === "volume") return row.volume ? row.volume[windowId] : null;
  if (key === "age") return row.createdAt;
  if (key === "hive") {
    const index = hiveIndex.get(row.ca);
    return index == null ? null : index;
  }
  return null;
}

function rowFromGeckoPool(pool, included) {
  if (!pool || typeof pool !== "object") return null;
  const rel = pool.relationships || {};
  const baseRef = rel.base_token && rel.base_token.data;
  const quoteRef = rel.quote_token && rel.quote_token.data;
  const dexRef = rel.dex && rel.dex.data;
  const baseId = baseRef && baseRef.id;
  const quoteId = quoteRef && quoteRef.id;
  const baseAttrs = included.get(baseId) || {};
  const quoteAttrs = included.get(quoteId) || {};
  const coin = pickCoin(baseAttrs, baseId, quoteAttrs, quoteId);
  if (!coin) return null;
  const attrs = pool.attributes || {};
  const row = blankRow(coin.ca);
  row.name = clipText(coin.attrs.name || "", 64);
  row.symbol = clipText(coin.attrs.symbol || symbolFromPoolName(attrs.name) || "", 16);
  row.image = typeof coin.attrs.image_url === "string" ? coin.attrs.image_url : "";
  row.priceUsd = nonNegative(attrs.base_token_price_usd);
  if (QUOTE_MINTS.has(coin.ca) === false && coin.ca !== addressFrom(baseAttrs, baseId)) {
    row.priceUsd = nonNegative(attrs.quote_token_price_usd);
  }
  row.marketCap = nonNegative(attrs.market_cap_usd);
  if (row.marketCap == null) row.marketCap = nonNegative(attrs.fdv_usd);
  row.liquidity = nonNegative(attrs.reserve_in_usd);
  row.createdAt = timeMs(attrs.pool_created_at);
  row.poolAddress = typeof attrs.address === "string" ? attrs.address : "";
  if (dexRef && typeof dexRef.id === "string") row.dex = clipText(dexRef.id, 32);
  const change = attrs.price_change_percentage || {};
  const volume = attrs.volume_usd || {};
  const txns = attrs.transactions || {};
  for (const id of WINDOW_IDS) {
    row.change[id] = asFinite(change[id]);
    row.volume[id] = nonNegative(volume[id]);
    const bucket = txns[id] && typeof txns[id] === "object" ? txns[id] : {};
    row.txns[id] = {
      buys: nonNegative(bucket.buys),
      sells: nonNegative(bucket.sells),
      buyers: nonNegative(bucket.buyers),
      sellers: nonNegative(bucket.sellers),
      buyVolume: null,
      sellVolume: null,
    };
  }
  return row;
}

function rowFromJupiter(token) {
  if (!token || typeof token !== "object" || !isValidCA(token.id) || QUOTE_MINTS.has(token.id)) return null;
  const row = blankRow(token.id);
  row.name = clipText(token.name || "", 64);
  row.symbol = clipText(token.symbol || "", 16);
  row.image = typeof token.icon === "string" ? token.icon : "";
  row.priceUsd = nonNegative(token.usdPrice);
  row.marketCap = nonNegative(token.mcap);
  if (row.marketCap == null) row.marketCap = nonNegative(token.fdv);
  row.liquidity = nonNegative(token.liquidity);
  row.holders = countOrNull(token.holderCount);
  const pool = token.firstPool && typeof token.firstPool === "object" ? token.firstPool : null;
  row.createdAt = timeMs(pool && pool.createdAt) || timeMs(token.createdAt);
  for (const [id, key] of JUPITER_WINDOWS) {
    const stats = token[key] && typeof token[key] === "object" ? token[key] : {};
    row.change[id] = asFinite(stats.priceChange);
    row.volume[id] = sumVolumes(stats.buyVolume, stats.sellVolume);
    row.txns[id] = {
      buys: nonNegative(stats.numBuys),
      sells: nonNegative(stats.numSells),
      buyers: null,
      sellers: null,
      buyVolume: nonNegative(stats.buyVolume),
      sellVolume: nonNegative(stats.sellVolume),
    };
  }
  return row;
}

function pickCoin(baseAttrs, baseId, quoteAttrs, quoteId) {
  const baseCa = addressFrom(baseAttrs, baseId);
  const quoteCa = addressFrom(quoteAttrs, quoteId);
  if (isValidCA(baseCa) && !QUOTE_MINTS.has(baseCa)) return { ca: baseCa, attrs: baseAttrs };
  if (isValidCA(quoteCa) && !QUOTE_MINTS.has(quoteCa)) return { ca: quoteCa, attrs: quoteAttrs };
  return null;
}

function addressFrom(attrs, id) {
  if (attrs && isValidCA(attrs.address)) return attrs.address;
  if (typeof id === "string" && id.startsWith("solana_")) {
    const ca = id.slice("solana_".length);
    if (isValidCA(ca)) return ca;
  }
  return "";
}

function symbolFromPoolName(name) {
  if (typeof name !== "string") return "";
  return name.split("/")[0].trim();
}

function blankRow(ca) {
  return {
    ca,
    name: "",
    symbol: "",
    image: "",
    priceUsd: null,
    marketCap: null,
    liquidity: null,
    volume: emptyWindows(),
    change: emptyWindows(),
    txns: emptyTxns(),
    createdAt: null,
    holders: null,
    trendingRank: null,
    newRank: null,
    dex: "",
  };
}

function cloneRow(row) {
  const next = blankRow(row.ca);
  next.name = row.name || "";
  next.symbol = row.symbol || "";
  next.image = row.image || "";
  next.priceUsd = row.priceUsd ?? null;
  next.marketCap = row.marketCap ?? null;
  next.liquidity = row.liquidity ?? null;
  next.createdAt = row.createdAt ?? null;
  next.holders = row.holders ?? null;
  next.trendingRank = row.trendingRank ?? null;
  next.newRank = row.newRank ?? null;
  next.dex = row.dex || "";
  for (const id of WINDOW_IDS) {
    next.change[id] = row.change && row.change[id] != null ? row.change[id] : null;
    next.volume[id] = row.volume && row.volume[id] != null ? row.volume[id] : null;
    const txn = row.txns && row.txns[id] ? row.txns[id] : {};
    next.txns[id] = {
      buys: txn.buys ?? null,
      sells: txn.sells ?? null,
      buyers: txn.buyers ?? null,
      sellers: txn.sellers ?? null,
      buyVolume: txn.buyVolume ?? null,
      sellVolume: txn.sellVolume ?? null,
    };
  }
  return next;
}

function fillRow(base, extra) {
  const next = cloneRow(base);
  for (const key of ["name", "symbol", "image", "dex"]) {
    if (!next[key] && extra[key]) next[key] = extra[key];
  }
  for (const key of ["priceUsd", "marketCap", "liquidity", "createdAt", "holders"]) {
    if (next[key] == null && extra[key] != null) next[key] = extra[key];
  }
  if (next.trendingRank == null && extra.trendingRank != null) next.trendingRank = extra.trendingRank;
  if (next.newRank == null && extra.newRank != null) next.newRank = extra.newRank;
  for (const id of WINDOW_IDS) {
    if (next.change[id] == null && extra.change && extra.change[id] != null) next.change[id] = extra.change[id];
    if (next.volume[id] == null && extra.volume && extra.volume[id] != null) next.volume[id] = extra.volume[id];
    const dest = next.txns[id];
    const src = extra.txns && extra.txns[id] ? extra.txns[id] : {};
    for (const field of ["buys", "sells", "buyers", "sellers", "buyVolume", "sellVolume"]) {
      if (dest[field] == null && src[field] != null) dest[field] = src[field];
    }
  }
  return next;
}

function nonNegative(value) {
  const number = asFinite(value);
  if (number == null || number < 0 || number > 1e15) return null;
  return number;
}

function countOrNull(value) {
  const number = nonNegative(value);
  if (number == null) return null;
  return Math.round(number);
}

function timeMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
