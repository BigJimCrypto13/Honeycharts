// Pure shaping for the live launch feed. No sockets and no DOM.

import { asFinite } from "./format.js";
import { QUOTE_MINTS, BTC_MINT, ETH_MINT, SOL_MINT } from "./board.js";
import { clipText, isValidCA, safeTokenImageUrl } from "./sanitize.js";
import { IMAGE_SLOTS, chooseImage, cleanImageSlot, emptyImages } from "./token-image.js";

export const LAUNCH_CAP = 200;
export const PINNED_CAP = 80;
export const TAPE_CAP = 40;
export const GRADUATE_READY = 45;
export const GRADUATE_FLOOR = 12;
export const PUMP_V_SOL_START = 30;
export const PUMP_V_SOL_END = 115;
export const PUMP_REAL_SOL = PUMP_V_SOL_END - PUMP_V_SOL_START;
// marketCapSol ≈ vSol^2 / 32.19 for the pump.fun constant product.
export const PUMP_MCAP_DIVISOR = 32.19;
const MAJOR_MINTS = new Set([SOL_MINT, BTC_MINT, ETH_MINT]);
const TRACK_MS = 3 * 24 * 60 * 60 * 1000;

export function emptyLiveSnapshot() {
  return {
    status: "connecting",
    solPrice: null,
    tracked: 0,
    launches: [],
    columns: { fresh: [], hot: [], done: [] },
    king: null,
    tape: [],
  };
}

export function formatLaunchAge(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatSolAmount(value) {
  const number = asFinite(value);
  if (number == null || number < 0 || number > 10000) return "—";
  if (number === 0) return "0 SOL";
  if (number >= 100) return `${number.toFixed(0)} SOL`;
  if (number >= 10) return `${number.toFixed(1)} SOL`;
  return `${number.toFixed(2)} SOL`;
}

export function usesPumpCurve(launchpad, vSol) {
  if (typeof vSol === "number" && Number.isFinite(vSol) && vSol > 0) return true;
  const pad = String(launchpad || "").toLowerCase();
  if (!pad || pad === "pumpswap" || pad === "pump-amm") return false;
  return pad === "pump" || pad === "pump.fun" || pad === "pump-fun" || pad === "pumpfun";
}

export function bondingProgress({ vSol, marketCapSol, marketCapUsd, solPrice, launchpad } = {}) {
  const virtual = asFinite(vSol);
  if (virtual != null && virtual > 0) {
    return clampPct(((virtual - PUMP_V_SOL_START) / PUMP_REAL_SOL) * 100);
  }
  if (!usesPumpCurve(launchpad, null)) return null;
  let mcapSol = asFinite(marketCapSol);
  const usd = asFinite(marketCapUsd);
  const px = asFinite(solPrice);
  if (mcapSol == null && usd != null && px != null && px > 0) mcapSol = usd / px;
  if (mcapSol == null || mcapSol <= 0) return null;
  const derived = Math.sqrt(mcapSol * PUMP_MCAP_DIVISOR);
  if (!Number.isFinite(derived)) return null;
  return clampPct(((derived - PUMP_V_SOL_START) / PUMP_REAL_SOL) * 100);
}

export function decorateLaunch(token, solPrice) {
  const rawUsd = finiteOrNull(token && token.marketCapUsd);
  const rawSol = finiteOrNull(token && token.marketCapSol);
  const px = finiteOrNull(solPrice);
  const marketCapUsd = rawUsd != null ? rawUsd : (rawSol != null && px != null && px > 0 ? rawSol * px : null);
  const progress = token && token.graduated
    ? 100
    : bondingProgress({
      vSol: token && token.vSol,
      marketCapSol: rawSol,
      marketCapUsd,
      solPrice: px,
      launchpad: token && token.launchpad,
    });
  return { ...token, marketCapUsd, progress };
}

export function normalizePumpMessage(message, now = Date.now()) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  if (typeof message.message === "string" && !message.mint) return null;
  const txType = typeof message.txType === "string" ? message.txType.toLowerCase() : "";
  if (txType !== "create" && txType !== "migrate" && txType !== "migration") return null;
  if (!isValidCA(message.mint) || QUOTE_MINTS.has(message.mint) || MAJOR_MINTS.has(message.mint)) return null;
  const graduated = txType !== "create";
  const token = blankLaunch(message.mint);
  token.name = clipText(message.name || "", 64);
  token.symbol = clipText(message.symbol || "", 16);
  token.uri = publicMetadataUri(message.uri);
  token.createdAt = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  token.devBuySol = graduated ? null : bounded(message.solAmount, 0, 10000);
  token.vSol = bounded(message.vSolInBondingCurve, 0, 100000);
  token.marketCapSol = bounded(message.marketCapSol, 0, 1e9);
  token.launchpad = launchpadFromPool(message.pool, graduated);
  token.graduated = graduated;
  token.source = "pumpportal";
  token.signature = typeof message.signature === "string" ? message.signature.slice(0, 128) : "";
  if (token.marketCapSol != null) token.spark = [token.marketCapSol];
  return { token, signature: token.signature };
}

