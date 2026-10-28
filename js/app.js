import { extractCA, isValidCA, clipText } from "./sanitize.js";
import { homePath, tokenPath } from "./paths.js";
import { ApiError, fetchSolanaFeed, fetchTokenPairs, fetchTokenDetail, fetchRugcheck } from "./api.js";
import {
  detectStorage,
  createHive,
  createRecent,
  parseHiveDocument,
  exportBackup,
  applyImport,
  IMPORT_ERRORS,
} from "./store.js";
import { buildHoneyScore } from "./score.js";
import { mountSwap } from "./swap.js";
import { el, clear } from "./dom.js";
import {
  renderHome,
  renderToken,
  renderHive,
  patchTokenMarket,
  patchTokenScore,
  setHivePressed,
  updateQuotedStats,
} from "./render.js";

const EXAMPLE_CA = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const { storage, persistent } = detectStorage();
const hive = createHive(storage);
const recent = createRecent(storage);
const stats = new Map();

const view = document.getElementById("view");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("ca-input");

let generation = 0;
let aborter = new AbortController();
let hiveTimer = 0;
let homeTimer = 0;
let hiveSort = { key: "added", dir: "desc" };
let lastForce = 0;
let lastHome = null;

const actions = {
  refreshHome,
  toggleHive,
  copyCa,
  copyLink,
  refreshToken,
  toggleSwap,
  sortHive,
  setNote,
  removeHive,
  refreshHive,
  exportHive,
  importHive,
  clearRecent,
};

boot();

function boot() {
  normalizeHash();
  searchForm.addEventListener("submit", onSearch);
  window.addEventListener("popstate", render);
  window.addEventListener("hashchange", () => {
    if (normalizeHash()) render();
  });
  document.addEventListener("click", onLinkClick);
  document.addEventListener("keydown", onSlash);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshVisibleStats(generation, false);
  });
  if (hive.wasReset()) {
    setStatus("Saved Hive data could not be read, so the list was cleared on this browser.");
    hive.clearReset();
  }
  render();
}

function begin() {
  generation += 1;
  aborter.abort();
  aborter = new AbortController();
  clearInterval(hiveTimer);
  clearInterval(homeTimer);
  return generation;
}

function alive(gen) {
  return gen === generation;
}

function render() {
  const gen = begin();
  const route = currentRoute();
  syncChrome(route);
  if (route.name === "token") showToken(gen, route.ca);
  else if (route.name === "hive") showHive(gen);
  else showHome(gen, route.error || "");
}

function currentRoute() {
  const params = new URLSearchParams(location.search);
  const ca = params.get("ca");
  if (ca != null && ca !== "") {
    const trimmed = ca.trim();
    if (isValidCA(trimmed)) return { name: "token", ca: trimmed };
    return {
      name: "home",
      error: "That address is not a valid Solana contract address (base58, 32–44 characters).",
    };
  }
  if (params.get("view") === "hive") return { name: "hive" };
  return { name: "home" };
}

function syncChrome(route) {
  const home = document.querySelector("[data-nav='home']");
  const hiveLink = document.querySelector("[data-nav='hive']");
  setCurrent(home, route.name === "home");
  setCurrent(hiveLink, route.name === "hive");
  const count = hive.list().length;
  hiveLink.textContent = count ? `Hive (${count})` : "Hive";
  if (route.name === "home") document.title = "Honeycharts — Solana scanner";
  if (route.name === "hive") document.title = "Hive · Honeycharts";
  if (route.name === "token") document.title = "Token · Honeycharts";
}

function setCurrent(node, on) {
  if (!node) return;
  if (on) node.setAttribute("aria-current", "page");
  else node.removeAttribute("aria-current");
}

