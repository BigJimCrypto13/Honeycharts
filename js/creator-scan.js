import { ApiError, fetchTokenPairs } from "./api.js";
import { SOLANA_READ_RPC } from "./config.js";
import {
  SKIP_MINTS,
  classifyLaunch,
  firstSigner,
  mintsInitializedBy,
  readRugcheckCreator,
  snapshotFromPair,
  summarizeLaunches,
} from "./creator.js";
import { clipText, isValidCA } from "./sanitize.js";

export const CREATOR_CACHE_KEY = "honeycharts.creator.v1";
export const MAX_TX_READ = 160;
export const SIGNATURE_PAGE = 1000;
export const MINT_SIGNATURE_PAGES = 3;
export const SCAN_TTL_MS = 6 * 60 * 60 * 1000;
export const PARTIAL_TTL_MS = 30 * 60 * 1000;
export const ROW_TTL_MS = 30 * 60 * 1000;
const LOGIC = 1;
const MAX_WALLETS = 24;

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;

export function createCreatorCache(storage) {
  return {
    getScan(wallet, now = Date.now()) {
      const saved = readStore(storage).wallets[wallet];
      if (!saved) return null;
      const ttl = saved.rateLimited || saved.truncated ? PARTIAL_TTL_MS : SCAN_TTL_MS;
      if (!Number.isFinite(saved.at) || now - saved.at >= ttl) return null;
      return saved;
    },
    peek(wallet) {
      const saved = readStore(storage).wallets[wallet];
      if (!saved || !saved.mints.length) return null;
      return saved;
    },
    getRow(wallet, mint, now = Date.now()) {
      const saved = readStore(storage).wallets[wallet];
      const row = saved && saved.rows && saved.rows[mint];
      if (!row || row.logic !== LOGIC) return null;
      if (!Number.isFinite(row.at) || now - row.at >= ROW_TTL_MS) return null;
      return row;
    },
    save(wallet, scan, rows) {
      const store = readStore(storage);
      const nextRows = {};
      for (const row of rows) {
        if (!row || !isValidCA(row.mint) || row.skipCache) continue;
        nextRows[row.mint] = {
          logic: LOGIC,
          at: row.at,
          outcome: row.outcome,
          reasons: cleanReasons(row.reasons),
          symbol: clipText(row.symbol, 16),
          name: clipText(row.name, 64),
          priceUsd: finiteOrNull(row.priceUsd),
          liquidityUsd: finiteOrNull(row.liquidityUsd),
          marketCap: finiteOrNull(row.marketCap),
        };
      }
      store.wallets[wallet] = {
        at: scan.at,
        truncated: Boolean(scan.truncated),
        rateLimited: Boolean(scan.rateLimited),
        checked: countOf(scan.checked),
        mentioned: countOf(scan.mentioned),
        mints: cleanMints(scan.mints),
        rows: nextRows,
      };
      trimWallets(store.wallets);
      writeStore(storage, store);
    },
  };
}

export async function resolveCreator(mint, report, options = {}) {
  const fromReport = readRugcheckCreator(report);
  if (fromReport) return { wallet: fromReport, source: "rugcheck" };
  try {
    const signer = await findFirstSigner(mint, options);
    if (signer) return { wallet: signer, source: "first-signer" };
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    return { wallet: "", source: "", error: errorCode(error) };
  }
  return { wallet: "", source: "" };
}

