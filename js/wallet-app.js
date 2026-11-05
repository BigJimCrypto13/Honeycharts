// Account wallet controller. Keys stay in Privy. This file only sees public addresses.

import { HELIUS_API_KEY, PRIVY_APP_ID, PRIVY_CLIENT_ID, WALLET_ENABLED } from "./auth-config.js";
import { SOLANA_READ_RPC } from "./config.js";
import { jupiterWalletState } from "./wallet.js";
import {
  USDC_MINT,
  SOL_DECIMALS,
  addressFromScan,
  amountUsd,
  canCoverFee,
  encodeBase58,
  cleanVault,
  depositToastText,
  feeParts,
  formatTokenAmount,
  formatUsd,
  incomingDeltas,
  maxSolAfterFee,
  needsMoreSol,
  offlineTransfers,
  parseTokenAmount,
  preferExternal,
  readRpcUrl,
  readVault,
  sampleSnapshot,
  setPreferExternal,
  snapshotBalances,
  stablePrice,
  togglePark,
  withdrawAddressError,
  writeVault,
  wsUrlFor,
} from "./wallet-logic.js";
import { loadActivity, loadHoldings, loadTokenMeta, watchAccount } from "./wallet-rpc.js";
import { buildSend, destinationNeedsTokenAccount, rawTransaction, restoreTransaction } from "./wallet-tx.js";
import {
  assetChoices,
  closeWalletSheet,
  confirmLines,
  feeHint,
  paintDepositButton,
  renderWalletHome,
  showDepositToast,
  showWalletSheet,
} from "./wallet-ui.js";
import { safeTokenImageUrl } from "./sanitize.js";