async function showHome(gen, routeError) {
  const emptyFeeds = {
    loading: true,
    error: routeError,
    boosts: { items: [], total: 0, error: "" },
    profiles: { items: [], total: 0, error: "" },
  };
  renderHome(view, homeModel(emptyFeeds), actions);
  try {
    const [boostResult, profileResult] = await Promise.allSettled([
      fetchSolanaFeed("boosts", { signal: aborter.signal }),
      fetchSolanaFeed("profiles", { signal: aborter.signal }),
    ]);
    if (!alive(gen) || abortedResult(boostResult) || abortedResult(profileResult)) return;
    const boosts = feedValue(boostResult, "The boosted list did not load.");
    const profiles = feedValue(profileResult, "Latest profiles did not load.");
    const seen = new Set(boosts.items.map((item) => item.ca));
    profiles.items = profiles.items.filter((item) => !seen.has(item.ca));
    let error = routeError;
    if (boostResult.status === "rejected" && profileResult.status === "rejected") {
      error = error || feedErrorMessage(boostResult.reason);
    }
    const cas = [
      ...boosts.items.map((item) => item.ca),
      ...profiles.items.map((item) => item.ca),
      ...recent.list().map((item) => item.ca),
    ];
    const fetched = await fetchTokenPairs(cas, { signal: aborter.signal });
    if (!alive(gen)) return;
    mergeStats(fetched);
    renderHome(view, homeModel({ loading: false, error, boosts, profiles }), actions);
    homeTimer = setInterval(() => refreshVisibleStats(gen, false), 90000);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!alive(gen)) return;
    renderHome(view, homeModel({
      loading: false,
      error: routeError || feedErrorMessage(error),
      boosts: { items: [], total: 0, error: "" },
      profiles: { items: [], total: 0, error: "" },
    }), actions);
  }
}

function feedValue(result, message) {
  if (result.status === "fulfilled") return { ...result.value, error: "" };
  return { items: [], total: 0, error: message };
}

async function showHive(gen) {
  renderHive(view, hiveModel(), actions);
  hiveTimer = setInterval(() => refreshVisibleStats(gen, false), 45000);
  await refreshVisibleStats(gen, false);
}

async function showToken(gen, ca) {
  searchInput.value = ca;
  recent.touch(ca);
  const cached = stats.get(ca);
  let pair = cached && cached.pair ? cached.pair : null;
  renderToken(view, tokenModel(ca, {
    pair,
    dexStatus: pair ? "ready" : "loading",
    scoreStatus: "loading",
    score: null,
  }), actions);
  if (pair) applyTitle(pair);

  try {
    pair = await fetchTokenDetail(ca, { signal: aborter.signal });
    if (!alive(gen)) return;
    stats.set(ca, { pair, error: null });
    rememberPair(ca, pair);
    if (pair) applyTitle(pair);
    patchTokenMarket(view, tokenModel(ca, {
      pair,
      dexStatus: pair ? "ready" : "empty",
      dexMessage: pair ? "" : "DexScreener has no Solana pair where this address is the base token. The chart may still load.",
      scoreStatus: "loading",
      score: null,
    }), actions);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!alive(gen)) return;
    patchTokenMarket(view, tokenModel(ca, {
      pair,
      dexStatus: pair ? "ready" : "error",
      dexMessage: error instanceof ApiError && error.code === "rate"
        ? "DexScreener is rate-limiting requests. The chart may still load."
        : "Couldn't reach DexScreener for figures. The chart may still load.",
      scoreStatus: "loading",
      score: null,
    }), actions);
  }

  let report = null;
  let reportError = null;
  try {
    report = await fetchRugcheck(ca, { signal: aborter.signal });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!alive(gen)) return;
    reportError = error instanceof ApiError && error.code === "rate"
      ? "rate"
      : error instanceof ApiError && error.code === "mismatch"
        ? "mismatch"
        : "network";
  }
  if (!alive(gen)) return;
  patchTokenScore(view, {
    scoreStatus: "ready",
    score: buildHoneyScore(pair, report, { reportError }),
  });
}

