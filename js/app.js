import { extractCA, isValidCA, clipText } from "./sanitize.js";
import { homePath, tokenPath, walletPath } from "./paths.js";
import { ApiError, fetchJson, fetchSolanaFeed, fetchTokenPairs, fetchTokenDetail, fetchRugcheck } from "./api.js";
import { buildSearchResults, dexSearchUrl, jupiterSearchUrl, normalizeSearchQuery, MIN_NAME_QUERY } from "./search.js";
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
import { createCreatorCache, loadCreatorHistory, resolveCreator } from "./creator-scan.js";
import { mountSwap, jupiterSwapUrl, BUY_SOL_AMOUNTS } from "./swap.js";
import { LAUNCH_ENABLED, brandLabel, copyrightNotice } from "./config.js";
import { validateLaunch } from "./launch-form.js";
import { renderLaunch } from "./launch-ui.js";
import {
  clusterUrl,
  confirmSignature,
  forgetMint,
  loadSolana,
  prepareLaunch,
  uploadLaunchMetadata,
} from "./launch-tx.js";
import { connectLaunchWallet, listLaunchWallets } from "./wallet.js";
import { el, clear, externalLink } from "./dom.js";
import {
  renderHome,
  renderToken,
  renderHive,
  patchTokenMarket,
  patchTokenScore,
patchTokenCreator,
  renderWallet,
  renderSearchResults,
  renderSwapPanel,
  setHivePressed,
  updateQuotedStats,
} from "./render.js";

const EXAMPLE_CA = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const { storage, persistent } = detectStorage();
const hive = createHive(storage);
const recent = createRecent(storage);
const creatorCache = createCreatorCache(storage);
const stats = new Map();

const view = document.getElementById("view");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("ca-input");
const searchResultsEl = document.getElementById("search-results");
let searchTimer = 0;
let searchTicket = 0;
let searchAbort = new AbortController();
let searchState = { open: false, status: "", results: [], active: 0, query: "" };

let generation = 0;
let aborter = new AbortController();
let hiveTimer = 0;
let homeTimer = 0;
let hiveSort = { key: "added", dir: "desc" };
let lastForce = 0;
let lastHome = null;
let swapTicket = 0;
const swapView = { side: "buy", solAmount: null };
let creatorAbort = new AbortController();
let creatorTicket = 0;
let walletResult = null;
const creatorState = { ca: "", view: emptyCreator() };
const launchState = {
  cluster: "mainnet",
  step: "form",
  fields: {
    name: "",
    symbol: "",
    description: "",
    website: "",
    twitter: "",
    telegram: "",
    initialBuy: "0",
    metadataUri: "",
  },
  imageFile: null,
  errors: [],
  mainnetConfirmed: false,
  wallets: [],
  wallet: null,
  result: null,
  savedHive: false,
  message: "",
  busy: false,
  form: null,
};

const actions = {
  refreshHome,
  toggleHive,
  copyCa,
  copyLink,
  refreshToken,
  setSwapSide,
  setSwapSol,
  sortHive,
  setNote,
  removeHive,
  refreshHive,
  exportHive,
  importHive,
  clearRecent,
  lookupWallet,
  patchLaunch,
  setLaunchImage,
  reviewLaunch,
  editLaunch,
  patchLaunchFlag,
  refreshLaunchWallets,
  connectLaunch,
  signLaunch,
  addLaunchToHive,
};

boot();