export async function loadCreatorHistory(wallet, options = {}) {
  if (!isValidCA(wallet)) {
    return failedHistory(wallet, "That is not a Solana wallet address.");
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const cache = options.cache || null;
  const force = options.force === true;
  const cached = !force && cache ? cache.getScan(wallet, now) : null;
  if (cached) {
    const assessed = await assessMints(wallet, cached.mints, cached, options, now);
    return historyFrom(wallet, cached, assessed, true);
  }

  let signatures = [];
  let rateLimited = false;
  try {
    signatures = await getSignatures(wallet, { limit: SIGNATURE_PAGE }, options.signal);
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    const stale = cache && typeof cache.peek === "function" ? cache.peek(wallet) : null;
    if (stale) {
      const assessed = await assessMints(wallet, stale.mints, stale, options, now);
      const result = historyFrom(wallet, { ...stale, rateLimited: true }, assessed, true);
      result.notice = rateNotice(result.notice);
      return result;
    }
    if (errorCode(error) === "rate") {
      return failedHistory(wallet, "The public Solana RPC rate-limited this lookup. Nothing new was counted.");
    }
    return failedHistory(wallet, "The public Solana RPC did not return this wallet's transactions. Nothing was counted.");
  }

  const listed = Array.isArray(signatures) ? signatures : [];
  const slice = listed.slice(0, MAX_TX_READ);
  const truncated = listed.length > slice.length || listed.length >= SIGNATURE_PAGE;
  const mints = [];
  const seen = new Set();
  let checked = 0;
  for (const entry of slice) {
    throwIfAborted(options.signal);
    const signature = entry && entry.signature;
    if (typeof signature !== "string" || !SIG_RE.test(signature)) continue;
    let tx = null;
    try {
      tx = await getTransaction(signature, options.signal);
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      if (errorCode(error) === "rate") {
        rateLimited = true;
        break;
      }
      continue;
    }
    checked += 1;
    if (options.onProgress && checked % 8 === 0) {
      options.onProgress(`Read ${checked} of ${slice.length} transactions. Launches found: ${mints.length}.`);
    }
    for (const mint of mintsInitializedBy(tx, wallet)) {
      if (seen.has(mint)) continue;
      seen.add(mint);
      mints.push(mint);
    }
  }

  const focus = isValidCA(options.focusMint) ? options.focusMint : "";
  if (focus && !SKIP_MINTS.has(focus) && !seen.has(focus)) mints.unshift(focus);

  const scan = {
    at: now,
    truncated,
    rateLimited,
    checked,
    mentioned: listed.length,
    mints,
  };
  const assessed = await assessMints(wallet, mints, null, options, now);
  if (cache && checked > 0) cache.save(wallet, scan, assessed.rows);
  return historyFrom(wallet, scan, assessed, false);
}

async function assessMints(wallet, mints, cachedScan, options, now) {
  const list = cleanMints(mints);
  const rows = [];
  const needed = [];
  const cache = options.cache || null;
  const force = options.force === true;
  for (const mint of list) {
    const cached = !force && cache ? cache.getRow(wallet, mint, now) : null;
    if (cached) rows.push(rowFromCache(mint, cached));
    else needed.push(mint);
  }
  let rateLimited = false;
  if (needed.length) {
    let fetched = new Map();
    try {
      fetched = await fetchTokenPairs(needed, { signal: options.signal, force });
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      rateLimited = errorCode(error) === "rate";
      fetched = new Map();
    }
    for (const mint of needed) {
      const entry = fetched.get(mint);
      const errored = !entry || entry.error;
      if (errored && !rateLimited && entry && entry.error && errorCode(entry.error) === "rate") {
        rateLimited = true;
      }
      const known = options.knownPairs && options.knownPairs.get && options.knownPairs.get(mint);
      const pair = entry && entry.pair ? entry.pair : (known || null);
      const rugged = Boolean(options.ruggedByMint && options.ruggedByMint[mint] === true);
      const snapshot = snapshotFromPair(pair, { rugged });
      const judged = errored && !pair ? { outcome: "unknown", reasons: [{ code: "unknown", text: "not enough data" }] } : classifyLaunch(snapshot, now);
      const base = pair && pair.baseToken && typeof pair.baseToken === "object" ? pair.baseToken : {};
      rows.push({
        mint,
        at: now,
        outcome: judged.outcome,
        reasons: judged.reasons,
        symbol: clipText(base.symbol, 16),
        name: clipText(base.name, 64),
        priceUsd: snapshot.priceUsd,
        liquidityUsd: snapshot.liquidityUsd,
        marketCap: snapshot.marketCap,
        skipCache: Boolean(errored && !pair),
      });
    }
  }
  const ordered = [];
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  for (const mint of list) {
    if (byMint.has(mint)) ordered.push(byMint.get(mint));
  }
  return { rows: ordered, rateLimited };
}

function historyFrom(wallet, scan, assessed, fromCache) {
  const summary = summarizeLaunches(assessed.rows.map(publicRow));
  const notices = [];
  if (scan.rateLimited || assessed.rateLimited) {
    notices.push("The public Solana RPC or DexScreener rate-limited part of this lookup. Counts use the figures that loaded.");
  }
  if (scan.truncated) {
    notices.push(`Only the newest ${scan.checked} transactions that mention this wallet were read. Older launches can be missing. Missing launches are not counted.`);
  }
  return {
    ok: true,
    wallet,
    fromCache,
    truncated: Boolean(scan.truncated),
    rateLimited: Boolean(scan.rateLimited || assessed.rateLimited),
    checked: scan.checked,
    mentioned: scan.mentioned,
    mints: scan.mints,
    summary,
    notice: notices.join(" "),
    error: "",
  };
}

function failedHistory(wallet, error) {
  return {
    ok: false,
    wallet,
    fromCache: false,
    truncated: false,
    rateLimited: /rate-limit/i.test(error),
    checked: 0,
    mentioned: 0,
    mints: [],
    summary: summarizeLaunches([]),
    notice: "",
    error,
  };
}

function publicRow(row) {
  return { mint: row.mint, outcome: row.outcome, reasons: row.reasons, symbol: row.symbol, name: row.name };
}

function rowFromCache(mint, cached) {
  return {
    mint,
    at: cached.at,
    outcome: cached.outcome === "loss" || cached.outcome === "alive" ? cached.outcome : "unknown",
    reasons: cleanReasons(cached.reasons),
    symbol: clipText(cached.symbol, 16),
    name: clipText(cached.name, 64),
    priceUsd: finiteOrNull(cached.priceUsd),
    liquidityUsd: finiteOrNull(cached.liquidityUsd),
    marketCap: finiteOrNull(cached.marketCap),
    skipCache: false,
  };
}

function rateNotice(existing) {
  const line = "Showing a saved lookup because the public Solana RPC rate-limited a fresh read.";
  return existing ? `${line} ${existing}` : line;
}

async function findFirstSigner(mint, options) {
  if (!isValidCA(mint)) return "";
  let before = undefined;
  let page = [];
  for (let index = 0; index < MINT_SIGNATURE_PAGES; index += 1) {
    const params = { limit: SIGNATURE_PAGE };
    if (before) params.before = before;
    const signatures = await getSignatures(mint, params, options.signal);
    page = Array.isArray(signatures) ? signatures : [];
    if (!page.length) return "";
    if (page.length < SIGNATURE_PAGE) break;
    before = page[page.length - 1] && page[page.length - 1].signature;
    if (index === MINT_SIGNATURE_PAGES - 1) return "";
  }
  const oldest = page[page.length - 1] && page[page.length - 1].signature;
  if (typeof oldest !== "string" || !SIG_RE.test(oldest)) return "";
  const tx = await getTransaction(oldest, options.signal);
  const signer = firstSigner(tx);
  if (!signer || signer === mint || SKIP_MINTS.has(signer)) return "";
  return signer;
}

async function getSignatures(address, params, signal) {
  const result = await rpcRetry("getSignaturesForAddress", [address, params], signal);
  return Array.isArray(result) ? result : [];
}

async function getTransaction(signature, signal) {
  return rpcRetry("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
  ], signal);
}