export function launchFromJupiterToken(token, extra = {}) {
  if (!token || typeof token !== "object" || !isValidCA(token.id)) return null;
  if (QUOTE_MINTS.has(token.id) || MAJOR_MINTS.has(token.id)) return null;
  const row = blankLaunch(token.id);
  row.name = clipText(token.name || "", 64);
  row.symbol = clipText(token.symbol || "", 16);
  row.images.jupiter = cleanImageSlot(token.icon || "");
  row.createdAt = timeMs(token.createdAt) || timeMs(token.firstPool && token.firstPool.createdAt);
  row.marketCapUsd = bounded(token.mcap != null ? token.mcap : token.fdv, 0, 1e15);
  row.liquidity = bounded(token.liquidity, 0, 1e15);
  row.priceUsd = bounded(token.usdPrice, 0, 1e12);
  row.holders = countOrNull(token.holderCount);
  row.launchpad = clipText(token.launchpad || token.metaLaunchpad || "", 32);
  row.graduated = Boolean(token.graduatedPool || token.graduatedAt);
  row.trending = Boolean(extra.trending);
  row.source = "jupiter";
  row.change = changeFromJupiter(token);
  if (row.marketCapUsd != null) row.spark = [row.marketCapUsd];
  return row;
}

export function launchFromBoardRow(row, extra = {}) {
  if (!row || !isValidCA(row.ca) || QUOTE_MINTS.has(row.ca) || MAJOR_MINTS.has(row.ca)) return null;
  const token = blankLaunch(row.ca);
  token.name = clipText(row.name || "", 64);
  token.symbol = clipText(row.symbol || "", 16);
  const slot = IMAGE_SLOTS.includes(extra.imageSlot) ? extra.imageSlot : "gecko";
  token.images[slot] = cleanImageSlot(row.image || "");
  token.createdAt = finiteOrNull(row.createdAt);
  token.marketCapUsd = bounded(row.marketCap, 0, 1e15);
  token.liquidity = bounded(row.liquidity, 0, 1e15);
  token.priceUsd = bounded(row.priceUsd, 0, 1e12);
  token.holders = countOrNull(row.holders);
  token.launchpad = clipText(extra.launchpad || row.dex || "", 32);
  token.graduated = Boolean(extra.graduated);
  token.trending = Boolean(extra.trending);
  token.source = extra.source || "board";
  token.change = row.change || null;
  if (token.marketCapUsd != null) token.spark = [token.marketCapUsd];
  return token;
}

export function shouldTrack(token, now = Date.now()) {
  if (!token || !isValidCA(token.ca)) return false;
  if (QUOTE_MINTS.has(token.ca) || MAJOR_MINTS.has(token.ca)) return false;
  if (typeof token.createdAt !== "number" || !Number.isFinite(token.createdAt)) return true;
  const age = now - token.createdAt;
  if (age <= TRACK_MS) return true;
  if (token.graduated && age <= TRACK_MS * 2) return true;
  return false;
}

export function mergeLaunch(prev, next) {
  const images = { ...emptyImages(), ...(prev.images || {}) };
  for (const slot of IMAGE_SLOTS) {
    if (next.images && next.images[slot]) images[slot] = next.images[slot];
  }
  const uri = prev.uri || next.uri || "";
  const sparkValue = finiteOrNull(next.marketCapUsd) != null ? next.marketCapUsd : next.marketCapSol;
  return {
    ...prev,
    name: next.name || prev.name || "",
    symbol: next.symbol || prev.symbol || "",
    uri,
    images,
    createdAt: earliest(prev.createdAt, next.createdAt),
    devBuySol: preferKept(prev.devBuySol, next.devBuySol),
    vSol: preferIncoming(next.vSol, prev.vSol),
    marketCapSol: preferIncoming(next.marketCapSol, prev.marketCapSol),
    marketCapUsd: preferIncoming(next.marketCapUsd, prev.marketCapUsd),
    liquidity: preferIncoming(next.liquidity, prev.liquidity),
    priceUsd: preferIncoming(next.priceUsd, prev.priceUsd),
    holders: preferIncoming(next.holders, prev.holders),
    launchpad: prev.launchpad || next.launchpad || "",
    graduated: Boolean(prev.graduated || next.graduated),
    trending: Boolean(prev.trending || next.trending),
    source: prev.source || next.source || "",
    change: next.change || prev.change || null,
    spark: pushSpark(prev.spark, sparkValue),
    signature: prev.signature || next.signature || "",
    metaFailed: Boolean(prev.metaFailed) && uri === (prev.uri || ""),
  };
}