function boot() {
  applyBrand();
  applyLaunchNav();
  normalizeHash();
  searchForm.addEventListener("submit", onSearch);
  searchInput.addEventListener("input", onSearchInput);
  searchInput.addEventListener("keydown", onSearchKey);
  document.addEventListener("pointerdown", onSearchPointer);
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

function applyBrand() {
  const brand = document.querySelector(".brand-name");
  if (brand) brand.textContent = brandLabel();
  const line = document.querySelector("[data-copyright]");
  if (line) line.textContent = copyrightNotice();
}

function applyLaunchNav() {
  if (LAUNCH_ENABLED) return;
  const link = document.querySelector("[data-nav='launch']");
  if (link) link.remove();
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
  closeSearch();
  const route = currentRoute();
  syncChrome(route);
  if (route.name !== "launch") launchState.wallet = null;
  if (route.name === "token") showToken(gen, route.ca);
  else if (route.name === "hive") showHive(gen);
  else if (route.name === "launch") showLaunch();
  else if (route.name === "wallet") showWallet(gen, route.wallet || "", route.error || "");
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
  const wallet = params.get("wallet");
  if (wallet != null && wallet !== "") {
    const trimmed = wallet.trim();
    if (isValidCA(trimmed)) return { name: "wallet", wallet: trimmed };
    return {
      name: "wallet",
      wallet: "",
      error: "That is not a Solana wallet address (base58, 32–44 characters).",
    };
  }
  if (params.get("view") === "hive") return { name: "hive" };
  if (params.get("view") === "launch") return { name: "launch" };
  if (params.get("view") === "wallet") return { name: "wallet", wallet: "" };
  return { name: "home" };
}

function syncChrome(route) {
  const home = document.querySelector("[data-nav='home']");
  const hiveLink = document.querySelector("[data-nav='hive']");
  const lookupLink = document.querySelector("[data-nav='lookup']");
  const launchLink = document.querySelector("[data-nav='launch']");
  setCurrent(home, route.name === "home");
  setCurrent(hiveLink, route.name === "hive");
  setCurrent(lookupLink, route.name === "wallet");
  setCurrent(launchLink, route.name === "launch");
  const count = hive.list().length;
  hiveLink.textContent = count ? `Hive (${count})` : "Hive";
  if (route.name === "home") document.title = "Honey Charts — Solana scanner";
  if (route.name === "hive") document.title = "Hive · Honey Charts";
  if (route.name === "launch") document.title = "Launch · Honey Charts";
  if (route.name === "wallet") document.title = "Check a wallet · Honey Charts";
  if (route.name === "token") document.title = "Token · Honey Charts";
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
swapView.side = "buy";
  swapView.solAmount = null;
  resetCreator(ca);
  const cached = stats.get(ca);
  let pair = cached && cached.pair ? cached.pair : null;
  renderToken(view, tokenModel(ca, {
    pair,
    dexStatus: pair ? "ready" : "loading",
    scoreStatus: "loading",
    score: null,
  }), actions);
  loadSwap(gen, ca);
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
  await loadTokenCreator(gen, ca, pair, report, reportError, false);
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
  await loadTokenCreator(gen, ca, pair, report, reportError, true);
}

function setSwapSide(side) {
  const route = currentRoute();
  if (route.name !== "token") return;
  if (side !== "buy" && side !== "sell") return;
  if (swapView.side === side) return;
  swapView.side = side;
  if (side !== "buy") swapView.solAmount = null;
  restartSwap(route.ca);
}

function setSwapSol(sol) {
  const route = currentRoute();
  if (route.name !== "token" || swapView.side !== "buy") return;
  if (!BUY_SOL_AMOUNTS.includes(sol) || swapView.solAmount === sol) return;
  swapView.solAmount = sol;
  restartSwap(route.ca);
}

function restartSwap(ca) {
  const node = view.querySelector("[data-region='swap']");
  if (!node) return;
  node.replaceWith(renderSwapPanel(ca, tokenModel(ca, {}), actions));
  loadSwap(generation, ca);
}

async function loadSwap(gen, ca) {
  const ticket = ++swapTicket;
  const status = view.querySelector("[data-swap-status]");
  const fallback = view.querySelector("[data-swap-fallback]");
  if (fallback) while (fallback.firstChild) fallback.removeChild(fallback.firstChild);
  if (status) status.textContent = "Loading Jupiter…";
  try {
    await mountSwap(ca, { side: swapView.side, solAmount: swapView.solAmount });
    if (ticket !== swapTicket || !alive(gen) || currentRoute().ca !== ca) return;
    const latest = view.querySelector("[data-swap-status]");
    if (latest) latest.textContent = "";
  } catch {
    if (ticket !== swapTicket || !alive(gen) || currentRoute().ca !== ca) return;
    const latest = view.querySelector("[data-swap-status]");
    if (latest) {
      latest.textContent = "Jupiter's trade form did not load in this browser. Use the link below. Honeycharts still does not touch your wallet.";
    }
    const slot = view.querySelector("[data-swap-fallback]");
    const href = jupiterSwapUrl(ca);
    if (slot && href && !slot.firstChild) slot.append(externalLink(href, "Swap on Jupiter", "text-link"));
  }
}

function showLaunch() {
  if (!LAUNCH_ENABLED) {
    launchState.wallet = null;
    clear(view);
    view.append(el("section", { className: "hero" }, [
      el("h1", { text: "Token launches are coming soon" }),
    ]));
    return;
  }
  renderLaunchView();
}

function renderLaunchView() {
  renderLaunch(view, launchState, actions);
}

function patchLaunch(id, value) {
  const key = {
    "launch-name": "name",
    "launch-symbol": "symbol",
    "launch-description": "description",
    "launch-website": "website",
    "launch-twitter": "twitter",
    "launch-telegram": "telegram",
    "launch-initial-buy": "initialBuy",
    "launch-metadata": "metadataUri",
  }[id];
  if (!key) return;
  launchState.fields[key] = value;
}

function setLaunchImage(file) {
  launchState.imageFile = file || null;
}

function reviewLaunch() {
  const parsed = validateLaunch(launchState.fields, launchState.imageFile);
  if (!parsed.ok) {
    launchState.errors = parsed.errors;
    launchState.step = "form";
    launchState.form = null;
    renderLaunchView();
    return;
  }
  launchState.errors = [];
  launchState.form = parsed.value;
  launchState.step = "review";
  launchState.wallet = null;
  launchState.message = "";
  launchState.wallets = listLaunchWallets();
  renderLaunchView();
}

function editLaunch() {
  launchState.step = "form";
  launchState.wallet = null;
  launchState.message = "";
  renderLaunchView();
}

function patchLaunchFlag(key) {
  if (key !== "mainnetConfirmed") return;
  launchState[key] = !launchState[key];
  renderLaunchView();
}

function refreshLaunchWallets() {
  launchState.wallets = listLaunchWallets();
  renderLaunchView();
}

async function connectLaunch(choice) {
  if (launchState.busy) return;
  launchState.busy = true;
  launchState.message = "";
  renderLaunchView();
  try {
    const choices = choice ? [choice] : listLaunchWallets();
    if (!choices.length) {
      launchState.message = "No Phantom or Solflare wallet was found. Install one of those extensions. Honeycharts will not ask you to paste a key.";
      return;
    }
    launchState.wallet = await connectLaunchWallet(choices[0], launchState.cluster);
  } catch (error) {
    launchState.wallet = null;
    launchState.message = launchErrorMessage(error);
  } finally {
    launchState.busy = false;
    if (currentRoute().name === "launch") renderLaunchView();
  }
}

async function signLaunch() {
  if (launchState.busy || !launchState.wallet || !launchState.form) return;
  if (!launchState.mainnetConfirmed) return;
  launchState.busy = true;
  launchState.message = "";
  renderLaunchView();
  let mint = null;
  try {
    const metadataUri = await uploadLaunchMetadata(launchState.form);
    const solana = await loadSolana();
    const connection = new solana.Connection(clusterUrl(), "confirmed");
    const prepared = await prepareLaunch({
      connection,
      payer: launchState.wallet.address,
      form: launchState.form,
      metadataUri,
    });
    mint = prepared.mint;
    const raw = await launchState.wallet.sign(prepared.transaction);
    const signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const latest = await connection.getLatestBlockhash("confirmed");
    await confirmSignature(connection, signature, latest.lastValidBlockHeight);
    launchState.result = {
      mint: prepared.mint.publicKey.toBase58(),
      signature,
    };
    launchState.savedHive = false;
    launchState.step = "done";
    launchState.message = "";
  } catch (error) {
    launchState.message = launchErrorMessage(error);
  } finally {
    forgetMint(mint);
    launchState.busy = false;
    if (currentRoute().name === "launch") renderLaunchView();
  }
}

function addLaunchToHive() {
  const result = launchState.result;
  const form = launchState.form;
  if (!result || !form || !isValidCA(result.mint)) return;
  hive.add(result.mint, form.name, form.symbol);
  launchState.savedHive = true;
  launchState.message = "Saved in this browser's Hive.";
  syncChrome(currentRoute());
  renderLaunchView();
}

function launchErrorMessage(error) {
  const text = error && typeof error.message === "string" ? error.message.replace(/[\u0000-\u001F\u007F]/g, "").trim() : "";
  if (/reject|cancel|denied/i.test(text)) return "The wallet closed the request. Nothing was created.";
  if (text && text.length <= 180) return text;
  return "The launch did not finish. Use a mainnet wallet, then try again.";
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
  const raw = searchInput.value;
  const ca = extractCA(raw);
  if (ca) {
    openToken(ca);
    return;
  }
  const query = normalizeSearchQuery(raw);
  if (query.length < MIN_NAME_QUERY) {
    setStatus("Paste one Solana contract address, or type at least 2 letters of a name or ticker.");
    return;
  }
  const picked = searchState.open && searchState.query === query ? searchState.results[searchState.active] : null;
  if (picked && isValidCA(picked.ca)) {
    openToken(picked.ca);
    return;
  }
  clearTimeout(searchTimer);
  runSearch(query).then(() => {
    const top = searchState.results[0];
    if (searchState.query === query && top && isValidCA(top.ca)) openToken(top.ca);
    else if (searchState.query === query) {
      setStatus("No Solana token matched that name. Paste a contract address if you have one.");
    }
  });
}

function onSearchInput() {
  clearTimeout(searchTimer);
  const raw = searchInput.value;
  if (extractCA(raw)) {
    closeSearch();
    return;
  }
  const query = normalizeSearchQuery(raw);
  if (query.length < MIN_NAME_QUERY) {
    closeSearch();
    return;
  }
  searchState = { open: true, status: "Searching…", results: [], active: 0, query };
  paintSearch();
  searchTimer = setTimeout(() => runSearch(query), 280);
}

function onSearchKey(event) {
  if (event.key === "Escape") {
    closeSearch();
    return;
  }
  if (!searchState.open || !searchState.results.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    searchState.active = Math.min(searchState.results.length - 1, searchState.active + 1);
    paintSearch();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    searchState.active = Math.max(0, searchState.active - 1);
    paintSearch();
  }
}

function onSearchPointer(event) {
  if (!searchState.open) return;
  const target = event.target;
  if (target instanceof Node && searchForm.contains(target)) return;
  closeSearch();
}

function openToken(ca) {
  closeSearch();
  searchInput.value = ca;
  history.pushState(null, "", tokenPath(location.pathname, ca));
  render();
}

function closeSearch() {
  clearTimeout(searchTimer);
  searchTicket += 1;
  searchAbort.abort();
  searchAbort = new AbortController();
  searchState = { open: false, status: "", results: [], active: 0, query: "" };
  paintSearch();
}

function paintSearch() {
  if (!searchResultsEl) return;
  renderSearchResults(searchResultsEl, {
    open: searchState.open,
    status: searchState.status,
    results: searchState.results,
    active: searchState.active,
    onPick: openToken,
  });
  const open = searchState.open && (searchState.status || searchState.results.length);
  searchInput.setAttribute("aria-expanded", open ? "true" : "false");
  if (open && searchState.results.length) {
    searchInput.setAttribute("aria-activedescendant", `search-opt-${searchState.active}`);
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

async function runSearch(query) {
  const ticket = ++searchTicket;
  searchAbort.abort();
  searchAbort = new AbortController();
  const signal = searchAbort.signal;
  const dexPromise = fetchSearch(dexSearchUrl(query), signal, 15000);
  const jupiterPromise = fetchSearch(jupiterSearchUrl(query), signal, 60000);
  let dexPayload = null;
  let dexFailed = false;
  try {
    dexPayload = await dexPromise;
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (ticket !== searchTicket) return;
    dexFailed = true;
  }
  if (ticket !== searchTicket) return;
  const first = buildSearchResults(dexPayload, null);
  if (first.length || dexFailed) publishSearch(query, first, dexFailed);
  try {
    const jupiterPayload = await jupiterPromise;
    if (ticket !== searchTicket) return;
    const merged = buildSearchResults(dexPayload, jupiterPayload);
    publishSearch(query, merged, dexFailed && !merged.length);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (ticket !== searchTicket) return;
    if (!first.length) publishSearch(query, [], dexFailed);
  }
}

async function fetchSearch(url, signal, ttl) {
  try {
    return await fetchJson(url, { ttl, signal });
  } catch (error) {
    if (error && error.name === "AbortError" && signal && !signal.aborted) {
      return fetchJson(url, { ttl, signal, force: true });
    }
    throw error;
  }
}

function publishSearch(query, results, failed) {
  let status = "";
  if (!results.length && failed) {
    status = "Name search did not load. Paste a contract address, or try again in a moment.";
  } else if (!results.length) {
    status = "No Solana token matched that name.";
  }
  const active = results.length ? Math.min(searchState.active, results.length - 1) : 0;
  searchState = { open: true, status, results, active, query };
  paintSearch();
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
swapSide: swapView.side,
    swapSol: swapView.solAmount,
    creator: creatorState.ca === ca ? creatorState.view : emptyCreator(),
    tokenHref: (mint) => tokenPath(location.pathname, mint),
    walletHref: (wallet) => walletPath(location.pathname, wallet),
    creatorHeading: "Deployer",
    creatorListOpen: false,
    shareHref: shareHref(
      (pair && pair.baseToken && pair.baseToken.symbol) || (fallback && fallback.symbol) || "",
      (pair && pair.baseToken && pair.baseToken.name) || (fallback && fallback.name) || "",
      pageUrl,
    ),
  };
}

function emptyCreator() {
  return {
    status: "loading",
    wallet: "",
    source: "",
    summary: null,
    notice: "",
    progress: "",
    error: "",
  };
}

function resetCreator(ca) {
  creatorState.ca = ca;
  creatorState.view = emptyCreator();
}

function nextCreatorSignal() {
  creatorAbort.abort();
  creatorAbort = new AbortController();
  const signal = creatorAbort.signal;
  const onPage = () => creatorAbort.abort();
  if (aborter.signal.aborted) creatorAbort.abort();
  else aborter.signal.addEventListener("abort", onPage, { once: true });
  return signal;
}

async function loadTokenCreator(gen, ca, pair, report, reportError, force) {
  const ticket = ++creatorTicket;
  const signal = nextCreatorSignal();
  const still = () => ticket === creatorTicket && alive(gen) && currentRoute().name === "token" && currentRoute().ca === ca;
  const dexStatus = pair ? "ready" : "empty";
  try {
    const resolved = await resolveCreator(ca, report, { signal });
    if (!still()) return;
    if (!resolved.wallet) {
      creatorState.view = {
        ...emptyCreator(),
        status: "missing",
        error: resolved.error === "rate" ? "The public Solana RPC rate-limited the deployer lookup." : "",
      };
      patchTokenCreator(view, tokenModel(ca, {
        pair,
        dexStatus,
        scoreStatus: "ready",
        score: buildHoneyScore(pair, report, { reportError }),
      }), actions);
      return;
    }
    creatorState.view = {
      ...emptyCreator(),
      status: "loading",
      wallet: resolved.wallet,
      source: resolved.source,
      progress: "Reading public Solana transactions…",
    };
    patchTokenCreator(view, tokenModel(ca, {
      pair,
      dexStatus,
      scoreStatus: "ready",
      score: buildHoneyScore(pair, report, { reportError }),
    }), actions);
    const knownPairs = new Map();
    if (pair) knownPairs.set(ca, pair);
    const history = await loadCreatorHistory(resolved.wallet, {
      signal,
      cache: creatorCache,
      force,
      focusMint: ca,
      ruggedByMint: report && report.rugged === true ? { [ca]: true } : {},
      knownPairs,
      onProgress(text) {
        if (!still()) return;
        const node = view.querySelector("[data-creator-progress]");
        if (node) node.textContent = text;
      },
    });
    if (!still()) return;
    creatorState.view = {
      status: history.ok ? "ready" : "error",
      wallet: resolved.wallet,
      source: resolved.source,
      summary: history.summary,
      notice: history.notice,
      progress: "",
      error: history.error,
    };
    const score = buildHoneyScore(pair, report, {
      reportError,
      creator: history.ok ? history.summary : null,
    });
    patchTokenCreator(view, tokenModel(ca, { pair, dexStatus, scoreStatus: "ready", score }), actions);
    patchTokenScore(view, { scoreStatus: "ready", score });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!still()) return;
    creatorState.view = {
      ...creatorState.view,
      status: "error",
      progress: "",
      error: "The deployer lookup did not finish. Nothing new was counted.",
    };
    patchTokenCreator(view, tokenModel(ca, {
      pair,
      dexStatus,
      scoreStatus: "ready",
      score: buildHoneyScore(pair, report, { reportError }),
    }), actions);
  }
}

async function showWallet(gen, wallet, routeError, force) {
  walletResult = walletResult && walletResult.wallet === wallet && !force ? walletResult : null;
  renderWallet(view, walletModel(wallet, routeError), actions);
  if (!wallet) return;
  if (walletResult && walletResult.wallet === wallet && !force) return;
  const ticket = ++creatorTicket;
  const signal = nextCreatorSignal();
  const still = () => ticket === creatorTicket && alive(gen) && currentRoute().name === "wallet" && currentRoute().wallet === wallet;
  try {
    const history = await loadCreatorHistory(wallet, {
      signal,
      cache: creatorCache,
      force: Boolean(force),
      onProgress(text) {
        if (!still()) return;
        const node = view.querySelector("[data-creator-progress]");
        if (node) node.textContent = text;
      },
    });
    if (!still()) return;
    walletResult = history;
    renderWallet(view, walletModel(wallet, routeError), actions);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!still()) return;
    walletResult = {
      ok: false,
      wallet,
      summary: null,
      notice: "",
      error: "The wallet lookup did not finish. Nothing was counted.",
    };
    renderWallet(view, walletModel(wallet, routeError), actions);
  }
}