async function rpcRetry(method, params, signal) {
  let wait = 700;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await rpc(method, params, signal);
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      if (errorCode(error) !== "rate" || attempt === 3) throw error;
      await delay(wait, signal);
      wait *= 2;
    }
  }
  return null;
}

async function rpc(method, params, signal) {
  throwIfAborted(signal);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, 15000);
  try {
    const response = await fetch(SOLANA_READ_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (response.status === 429) throw new ApiError("rate", 429);
    if (!response.ok) throw new ApiError("http", response.status);
    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("parse", response.status);
    }
    if (data && data.error) {
      const message = typeof data.error.message === "string" ? data.error.message : "";
      if (data.error.code === 429 || /too many requests|rate limit/i.test(message)) {
        throw new ApiError("rate", 429);
      }
      throw new ApiError("rpc", Number(data.error.code) || 0);
    }
    return data ? data.result : null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && error.name === "AbortError") {
      if (timedOut) throw new ApiError("network", 0);
      throw error;
    }
    throw new ApiError("network", 0);
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function readStore(storage) {
  try {
    const raw = storage.getItem(CREATOR_CACHE_KEY);
    if (!raw || raw.length > 500000) return { version: 1, wallets: {} };
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.wallets || typeof data.wallets !== "object" || Array.isArray(data.wallets)) {
      return { version: 1, wallets: {} };
    }
    const wallets = {};
    for (const [wallet, scan] of Object.entries(data.wallets)) {
      if (!isValidCA(wallet) || !scan || typeof scan !== "object") continue;
      wallets[wallet] = {
        at: finiteOrNull(scan.at) || 0,
        truncated: scan.truncated === true,
        rateLimited: scan.rateLimited === true,
        checked: countOf(scan.checked),
        mentioned: countOf(scan.mentioned),
        mints: cleanMints(scan.mints),
        rows: cleanRows(scan.rows),
      };
    }
    return { version: 1, wallets };
  } catch {
    return { version: 1, wallets: {} };
  }
}