export function ingestLaunch(list, token, options = {}) {
  const clean = token && isValidCA(token.ca) ? token : null;
  if (!clean || !shouldTrack(clean, options.now)) return Array.isArray(list) ? list.slice() : [];
  const next = Array.isArray(list) ? list.slice() : [];
  const index = next.findIndex((item) => item && item.ca === clean.ca);
  if (index === -1) next.push(clean);
  else next[index] = mergeLaunch(next[index], clean);
  return capLaunches(next, options.solPrice, options.cap, options.pinned, options.now);
}

export function capLaunches(list, solPrice, cap = LAUNCH_CAP, pinnedCap = PINNED_CAP, now = Date.now()) {
  const sorted = (Array.isArray(list) ? list : [])
    .filter((token) => token && isValidCA(token.ca))
    .sort(byCreatedDesc);
  const limit = clampCount(cap, LAUNCH_CAP);
  const pinLimit = clampCount(pinnedCap, PINNED_CAP);
  const head = sorted.slice(0, limit);
  const seen = new Set(head.map((token) => token.ca));
  const pinned = [];
  for (const token of sorted) {
    if (seen.has(token.ca)) continue;
    const progress = decorateLaunch(token, solPrice).progress;
    const recentGrad = token.graduated && typeof token.createdAt === "number" && now - token.createdAt <= TRACK_MS;
    const hotCurve = typeof progress === "number" && progress >= 40 && progress < 100 && !token.graduated;
    if (!hotCurve && !recentGrad) continue;
    pinned.push(token);
    if (pinned.length >= pinLimit) break;
  }
  return head.concat(pinned);
}

export function applyLaunchImage(list, ca, slot, url) {
  if (!isValidCA(ca) || !IMAGE_SLOTS.includes(slot)) return Array.isArray(list) ? list : [];
  const clean = cleanImageSlot(url);
  if (!clean) return list.slice();
  return list.map((token) => {
    if (!token || token.ca !== ca) return token;
    const images = { ...emptyImages(), ...(token.images || {}), [slot]: clean };
    return { ...token, images, metaFailed: slot === "metadata" ? false : token.metaFailed };
  });
}

export function markMetadataFailed(list, ca) {
  if (!isValidCA(ca)) return Array.isArray(list) ? list : [];
  return list.map((token) => (token && token.ca === ca ? { ...token, metaFailed: true } : token));
}

export function selectNew(list, limit = LAUNCH_CAP) {
  const rows = (Array.isArray(list) ? list : []).filter((token) => token && isValidCA(token.ca) && !token.graduated);
  rows.sort(byCreatedDesc);
  return rows.slice(0, Math.max(0, limit));
}

export function selectGraduating(list, limit = 80) {
  const open = (Array.isArray(list) ? list : []).filter((token) => {
    return token && !token.graduated && typeof token.progress === "number" && token.progress < 100;
  });
  const ready = open.filter((token) => token.progress >= GRADUATE_READY);
  const pool = ready.length >= 4 ? ready : open.filter((token) => token.progress >= GRADUATE_FLOOR);
  pool.sort((a, b) => b.progress - a.progress || (b.createdAt || 0) - (a.createdAt || 0));
  return pool.slice(0, Math.max(0, limit));
}

export function selectGraduated(list, limit = 80) {
  const grads = [];
  const trend = [];
  for (const token of Array.isArray(list) ? list : []) {
    if (!token || !isValidCA(token.ca)) continue;
    if (token.graduated) grads.push(token);
    else if (token.trending && (token.liquidity || 0) >= 20000) trend.push(token);
  }
  grads.sort(byCreatedDesc);
  trend.sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0));
  const seen = new Set();
  const out = [];
  for (const token of grads.concat(trend)) {
    if (seen.has(token.ca)) continue;
    seen.add(token.ca);
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

export function pickKing(list) {
  const rows = (Array.isArray(list) ? list : []).filter((token) => token && isValidCA(token.ca));
  const open = rows.filter((token) => !token.graduated && typeof token.progress === "number");
  open.sort((a, b) => b.progress - a.progress || (b.marketCapUsd || 0) - (a.marketCapUsd || 0));
  if (open.length && open[0].progress >= 15) return open[0];
  const ranked = rows.slice().sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0));
  return ranked.find((token) => (token.marketCapUsd || 0) > 0) || rows[0] || null;
}