async function refreshVisibleStats(gen, force) {
  if (!alive(gen)) return;
  const route = currentRoute();
  if (route.name === "token") return;
  const cas = collectVisibleCas(route.name);
  if (!cas.length) return;
  try {
    const fetched = await fetchTokenPairs(cas, { signal: aborter.signal, force });
    if (!alive(gen)) return;
    mergeStats(fetched);
    if (route.name === "hive") {
      const editing = document.activeElement && document.activeElement.classList.contains("note");
      const needsOrder = hiveSort.key === "price" || hiveSort.key === "change" || hiveSort.key === "liq" || hiveSort.key === "mcap";
      if (!editing && (force || needsOrder)) renderHive(view, hiveModel(), actions);
      else updateQuotedStats(view, stats);
      return;
    }
    updateQuotedStats(view, stats);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (alive(gen)) setStatus("Couldn't refresh prices. Showing the last figures we have.");
  }
}

function collectVisibleCas(routeName) {
  if (routeName === "hive") {
    return [...hive.list().map((token) => token.ca), ...recent.list().map((item) => item.ca)];
  }
  const cas = [];
  view.querySelectorAll("[data-ca]").forEach((node) => {
    const ca = node.getAttribute("data-ca");
    if (isValidCA(ca)) cas.push(ca);
  });
  return cas;
}

function refreshHome() {
  if (tooSoon()) {
    setStatus("Wait a moment before refreshing again.");
    return;
  }
  render();
}

function refreshHive() {
  if (tooSoon()) {
    setStatus("Wait a moment before refreshing again.");
    return;
  }
  refreshVisibleStats(generation, true);
}

async function refreshToken() {
  if (currentRoute().name !== "token") return;
  if (tooSoon()) {
    setStatus("Wait a moment before refreshing again.");
    return;
  }
  const gen = generation;
  const ca = currentRoute().ca;
  let pair = stats.get(ca) ? stats.get(ca).pair : null;
  let dexFailed = false;
  try {
    pair = await fetchTokenDetail(ca, { signal: aborter.signal, force: true });
    if (!alive(gen)) return;
    stats.set(ca, { pair, error: null });
    rememberPair(ca, pair);
    if (pair) applyTitle(pair);
    patchTokenMarket(view, tokenModel(ca, {
      pair,
      dexStatus: pair ? "ready" : "empty",
      dexMessage: pair ? "" : "DexScreener has no Solana pair where this address is the base token.",
      scoreStatus: "loading",
      score: null,
    }), actions);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!alive(gen)) return;
    dexFailed = true;
    setStatus(error instanceof ApiError && error.code === "rate"
      ? "DexScreener is rate-limiting requests."
      : "Couldn't refresh DexScreener figures.");
  }
  let report = null;
  let reportError = null;
  try {
    report = await fetchRugcheck(ca, { signal: aborter.signal, force: true });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!alive(gen)) return;
    reportError = error instanceof ApiError && error.code === "rate" ? "rate" : "network";
  }
  if (!alive(gen)) return;
  patchTokenScore(view, {
    scoreStatus: "ready",
    score: buildHoneyScore(pair, report, { reportError }),
  });
  if (!dexFailed && !reportError) setStatus("Figures refreshed.");
}

async function toggleSwap() {
  const route = currentRoute();
  if (route.name !== "token") return;
  const body = view.querySelector("[data-swap-body]");
  const button = view.querySelector("[data-action='swap-toggle']");
  const status = view.querySelector("[data-swap-status]");
  if (!body || !button) return;
  const opening = body.hasAttribute("hidden");
  if (!opening) {
    body.setAttribute("hidden", "");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "Swap";
    return;
  }
  body.removeAttribute("hidden");
  button.setAttribute("aria-expanded", "true");
  button.textContent = "Hide swap";
  if (view.querySelector("#jupiter-plugin-instance")) return;
  if (status) status.textContent = "Loading Jupiter…";
  try {
    await mountSwap(route.ca);
    if (currentRoute().name !== "token" || currentRoute().ca !== route.ca) return;
    if (status) status.textContent = "";
  } catch {
    if (currentRoute().name !== "token" || currentRoute().ca !== route.ca) return;
    if (status) {
      status.textContent = "Jupiter's swap panel did not load in this browser. Use the link below. Honeycharts still does not touch your wallet.";
    }
  }
}