function walletModel(wallet, routeError) {
  const history = walletResult && walletResult.wallet === wallet ? walletResult : null;
  return {
    wallet,
    routeError: routeError || "",
    creatorHeading: "Launch history",
    creatorListOpen: true,
    tokenHref: (mint) => tokenPath(location.pathname, mint),
    walletHref: null,
    creator: history ? {
      status: history.ok === false ? "error" : "ready",
      wallet,
      source: "history",
      summary: history.summary || null,
      notice: history.notice || "",
      progress: "",
      error: history.error || "",
    } : {
      status: wallet ? "loading" : "ready",
      wallet,
      source: wallet ? "history" : "",
      summary: null,
      notice: "",
      progress: wallet ? "Reading public Solana transactions…" : "",
      error: "",
    },
  };
}

function lookupWallet(raw) {
  const wallet = extractCA(typeof raw === "string" ? raw : "");
  if (!wallet) {
    setStatus("Paste one Solana wallet address. Base58, 32 to 44 characters.");
    return;
  }
  const route = currentRoute();
  if (route.name === "wallet" && route.wallet === wallet) {
    showWallet(generation, wallet, "", true);
    return;
  }
  walletResult = null;
  history.pushState(null, "", walletPath(location.pathname, wallet));
  render();
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
  document.title = symbol ? `${symbol} · Honey Charts` : "Token · Honey Charts";
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