export function startWallet(options) {
  const storage = options.storage;
  const state = blank();
  let pageRoot = null;
  let aborter = null;
  let pollTimer = 0;
  let unwatch = () => {};
  let bridgeMod = null;
  let bridgePromise = null;
  let toastTimer = 0;

  const actions = {
    openDeposit,
    openWithdraw,
    closeSheet,
    copyAddress,
    shareAddress,
    setGuide,
    setWithdrawAsset,
    setWithdrawAmount,
    setWithdrawTo,
    setMax,
    scanAddress,
    reviewWithdraw,
    backToWithdraw,
    confirmSend,
    saveCold,
    togglePark: park,
    takeOffline,
    exportWallet,
    buyWithCard,
    useExternal,
    lookupWallet: (value) => options.lookupWallet(value),
    openSignIn: () => options.openSignIn(),
    retry: () => syncSession(),
  };

  function blank() {
    return {
      mode: "offline",
      sheet: "",
      guideId: "robinhood",
      address: "",
      sol: 0n,
      tokens: [],
      activity: [],
      message: "",
      copied: false,
      withdrawAsset: "SOL",
      withdrawAmount: "",
      withdrawTo: "",
      withdrawError: "",
      confirm: null,
      busy: false,
      coldError: "",
      vaultMessage: "",
      sample: false,
      usingExternal: preferExternal(storage),
      meta: new Map(),
      loaded: false,
      seen: null,
    };
  }

  function configured() {
    return WALLET_ENABLED === true && typeof PRIVY_APP_ID === "string" && PRIVY_APP_ID.trim().length > 0;
  }

  function rpcUrl() {
    return readRpcUrl(SOLANA_READ_RPC, HELIUS_API_KEY);
  }

  function vault() {
    if (state.sample) {
      const sample = sampleSnapshot();
      return { coldAddress: sample.coldAddress, parked: sample.parked.slice() };
    }
    return readVault(storage);
  }

  function paint() {
    const slot = document.getElementById("wallet-slot");
    if (slot) paintDepositButton(slot, actions);
  }

  function onPage() {
    return Boolean(pageRoot && pageRoot.isConnected);
  }

  function render() {
    paint();
    const view = model();
    if (onPage()) renderWalletHome(pageRoot, view, actions);
    else if (state.sheet) showWalletSheet(view, actions);
    else closeWalletSheet();
  }

  function model() {
    const sample = state.sample ? sampleSnapshot() : null;
    const address = sample ? sample.address : state.address;
    const sol = sample ? sample.sol : state.sol;
    const solPrice = sample ? sample.solPrice : options.getSolPrice();
    const tokens = enrich(sample ? sample.tokens : state.tokens, sample);
    const activity = sample ? sample.activity : state.activity;
    const saved = sample ? { coldAddress: sample.coldAddress, parked: sample.parked } : vault();
    const solUsdValue = amountUsd(sol, SOL_DECIMALS, typeof solPrice === "number" ? solPrice : null);
    const priced = [solUsdValue, ...tokens.map((token) => token.usd)].filter((value) => typeof value === "number");
    const total = priced.length ? priced.reduce((sum, value) => sum + value, 0) : null;
    const asset = (sample ? sample.tokens : state.tokens).find((token) => token.mint === state.withdrawAsset);
    const parts = feeParts({
      tokenTransfer: state.withdrawAsset !== "SOL",
      destinationNeedsAccount: Boolean(state.confirm && state.confirm.needsAccount),
    });
    return {
      mode: sample ? "sample" : state.mode,
      sample: Boolean(sample),
      sheet: state.sheet,
      guideId: state.guideId,
      address,
      sol,
      solUsd: formatUsd(solUsdValue),
      totalUsd: formatUsd(total),
      tokens: tokens.map((token) => ({ ...token, parked: saved.parked.includes(token.mint) })),
      activity,
      coldAddress: saved.coldAddress,
      coldError: state.coldError,
      vaultMessage: state.vaultMessage,
      usingExternal: state.usingExternal,
      message: state.message,
      copied: state.copied,
      assets: assetChoices(tokens),
      withdrawAsset: state.withdrawAsset,
      withdrawAmount: state.withdrawAmount,
      withdrawTo: state.withdrawTo,
      withdrawError: state.withdrawError,
      busy: state.busy,
      feeHint: feeHint(parts),
      confirmTitle: state.confirm && state.confirm.offline ? "Take offline" : "Confirm send",
      confirmLines: state.confirm ? confirmLines({
        symbol: state.confirm.symbol,
        amountText: state.confirm.amountText,
        to: state.confirm.to,
        parts: state.confirm.parts || parts,
        offline: state.confirm.offline,
      }) : [],
    };
  }

  function enrich(tokens, sample) {
    return (tokens || []).map((token) => {
      const known = state.meta.get(token.mint);
      const symbol = token.symbol || (token.mint === USDC_MINT ? "USDC" : "") || (known && known.symbol) || "Token";
      const name = token.name || (known && known.name) || "";
      const image = token.image || (known && known.image) || "";
      const price = stablePrice(token.mint, known && known.price);
      const usd = typeof token.usd === "number"
        ? token.usd
        : amountUsd(token.amount, token.decimals, typeof price === "number" ? price : null);
      return {
        ...token,
        symbol,
        name,
        image: safeTokenImageUrl(image) || "",
        usd,
        usdText: formatUsd(usd),
      };
    });
  }

  function open(root, preview) {
    pageRoot = root;
    stopWatch();
    state.sample = Boolean(preview && preview.sample);
    state.message = "";
    state.sheet = "";
    state.confirm = null;
    if (state.sample) {
      state.mode = "sample";
      if (preview.sheet === "deposit") state.sheet = "deposit";
      if (preview.sheet === "hive") state.sheet = "hive";
      if (preview.sheet === "withdraw") {
        const sample = sampleSnapshot();
        state.withdrawAsset = "SOL";
        state.withdrawAmount = "0.25";
        state.withdrawTo = sample.coldAddress;
        state.confirm = {
          offline: false,
          symbol: "SOL",
          amountText: "0.25",
          to: sample.coldAddress,
          parts: feeParts(),
          needsAccount: false,
        };
        state.sheet = "confirm";
      }
      render();
      return;
    }
    if (!configured()) {
      state.mode = "offline";
      render();
      return;
    }
    syncSession();
  }

  function stop() {
    pageRoot = null;
    state.sheet = "";
    closeWalletSheet();
    stopWatch();
  }

  function stopWatch() {
    clearInterval(pollTimer);
    pollTimer = 0;
    unwatch();
    unwatch = () => {};
    if (aborter) aborter.abort();
    aborter = null;
  }

  async function syncSession() {
    paint();
    if (state.sample) return;
    if (!configured()) {
      state.mode = "offline";
      if (onPage()) render();
      return;
    }
    const token = options.accounts.accessToken ? options.accounts.accessToken() : "";
    if (!token) {
      state.address = "";
      state.loaded = false;
      state.mode = "signed-out";
      stopWatch();
      render();
      options.onWalletChange && options.onWalletChange();
      return;
    }
    state.mode = state.address ? "ready" : "loading";
    render();
    try {
      const mod = await ensureBridge();
      mod.setHoneySession(token);
      const wallet = await waitForAddress();
      if (!wallet) {
        state.mode = "error";
        state.message = friendly(bridgeMod && honeyError());
        render();
        return;
      }
      const changed = state.address !== wallet;
      state.address = wallet;
      state.mode = "ready";
      await refresh();
      if (changed && options.onWalletChange) options.onWalletChange();
    } catch (error) {
      state.mode = "error";
      state.message = friendly(error && error.message);
      render();
    }
  }

  function honeyError() {
    const api = bridgeMod && bridgeMod.honeyWalletApi && bridgeMod.honeyWalletApi();
    return api && api.error;
  }

  async function ensureBridge() {
    if (bridgeMod) return bridgeMod;
    if (!bridgePromise) {
      bridgePromise = import("../vendor/privy-bridge.js").then(async (mod) => {
        const url = rpcUrl();
        await mod.startHoneyPrivy({
          appId: PRIVY_APP_ID.trim(),
          clientId: typeof PRIVY_CLIENT_ID === "string" ? PRIVY_CLIENT_ID.trim() : "",
          rpcUrl: url,
          wsUrl: wsUrlFor(url) || "wss://solana-rpc.publicnode.com",
        });
        bridgeMod = mod;
        return mod;
      });
    }
    return bridgePromise;
  }

  async function waitForAddress() {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const api = bridgeMod.honeyWalletApi();
      if (api.wallet && api.wallet.address) return api.wallet.address;
      if (api.error && api.ready) return "";
      await delay(300);
    }
    return "";
  }

  async function refresh() {
    if (!state.address || state.sample) return;
    stopWatch();
    const signal = nextSignal();
    try {
      const holdings = await loadHoldings(rpcUrl(), state.address, signal);
      if (signal.aborted) return;
      const next = snapshotBalances(holdings.sol, holdings.tokens);
      const events = state.seen ? incomingDeltas(state.seen, next) : [];
      state.sol = holdings.sol;
      state.tokens = holdings.tokens;
      state.loaded = true;
      state.seen = next;
      try {
        state.meta = await loadTokenMeta(holdings.tokens.map((token) => token.mint), signal);
      } catch {
        // Prices are optional.
      }
      try {
        state.activity = await loadActivity(rpcUrl(), state.address, signal);
      } catch {
        state.activity = state.activity || [];
      }
      if (signal.aborted) return;
      render();
      if (events.length) celebrate(events[0]);
      armWatch();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      state.message = "Balances are catching up. Try Refresh in a moment.";
      render();
    }
  }

  function armWatch() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => refresh(), 12000);
    const url = wsUrlFor(rpcUrl());
    unwatch = watchAccount(url, state.address, () => refresh());
  }

  function nextSignal() {
    if (aborter) aborter.abort();
    aborter = new AbortController();
    return aborter.signal;
  }

  function celebrate(event) {
    const text = depositToastText(event);
    if (!text) return;
    const balance = `New balance: ${formatTokenAmount(state.sol, SOL_DECIMALS)} SOL`;
    const toast = showDepositToast(text, balance);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 12000);
  }

  function openDeposit() {
    state.message = "";
    if (state.sample || (configured() && state.address)) {
      state.sheet = "deposit";
      state.copied = false;
      render();
      return;
    }
    if (configured() && !(options.accounts.accessToken && options.accounts.accessToken())) {
      options.openSignIn();
      return;
    }
    if (!onPage()) options.goWallet();
    else render();
  }

  function openWithdraw() {
    if (!(state.sample || state.address)) {
      openDeposit();
      return;
    }
    state.sheet = "withdraw";
    state.withdrawError = "";
    state.confirm = null;
    render();
  }

  function closeSheet() {
    state.sheet = "";
    state.busy = false;
    state.withdrawError = "";
    closeWalletSheet();
    if (onPage()) render();
  }

  async function copyAddress() {
    const address = model().address;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(address);
      state.copied = true;
    } catch {
      state.message = "Copy did not work in this browser. Select the address and copy it.";
    }
    render();
  }

  async function shareAddress() {
    const address = model().address;
    if (!navigator.share) {
      await copyAddress();
      return;
    }
    try {
      await navigator.share({ title: "Honey Charts Solana address", text: address });
    } catch {
      // The visitor dismissed the share sheet.
    }
  }

  function setGuide(id) {
    state.guideId = id;
    render();
  }

  function captureWithdraw() {
    const amount = document.getElementById("withdraw-amount");
    const to = document.getElementById("withdraw-to");
    const asset = document.getElementById("withdraw-asset");
    if (amount) state.withdrawAmount = amount.value;
    if (to) state.withdrawTo = to.value;
    if (asset) state.withdrawAsset = asset.value;
  }

  function setWithdrawAsset(value) {
    captureWithdraw();
    state.withdrawAsset = value;
    render();
  }

  function setWithdrawAmount(value) {
    state.withdrawAmount = value;
  }

  function setWithdrawTo(value) {
    state.withdrawTo = value;
  }

  function setMax() {
    captureWithdraw();
    if (state.withdrawAsset === "SOL") {
      const parts = feeParts();
      const max = maxSolAfterFee(currentSol(), parts.signature, parts.reserve);
      state.withdrawAmount = max > 0n ? formatTokenAmount(max, SOL_DECIMALS) : "";
      state.withdrawError = max > 0n ? "" : "Not enough SOL to cover the network fee.";
    } else {
      const token = currentToken(state.withdrawAsset);
      state.withdrawAmount = token ? formatTokenAmount(token.amount, token.decimals) : "";
      state.withdrawError = token ? "" : "That coin is not in this wallet.";
    }
    render();
  }

  async function scanAddress(file) {
    captureWithdraw();
    try {
      if (typeof BarcodeDetector === "undefined") {
        state.withdrawError = "This browser cannot scan a code. Paste the address.";
        render();
        return;
      }
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      const raw = codes && codes[0] && codes[0].rawValue;
      if (!raw) {
        state.withdrawError = "No QR code was found in that picture.";
        render();
        return;
      }
      state.withdrawTo = addressFromScan(raw);
      state.withdrawError = "";
    } catch {
      state.withdrawError = "That picture could not be read. Paste the address.";
    }
    render();
  }

  async function reviewWithdraw() {
    captureWithdraw();
    const own = model().address;
    const addressError = withdrawAddressError(state.withdrawTo, own);
    if (addressError) {
      state.withdrawError = addressError;
      state.sheet = "withdraw";
      render();
      return;
    }
    const token = state.withdrawAsset === "SOL" ? null : currentToken(state.withdrawAsset);
    const decimals = token ? token.decimals : SOL_DECIMALS;
    const amount = parseTokenAmount(state.withdrawAmount, decimals);
    if (!amount) {
      state.withdrawError = "Enter an amount greater than zero.";
      render();
      return;
    }
    let needsAccount = false;
    if (state.withdrawAsset !== "SOL" && !state.sample && token) {
      try {
        needsAccount = await destinationNeedsTokenAccount({
          rpcUrl: rpcUrl(),
          owner: state.withdrawTo.trim(),
          mint: token.mint,
          programId: token.programId,
        });
      } catch {
        needsAccount = true;
      }
    }
    const parts = feeParts({ tokenTransfer: state.withdrawAsset !== "SOL", destinationNeedsAccount: needsAccount });
    if (state.withdrawAsset === "SOL") {
      const max = maxSolAfterFee(currentSol(), parts.signature, parts.reserve);
      if (amount > max) {
        state.withdrawError = "That is more than Max. Max leaves the network fee and a little SOL.";
        render();
        return;
      }
    } else if (!token || amount > token.amount) {
      state.withdrawError = "That is more than this wallet holds.";
      render();
      return;
    } else if (!state.sample && !canCoverFee(currentSol(), parts)) {
      state.withdrawError = "Add SOL to pay the network fee.";
      render();
      return;
    }
    state.withdrawError = "";
    state.confirm = {
      offline: false,
      kind: state.withdrawAsset === "SOL" ? "sol" : "spl",
      mint: token ? token.mint : "",
      decimals,
      amount,
      symbol: token ? token.symbol : "SOL",
      amountText: formatTokenAmount(amount, decimals),
      to: state.withdrawTo.trim(),
      sourceAccount: token ? token.account : "",
      programId: token ? token.programId : "",
      parts,
      needsAccount,
    };
    state.sheet = "confirm";
    render();
  }

  function backToWithdraw() {
    state.sheet = "withdraw";
    state.busy = false;
    render();
  }

  async function confirmSend() {
    if (state.busy) return;
    if (state.sample) {
      state.withdrawError = "Sample only. Nothing was sent.";
      render();
      return;
    }
    if (state.confirm && state.confirm.offline) {
      await sendOffline();
      return;
    }
    const plan = state.confirm;
    if (!plan) return;
    state.busy = true;
    render();
    try {
      const built = await buildSend({
        rpcUrl: rpcUrl(),
        from: state.address,
        to: plan.to,
        kind: plan.kind,
        amount: plan.amount,
        mint: plan.mint,
        decimals: plan.decimals,
        sourceAccount: plan.sourceAccount,
        programId: plan.programId,
      });
      const mod = await ensureBridge();
      const signature = await mod.honeyWalletApi().send(built.bytes, `Send ${plan.amountText} ${plan.symbol}`);
      state.busy = false;
      state.sheet = "";
      state.message = signature ? "Sent. The balance updates when Solana confirms it." : "Sent.";
      closeWalletSheet();
      render();
      refresh();
    } catch (error) {
      state.busy = false;
      state.withdrawError = friendly(error && error.message) || "The send was not approved.";
      render();
    }
  }

  function saveCold(value) {
    if (state.sample) {
      state.vaultMessage = "Sample only. The cold address is not saved.";
      render();
      return;
    }
    const next = cleanVault({ ...vault(), coldAddress: value });
    if (String(value || "").trim() && !next.coldAddress) {
      state.coldError = "That is not a Solana address.";
      render();
      return;
    }
    state.coldError = "";
    writeVault(storage, next);
    render();
  }

  function park(mint) {
    if (state.sample) {
      state.vaultMessage = "Sample only. Park is already on for Bonk.";
      render();
      return;
    }
    writeVault(storage, togglePark(vault(), mint));
    render();
  }

  function takeOffline() {
    const saved = vault();
    if (!saved.coldAddress) {
      state.coldError = "Paste your hardware wallet address first.";
      state.sheet = "hive";
      render();
      return;
    }
    const rows = model().tokens.filter((token) => token.parked);
    const plan = offlineTransfers({ coldAddress: saved.coldAddress, parked: rows.map((token) => token.mint) }, rows);
    if (!plan.length) {
      state.vaultMessage = "Park a coin that has a balance, then take it offline.";
      state.sheet = "hive";
      render();
      return;
    }
    const first = plan[0];
    const parts = feeParts({ tokenTransfer: true, destinationNeedsAccount: true });
    state.confirm = {
      offline: true,
      transfers: plan,
      symbol: plan.length === 1 ? first.symbol : `${plan.length} coins`,
      amountText: plan.length === 1 ? formatTokenAmount(first.amount, first.decimals) : "parked",
      to: saved.coldAddress,
      parts,
    };
    state.sheet = "confirm";
    state.withdrawError = "";
    render();
  }

  async function sendOffline() {
    const plan = state.confirm;
    state.busy = true;
    render();
    try {
      const mod = await ensureBridge();
      for (const transfer of plan.transfers) {
        const built = await buildSend({
          rpcUrl: rpcUrl(),
          from: state.address,
          to: plan.to,
          kind: "spl",
          amount: transfer.amount,
          mint: transfer.mint,
          decimals: transfer.decimals,
          sourceAccount: transfer.account,
          programId: transfer.programId,
        });
        await mod.honeyWalletApi().send(
          built.bytes,
          `Take ${transfer.symbol} offline`,
        );
      }
      state.busy = false;
      state.sheet = "";
      state.vaultMessage = "Sent to your cold wallet. To trade again, send the coins back to your Honey Charts address on the Solana network.";
      closeWalletSheet();
      render();
      refresh();
    } catch (error) {
      state.busy = false;
      state.withdrawError = friendly(error && error.message) || "The send was not approved.";
      render();
    }
  }

  async function exportWallet() {
    if (state.sample || !configured()) return;
    try {
      const mod = await ensureBridge();
      await mod.honeyWalletApi().exportWallet();
    } catch (error) {
      state.message = friendly(error && error.message) || "Export did not open.";
      render();
    }
  }

  async function buyWithCard() {
    if (state.sample) {
      state.message = "Sample only. Nothing is charged.";
      render();
      return;
    }
    if (!state.address) return;
    try {
      const mod = await ensureBridge();
      await mod.honeyWalletApi().buyWithCard(state.address);
    } catch (error) {
      const text = error && error.message ? String(error.message) : "";
      if (/exit|cancel|closed/i.test(text)) return;
      state.message = "Card buying is not switched on for this wallet yet. You can still send SOL or USDC from any wallet on the Solana network.";
      render();
    }
  }

  function useExternal(on) {
    state.usingExternal = Boolean(on);
    setPreferExternal(storage, state.usingExternal);
    render();
    if (options.onWalletChange) options.onWalletChange();
  }

  function currentSol() {
    return state.sample ? sampleSnapshot().sol : state.sol;
  }

  function currentToken(mint) {
    const tokens = state.sample ? sampleSnapshot().tokens : state.tokens;
    return tokens.find((token) => token.mint === mint) || null;
  }

  async function jupiterState() {
    if (state.sample || state.usingExternal || !configured() || !state.address) return null;
    const solana = await options.loadSolana();
    let publicKey = null;
    try {
      publicKey = new solana.PublicKey(state.address);
    } catch {
      return null;
    }
    return jupiterWalletState({
      publicKey,
      approveOne: (tx) => approveOne(tx),
      sendRaw: (tx) => sendRaw(tx),
    });
  }

  async function approveOne(tx) {
    const bytes = rawTransaction(tx);
    if (!bytes) throw new Error("Jupiter did not hand over a transaction.");
    const mod = await ensureBridge();
    const signed = await mod.honeyWalletApi().signBytes(bytes, "Approve this swap in Privy.");
    return restoreTransaction(signed);
  }

  async function sendRaw(tx) {
    const bytes = rawTransaction(tx);
    if (!bytes) throw new Error("Jupiter did not hand over a transaction.");
    const mod = await ensureBridge();
    const signature = await mod.honeyWalletApi().send(bytes, "Approve this swap in Privy.");
    return encodeBase58(signature instanceof Uint8Array ? signature : new Uint8Array());
  }

  function hasHoney() {
    return configured() && Boolean(state.address) && !state.sample;
  }

  function usingHoney() {
    return hasHoney() && !state.usingExternal;
  }

  function solLamports() {
    if (!usingHoney() || !state.loaded) return null;
    return state.sol;
  }

  return {
    paint,
    open,
    stop,
    syncSession,
    jupiterState,
    usingHoney,
    hasHoney,
    solLamports,
    openDeposit,
    setExternal: useExternal,
  };
}

function friendly(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "The wallet could not finish that step.";
  if (/jwt|jwks|custom auth|unauthorized/i.test(text)) {
    return "The wallet could not link this sign-in yet. JWT authentication in Privy still needs to be turned on.";
  }
  if (text.length > 180) return "The wallet could not finish that step.";
  return text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function walletPreview(search) {
  const raw = typeof search === "string" ? search : "";
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const sheet = params.get("sheet");
  return {
    sample: params.get("sample") === "1" || params.get("sample") === "wallet",
    sheet: sheet === "deposit" || sheet === "withdraw" || sheet === "hive" ? sheet : "",
  };
}