function toggleHive() {
  const route = currentRoute();
  if (route.name !== "token") return;
  const ca = route.ca;
  if (hive.has(ca)) {
    const removed = hive.get(ca);
    hive.remove(ca);
    setHivePressed(view, false);
    syncChrome(route);
    setStatus("Removed from Hive.", undoButton(removed));
    return;
  }
  try {
    const pair = stats.get(ca) && stats.get(ca).pair;
    const name = clipText(pair && pair.baseToken && pair.baseToken.name, 64);
    const symbol = clipText(pair && pair.baseToken && pair.baseToken.symbol, 16);
    hive.add(ca, name, symbol);
    setHivePressed(view, true);
    syncChrome(route);
    setStatus("Saved in this browser's Hive.");
  } catch (error) {
    setStatus(IMPORT_ERRORS[error.message] || "Couldn't add that token.");
  }
}

function undoButton(token) {
  if (!token) return null;
  return el("button", {
    className: "ghost",
    text: "Undo",
    attrs: { type: "button" },
    on: {
      click: () => {
        try {
          hive.restore(token);
          setHivePressed(view, hive.has(token.ca));
          syncChrome(currentRoute());
          setStatus("Restored to Hive.");
          if (currentRoute().name === "hive") renderHive(view, hiveModel(), actions);
        } catch (error) {
          setStatus(IMPORT_ERRORS[error.message] || "Couldn't restore that token.");
        }
      },
    },
  });
}

function removeHive(ca) {
  const token = hive.get(ca);
  if (!token || !hive.remove(ca)) return;
  const label = token.symbol || "token";
  setStatus(`Removed ${label} from Hive.`, undoButton(token));
  renderHive(view, hiveModel(), actions);
  syncChrome(currentRoute());
}

function setNote(ca, value) {
  hive.setNote(ca, value);
}

function sortHive(key) {
  if (hiveSort.key === key) hiveSort = { key, dir: hiveSort.dir === "asc" ? "desc" : "asc" };
  else hiveSort = { key, dir: key === "symbol" ? "asc" : "desc" };
  renderHive(view, hiveModel({ restoreSortFocus: true }), actions);
}

function clearRecent() {
  recent.clear();
  setStatus("Cleared recently viewed.");
  const route = currentRoute();
  if (route.name === "hive") renderHive(view, hiveModel(), actions);
  if (route.name === "home" && lastHome) renderHome(view, homeModel({ ...lastHome, loading: false }), actions);
}

async function copyCa() {
  const route = currentRoute();
  if (route.name !== "token") return;
  await copyText(route.ca, "Contract address copied.", "Copy failed. Select the address and copy it manually.");
}

async function copyLink() {
  const route = currentRoute();
  if (route.name !== "token") return;
  const url = new URL(tokenPath(location.pathname, route.ca), location.origin).href;
  await copyText(url, "Link copied.", "Copy failed. Copy the address from the browser bar.");
}

async function copyText(text, ok, failed) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(ok);
  } catch {
    setStatus(failed);
  }
}

function exportHive() {
  const backup = exportBackup(hive, recent);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "honeycharts-hive.json";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  setStatus("Backup downloaded as honeycharts-hive.json.");
}

async function importHive(file, replace) {
  if (!file) return;
  if (file.size > 500000) {
    setStatus(IMPORT_ERRORS["file-size"]);
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    setStatus("That file could not be read.");
    return;
  }
  let parsed;
  try {
    parsed = parseHiveDocument(text, "file");
  } catch (error) {
    setStatus(IMPORT_ERRORS[error.message] || "That file was rejected.");
    return;
  }
  try {
    const result = applyImport(hive, recent, parsed, replace ? "replace" : "merge");
    setStatus(result.replaced
      ? `Replaced the Hive with ${result.total} tokens.`
      : `Imported ${result.added} new tokens. Updated notes on ${result.updated}.`);
    if (currentRoute().name === "hive") renderHive(view, hiveModel(), actions);
    syncChrome(currentRoute());
  } catch (error) {
    setStatus(IMPORT_ERRORS[error.message] || "Import did not change the Hive.");
  }
}