export function pushTape(tape, item, cap = TAPE_CAP) {
  if (!item || typeof item.id !== "string" || !item.id) return Array.isArray(tape) ? tape : [];
  const list = Array.isArray(tape) ? tape : [];
  if (list.some((entry) => entry && entry.id === item.id)) return list;
  const symbol = clipText(item.symbol || "", 16);
  const next = {
    id: item.id.slice(0, 160),
    kind: item.kind === "migration" ? "migration" : "launch",
    ca: isValidCA(item.ca) ? item.ca : "",
    symbol,
    devBuySol: finiteOrNull(item.devBuySol),
    at: finiteOrNull(item.at) || Date.now(),
  };
  return [next, ...list].slice(0, Math.max(1, cap));
}

export function sparklinePoints(values) {
  const nums = (Array.isArray(values) ? values : []).filter((value) => {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1e15;
  });
  if (nums.length < 2) return [];
  return nums.slice(-16);
}

export function sparkFromWindows(price, change) {
  const now = finiteOrNull(price);
  if (now == null || now <= 0) return [];
  const points = [];
  for (const id of ["h24", "h6", "h1", "m5"]) {
    const pct = change && finiteOrNull(change[id]);
    if (pct == null || pct <= -99.9) continue;
    const past = now / (1 + pct / 100);
    if (Number.isFinite(past) && past > 0) points.push(past);
  }
  points.push(now);
  return sparklinePoints(points);
}

export function launchSparkValues(token) {
  const direct = sparklinePoints(token && token.spark);
  if (direct.length >= 2) return direct;
  return sparkFromWindows(token && token.priceUsd, token && token.change);
}

export function sparklinePath(values, width = 64, height = 20) {
  const points = sparklinePoints(values);
  if (points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = width > 4 ? width : 64;
  const h = height > 4 ? height : 20;
  return points.map((value, index) => {
    const x = (index / (points.length - 1)) * (w - 2) + 1;
    const y = (h - 2) - ((value - min) / span) * (h - 4) + 1;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

export function displayImage(token) {
  return chooseImage(token && token.images);
}

function blankLaunch(ca) {
  return {
    ca,
    name: "",
    symbol: "",
    uri: "",
    images: emptyImages(),
    createdAt: null,
    devBuySol: null,
    vSol: null,
    marketCapSol: null,
    marketCapUsd: null,
    liquidity: null,
    priceUsd: null,
    holders: null,
    launchpad: "",
    graduated: false,
    trending: false,
    source: "",
    change: null,
    spark: [],
    signature: "",
    metaFailed: false,
  };
}

function launchpadFromPool(pool, graduated) {
  const value = typeof pool === "string" ? pool.toLowerCase() : "";
  if (value === "bonk") return "bonk";
  if (value === "pump-amm" || value === "pumpswap") return "pumpswap";
  if (value.includes("pump") || value === "") return graduated ? "pumpswap" : "pump.fun";
  return clipText(value, 32);
}

function publicMetadataUri(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return "";
  if (/^ipfs:\/\//i.test(trimmed) || /^ar:\/\//i.test(trimmed)) return trimmed;
  return safeTokenImageUrl(trimmed) || "";
}

function changeFromJupiter(token) {
  const read = (key) => {
    const stats = token[key] && typeof token[key] === "object" ? token[key] : null;
    return stats ? finiteOrNull(stats.priceChange) : null;
  };
  return { m5: read("stats5m"), h1: read("stats1h"), h6: read("stats6h"), h24: read("stats24h") };
}

function timeMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pushSpark(existing, value) {
  const spark = Array.isArray(existing) ? existing.slice(-15) : [];
  const number = finiteOrNull(value);
  if (number == null || number <= 0) return spark;
  const last = spark[spark.length - 1];
  if (last === number) return spark;
  if (last && (number > last * 8 || number < last / 8)) return [number];
  spark.push(number);
  return spark.slice(-16);
}

function byCreatedDesc(a, b) {
  const diff = (b.createdAt || 0) - (a.createdAt || 0);
  if (diff) return diff;
  return a.ca < b.ca ? -1 : a.ca > b.ca ? 1 : 0;
}

function earliest(a, b) {
  const left = finiteOrNull(a);
  const right = finiteOrNull(b);
  if (left != null && right != null) return Math.min(left, right);
  return left != null ? left : right;
}

function preferKept(prev, next) {
  const kept = finiteOrNull(prev);
  if (kept != null) return kept;
  return finiteOrNull(next);
}

function preferIncoming(next, prev) {
  const incoming = finiteOrNull(next);
  if (incoming != null) return incoming;
  return finiteOrNull(prev);
}

function finiteOrNull(value) {
  const number = asFinite(value);
  return number == null ? null : number;
}

function bounded(value, min, max) {
  const number = asFinite(value);
  if (number == null || number < min || number > max) return null;
  return number;
}

function countOrNull(value) {
  const number = bounded(value, 0, 1e12);
  return number == null ? null : Math.round(number);
}

function clampPct(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function clampCount(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.round(number);
}