function writeStore(storage, store) {
  const text = JSON.stringify({ version: 1, wallets: store.wallets });
  try {
    storage.setItem(CREATOR_CACHE_KEY, text);
  } catch {
    try {
      storage.removeItem(CREATOR_CACHE_KEY);
      storage.setItem(CREATOR_CACHE_KEY, text);
    } catch {
      // The lookup still finishes. The browser refused to store it.
    }
  }
}

function cleanRows(rows) {
  const out = {};
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) return out;
  for (const [mint, row] of Object.entries(rows)) {
    if (!isValidCA(mint) || !row || typeof row !== "object" || row.logic !== LOGIC) continue;
    const outcome = row.outcome === "loss" || row.outcome === "alive" ? row.outcome : "unknown";
    out[mint] = {
      logic: LOGIC,
      at: finiteOrNull(row.at) || 0,
      outcome,
      reasons: cleanReasons(row.reasons),
      symbol: clipText(row.symbol, 16),
      name: clipText(row.name, 64),
      priceUsd: finiteOrNull(row.priceUsd),
      liquidityUsd: finiteOrNull(row.liquidityUsd),
      marketCap: finiteOrNull(row.marketCap),
    };
  }
  return out;
}

function cleanReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  const out = [];
  for (const reason of reasons) {
    if (!reason || typeof reason !== "object") continue;
    const code = ["drawdown", "liquidity", "no-trading", "rugged", "alive", "unknown"].includes(reason.code)
      ? reason.code
      : "unknown";
    out.push({ code, text: clipText(reason.text, 220) || "not enough data" });
    if (out.length >= 4) break;
  }
  return out;
}

function cleanMints(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const mint of list) {
    if (!isValidCA(mint) || SKIP_MINTS.has(mint) || seen.has(mint)) continue;
    seen.add(mint);
    out.push(mint);
    if (out.length >= MAX_TX_READ) break;
  }
  return out;
}

function trimWallets(wallets) {
  const entries = Object.entries(wallets);
  if (entries.length <= MAX_WALLETS) return;
  entries.sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (const [wallet] of entries.slice(0, entries.length - MAX_WALLETS)) delete wallets[wallet];
}

function countOf(value) {
  const number = finiteOrNull(value);
  if (number == null || number < 0) return 0;
  return Math.min(100000, Math.round(number));
}

function finiteOrNull(value) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function errorCode(error) {
  if (error instanceof ApiError) return error.code;
  if (error && typeof error.code === "string") return error.code;
  return "network";
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal && signal.aborted) onAbort();
    else if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}