function onSearch(event) {
  event.preventDefault();
  const ca = extractCA(searchInput.value);
  if (!ca) {
    setStatus("Paste one Solana contract address. Base58, 32 to 44 characters.");
    return;
  }
  searchInput.value = ca;
  history.pushState(null, "", tokenPath(location.pathname, ca));
  render();
}

function onLinkClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a");
  if (!link || !link.href) return;
  if (link.target && link.target !== "_self") return;
  if (link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next === current) return;
  history.pushState(null, "", next);
  render();
}

function onSlash(event) {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  event.preventDefault();
  searchInput.focus();
}

function normalizeHash() {
  if (!location.hash || location.hash.length < 2) return false;
  let hash = location.hash.slice(1);
  try {
    hash = decodeURIComponent(hash);
  } catch {
    return false;
  }
  hash = hash.trim();
  if (!isValidCA(hash)) return false;
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("ca", hash);
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  return true;
}

function homeModel(partial) {
  const model = {
    loading: Boolean(partial.loading),
    error: partial.error || "",
    boosts: partial.boosts || { items: [], total: 0, error: "" },
    profiles: partial.profiles || { items: [], total: 0, error: "" },
    stats,
    recent: recent.list(),
    persistent,
    exampleHref: tokenPath(location.pathname, EXAMPLE_CA),
    tokenHref: (ca) => tokenPath(location.pathname, ca),
  };
  lastHome = model;
  return model;
}

function hiveModel(extra = {}) {
  return {
    tokens: hive.list(),
    recent: recent.list(),
    stats,
    sort: hiveSort,
    persistent,
    homeHref: homePath(location.pathname),
    tokenHref: (ca) => tokenPath(location.pathname, ca),
    restoreSortFocus: Boolean(extra.restoreSortFocus),
  };
}

function tokenModel(ca, extra) {
  const pair = extra.pair || null;
  const fallback = fallbackFor(ca);
  const pageUrl = new URL(tokenPath(location.pathname, ca), location.origin).href;
  return {
    ca,
    pair,
    fallback,
    inHive: hive.has(ca),
    dexStatus: extra.dexStatus,
    dexMessage: extra.dexMessage || "",
    scoreStatus: extra.scoreStatus,
    score: extra.score || null,
    shareHref: shareHref(
      (pair && pair.baseToken && pair.baseToken.symbol) || (fallback && fallback.symbol) || "",
      (pair && pair.baseToken && pair.baseToken.name) || (fallback && fallback.name) || "",
      pageUrl,
    ),
  };
}

function fallbackFor(ca) {
  return hive.get(ca) || recent.list().find((item) => item.ca === ca) || null;
}

function shareHref(symbol, name, pageUrl) {
  const sym = clipText(symbol, 16) || "a Solana token";
  const labelName = clipText(name, 32);
  const label = labelName ? `${sym} (${labelName})` : sym;
  const text = `Watching ${label} on Honeycharts`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
}

function rememberPair(ca, pair) {
  if (!pair || !pair.baseToken) return;
  const name = clipText(pair.baseToken.name, 64);
  const symbol = clipText(pair.baseToken.symbol, 16);
  hive.remember(ca, name, symbol);
  recent.touch(ca, name, symbol);
}

function applyTitle(pair) {
  const symbol = clipText(pair && pair.baseToken && pair.baseToken.symbol, 16);
  document.title = symbol ? `${symbol} · Honeycharts` : "Token · Honeycharts";
}

function mergeStats(incoming) {
  for (const [ca, entry] of incoming) stats.set(ca, entry);
}

function tooSoon() {
  const now = Date.now();
  if (now - lastForce < 2000) return true;
  lastForce = now;
  return false;
}

function abortedResult(result) {
  return result.status === "rejected" && result.reason && result.reason.name === "AbortError";
}

function feedErrorMessage(error) {
  if (error instanceof ApiError && error.code === "rate") {
    return "DexScreener is rate-limiting requests. Wait a moment, then refresh.";
  }
  return "Couldn't load DexScreener's Solana feeds. You can still paste a contract address.";
}

function setStatus(message, action) {
  const node = document.getElementById("status");
  clear(node);
  if (!message) return;
  node.append(el("span", { text: message }));
  if (action) node.append(action);
}
