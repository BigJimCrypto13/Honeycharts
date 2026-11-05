// Wallet screens. Text is written as text. Sample numbers are labeled as sample.

import { el, clear, externalLink } from "./dom.js";
import { qrElement } from "./qr.js";
import { safeTokenImageUrl } from "./sanitize.js";
import {
  DEPOSIT_GUIDES,
  SOL_DECIMALS,
  USDC_MINT,
  activityWhen,
  feeParts,
  formatTokenAmount,
  formatUsd,
  shortAddress,
  spendLamports,
} from "./wallet-logic.js";

const SOL_IMAGE = "https://assets.coingecko.com/coins/images/4128/small/solana.png";

export function renderWalletHome(root, model, actions) {
  clear(root);
  const page = el("div", { className: "stack wallet-page", attrs: { "data-wallet-home": "true" } });
  if (model.sample) {
    page.append(el("p", {
      className: "banner sample-banner",
      text: "Sample data. This is not your wallet. Do not send coins to this address.",
    }));
  }
  page.append(hero(model, actions));
  if (model.mode === "offline") page.append(comingSoon());
  else if (model.mode === "signed-out") page.append(signedOut(actions));
  else if (model.mode === "loading") page.append(el("p", { className: "muted", text: "Opening your wallet…" }));
  else if (model.mode === "error") page.append(errorBlock(model, actions));
  else page.append(readyBody(model, actions));
  page.append(deployerLookup(actions));
  root.append(page);
  if (model.sheet) showWalletSheet(model, actions);
}

export function showDepositToast(eventText, balanceText) {
  const existing = document.querySelector("[data-deposit-toast]");
  if (existing) existing.remove();
  const toast = el("div", {
    className: "deposit-toast",
    attrs: { "data-deposit-toast": "true", role: "status" },
  });
  toast.append(el("div", { className: "honey-drip toast-drip", attrs: { "aria-hidden": "true" } }));
  toast.append(el("p", { className: "toast-title", text: eventText }));
  if (balanceText) toast.append(el("p", { text: balanceText }));
  toast.append(el("a", {
    className: "primary",
    text: "Buy your first coin",
    attrs: { href: "./" },
  }));
  document.body.append(toast);
  return toast;
}

function hero(model, actions) {
  const section = el("section", { className: "hero wallet-hero" });
  section.append(el("h1", { text: "Your wallet" }));
  section.append(el("p", {
    text: "A Solana wallet is created with your Honey Charts account. You approve every send in Privy's window. Honey Charts never holds the coins and never asks you to type a recovery phrase.",
  }));
  const row = el("div", { className: "wallet-actions" });
  row.append(el("button", {
    className: "primary deposit-btn",
    text: "Deposit",
    attrs: { type: "button" },
    on: { click: () => actions.openDeposit() },
  }));
  if (model.mode === "ready" || model.mode === "sample") {
    row.append(el("button", {
      className: "ghost",
      text: "Withdraw",
      attrs: { type: "button" },
      on: { click: () => actions.openWithdraw() },
    }));
  }
  section.append(row);
  return section;
}

function comingSoon() {
  const section = el("section", { className: "panel" });
  section.append(el("h2", { text: "Wallet coming online" }));
  section.append(el("p", {
    text: "The built-in wallet is switched off until its public app id is saved. When it turns on, your address appears here automatically after you join the hive. You can still connect Phantom, Solflare, or Backpack on a token page.",
  }));
  return section;
}

function signedOut(actions) {
  const section = el("section", { className: "panel" });
  section.append(el("h2", { text: "Join the hive to get your wallet" }));
  section.append(el("p", {
    text: "Create an account with email and a password, or sign in with Solana. The wallet is created with the account. There is no extra setup step.",
  }));
  section.append(el("button", {
    className: "primary",
    text: "Join the hive",
    attrs: { type: "button" },
    on: { click: () => actions.openSignIn() },
  }));
  return section;
}

function errorBlock(model, actions) {
  const section = el("section", { className: "panel" });
  section.append(el("p", { className: "banner", text: model.message || "The wallet did not open." }));
  section.append(el("button", {
    className: "ghost",
    text: "Try again",
    attrs: { type: "button" },
    on: { click: () => actions.retry() },
  }));
  return section;
}

function readyBody(model, actions) {
  const wrap = el("div", { className: "stack" });
  wrap.append(balanceCard(model));
  wrap.append(holdings(model, actions));
  wrap.append(hiveVault(model, actions));
  wrap.append(activity(model));
  wrap.append(walletTools(model, actions));
  return wrap;
}

function balanceCard(model) {
  const section = el("section", { className: "panel balance-card" });
  section.append(el("h2", { text: "Balance" }));
  const total = el("p", { className: "balance-total", text: model.totalUsd || "—" });
  section.append(total);
  section.append(el("p", { className: "fine", text: "Public prices. A coin without a price is left out of the total." }));
  return section;
}

function holdings(model, actions) {
  const section = el("section", { className: "panel", attrs: { "data-region": "balances" } });
  section.append(el("h2", { text: "Holdings" }));
  const list = el("ul", { className: "holding-list" });
  list.append(holdingRow({
    symbol: "SOL",
    name: "Solana",
    amount: formatTokenAmount(model.sol, SOL_DECIMALS),
    usd: model.solUsd,
    image: SOL_IMAGE,
    parked: false,
    mint: "",
  }, actions, false));
  for (const token of model.tokens) {
    list.append(holdingRow({
      symbol: token.symbol,
      name: token.name,
      amount: formatTokenAmount(token.amount, token.decimals),
      usd: token.usdText,
      image: token.image,
      parked: token.parked,
      mint: token.mint,
    }, actions, true));
  }
  section.append(list);
  if (!model.tokens.length) {
    section.append(el("p", { className: "fine", text: "USDC and other Solana coins you receive show up here." }));
  }
  return section;
}

function holdingRow(row, actions, canPark) {
  const item = el("li", { className: "holding-row" });
  item.append(tokenFace(row.image, row.symbol));
  const text = el("div", { className: "holding-copy" });
  text.append(el("p", { className: "holding-symbol", text: row.symbol }));
  text.append(el("p", { className: "fine", text: row.name || "" }));
  item.append(text);
  const value = el("div", { className: "holding-value" });
  value.append(el("p", { text: row.amount || "0" }));
  value.append(el("p", { className: "fine", text: row.usd || "" }));
  item.append(value);
  if (canPark) {
    item.append(el("button", {
      className: "ghost",
      text: row.parked ? "Parked" : "Park in Hive",
      attrs: { type: "button", "aria-pressed": row.parked ? "true" : "false" },
      on: { click: () => actions.togglePark(row.mint) },
    }));
  }
  return item;
}

function tokenFace(image, symbol) {
  const safe = safeTokenImageUrl(image);
  const wrap = el("span", { className: "token-face", attrs: { "aria-hidden": "true" } });
  if (!safe) {
    wrap.append(el("span", { className: "token-letter", text: (symbol || "?").slice(0, 1) }));
    return wrap;
  }
  const img = el("img", {
    attrs: { src: safe, alt: "", width: "40", height: "40" },
  });
  img.addEventListener("error", () => {
    const letter = el("span", { className: "token-letter", text: (symbol || "?").slice(0, 1) });
    img.replaceWith(letter);
  });
  wrap.append(img);
  return wrap;
}

function hiveVault(model, actions) {
  const section = el("section", {
    className: "panel hive-vault",
    attrs: { id: "hive-vault", "data-region": "hive-vault" },
  });
  section.append(el("h2", { text: "Hive" }));
  section.append(el("p", { className: "hive-tag", text: "Protect your colony" }));
  section.append(el("p", {
    text: "Park coins you want to keep. Take offline sends those coins to your own hardware or cold wallet. To trade again, send them back to your Honey Charts address on the Solana network.",
  }));
  const cold = el("label", { className: "field" });
  cold.append(el("span", { text: "Cold wallet address" }));
  const input = el("input", {
    attrs: {
      id: "cold-address",
      type: "text",
      maxlength: "64",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Paste your hardware wallet address",
      value: model.coldAddress || "",
    },
  });
  input.addEventListener("change", () => actions.saveCold(input.value));
  cold.append(input);
  section.append(cold);
  if (model.coldError) section.append(el("p", { className: "field-error", text: model.coldError }));
  const parked = model.tokens.filter((token) => token.parked);
  if (!parked.length) {
    section.append(el("p", { className: "fine", text: "No coins are parked yet. Park one from the list above." }));
  } else {
    const list = el("ul", { className: "holding-list" });
    for (const token of parked) {
      list.append(el("li", { className: "holding-row" }, [
        tokenFace(token.image, token.symbol),
        el("div", { className: "holding-copy" }, [
          el("p", { className: "holding-symbol", text: token.symbol }),
          el("p", { className: "fine", text: formatTokenAmount(token.amount, token.decimals) }),
        ]),
      ]));
    }
    section.append(list);
  }
  section.append(el("button", {
    className: "primary",
    text: "Take offline",
    attrs: { type: "button" },
    on: { click: () => actions.takeOffline() },
  }));
  if (model.vaultMessage) section.append(el("p", { className: "fine", text: model.vaultMessage }));
  return section;
}

function activity(model) {
  const section = el("section", { className: "panel", attrs: { "data-region": "activity" } });
  section.append(el("h2", { text: "Recent activity" }));
  if (!model.activity.length) {
    section.append(el("p", { className: "fine", text: "Incoming and outgoing transfers show up here." }));
    return section;
  }
  const list = el("ul", { className: "activity-list" });
  for (const row of model.activity) {
    const item = el("li", { className: `activity-row is-${row.direction}` });
    const dir = row.direction === "in" ? "Received" : "Sent";
    item.append(el("p", { text: `${dir} ${formatTokenAmount(row.amount, row.decimals)} ${row.symbol}` }));
    const meta = el("p", { className: "fine", text: activityWhen(row.when, Date.now()) });
    item.append(meta);
    if (row.signature && !row.signature.startsWith("sample")) {
      item.append(externalLink(
        `https://solscan.io/tx/${encodeURIComponent(row.signature)}`,
        "View transaction",
        "text-link",
      ));
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function walletTools(model, actions) {
  const section = el("section", { className: "panel" });
  section.append(el("h2", { text: "This wallet" }));
  section.append(el("p", { className: "ca", text: model.address }));
  const row = el("div", { className: "wallet-actions" });
  row.append(el("button", {
    className: "ghost",
    text: model.usingExternal ? "Use Honey Charts wallet for trades" : "Use Phantom, Solflare, or Backpack instead",
    attrs: { type: "button" },
    on: { click: () => actions.useExternal(!model.usingExternal) },
  }));
  if (!model.sample) {
    row.append(el("button", {
      className: "ghost",
      text: "Export wallet",
      attrs: { type: "button" },
      on: { click: () => actions.exportWallet() },
    }));
  }
  section.append(row);
  section.append(el("p", {
    className: "fine",
    text: "Export opens Privy's own window. Honey Charts never reads what it shows. Phantom, Solflare, and Backpack still connect inside Jupiter when you choose them.",
  }));
  if (model.message) section.append(el("p", { className: "banner", text: model.message }));
  return section;
}

function deployerLookup(actions) {
  const details = el("details", { className: "panel" });
  details.append(el("summary", { text: "Check a deployer wallet" }));
  details.append(el("p", {
    className: "fine",
    text: "This lookup reads public history. It does not connect a wallet or move coins.",
  }));
  const form = el("form", { className: "search wallet-form" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    actions.lookupWallet(input ? input.value : "");
  });
  form.append(el("label", { attrs: { for: "wallet-input" }, text: "Solana wallet address" }));
  const row = el("div", { className: "search-row" });
  row.append(el("input", {
    attrs: {
      id: "wallet-input",
      type: "text",
      maxlength: "200",
      placeholder: "Paste a wallet address",
      autocomplete: "off",
      spellcheck: "false",
    },
  }));
  row.append(el("button", { className: "primary", text: "Check wallet", attrs: { type: "submit" } }));
  form.append(row);
  details.append(form);
  return details;
}

export function showWalletSheet(model, actions) {
  const existing = document.querySelector("[data-wallet-sheet]");
  if (existing) existing.remove();
  const dialog = el("dialog", {
    className: "account-dialog wallet-dialog",
    attrs: { "data-wallet-sheet": model.sheet },
  });
  const card = el("div", { className: "account-card" });
  card.append(el("button", {
    className: "ghost sheet-close",
    text: "Close",
    attrs: { type: "button" },
    on: { click: () => actions.closeSheet() },
  }));
  if (model.sheet === "deposit") card.append(depositSheet(model, actions));
  else if (model.sheet === "withdraw") card.append(withdrawSheet(model, actions));
  else if (model.sheet === "confirm") card.append(confirmSheet(model, actions));
  else if (model.sheet === "hive") card.append(hiveSheet(model, actions));
  dialog.append(card);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    actions.closeSheet();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) actions.closeSheet();
  });
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  const focus = dialog.querySelector("button, input");
  if (focus) focus.focus();
}

export function closeWalletSheet() {
  const dialog = document.querySelector("[data-wallet-sheet]");
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  dialog.remove();
}

function depositSheet(model, actions) {
  const body = el("div", { className: "deposit-sheet" });
  body.append(el("h2", { text: "Deposit" }));
  body.append(el("p", { className: "deposit-network", text: "Send SOL or USDC on the Solana network." }));
  body.append(el("p", {
    className: "fine",
    text: "Send on the Solana network only. Coins sent on another network are not recoverable by Honey Charts.",
  }));
  if (model.address) {
    const qr = el("div", { className: "qr-wrap" });
    qr.append(qrElement(model.address));
    body.append(qr);
    body.append(el("p", { className: "ca deposit-address", text: model.address }));
    const row = el("div", { className: "wallet-actions" });
    row.append(el("button", {
      className: "primary",
      text: model.copied ? "Copied" : "Copy",
      attrs: { type: "button" },
      on: { click: () => actions.copyAddress() },
    }));
    row.append(el("button", {
      className: "ghost",
      text: "Share",
      attrs: { type: "button" },
      on: { click: () => actions.shareAddress() },
    }));
    body.append(row);
    body.append(el("p", { className: "waiting", text: "Waiting for your deposit…" }));
  }
  body.append(guideTabs(model, actions));
  body.append(el("button", {
    className: "ghost",
    text: "Buy with card",
    attrs: { type: "button" },
    on: { click: () => actions.buyWithCard() },
  }));
  body.append(el("p", {
    className: "fine",
    text: "The card company shows its fee before you pay. Honey Charts does not add a fee. Apple Pay appears when that company offers it. No card secret is stored on this site.",
  }));
  if (model.message) body.append(el("p", { className: "banner", text: model.message }));
  return body;
}

function guideTabs(model, actions) {
  const wrap = el("div", { className: "guide-tabs" });
  const tabs = el("div", { className: "amount-row", attrs: { role: "tablist" } });
  for (const guide of DEPOSIT_GUIDES) {
    tabs.append(el("button", {
      className: "ghost",
      text: guide.label,
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": model.guideId === guide.id ? "true" : "false",
      },
      on: { click: () => actions.setGuide(guide.id) },
    }));
  }
  wrap.append(tabs);
  const guide = DEPOSIT_GUIDES.find((item) => item.id === model.guideId) || DEPOSIT_GUIDES[0];
  const steps = el("ol", { className: "guide-steps" });
  for (const step of guide.steps) steps.append(el("li", { text: step }));
  wrap.append(steps);
  return wrap;
}

function withdrawSheet(model, actions) {
  const body = el("div", { className: "withdraw-sheet" });
  body.append(el("h2", { text: "Withdraw" }));
  body.append(el("p", { className: "fine", text: "Paste or scan any Solana address. You confirm again in Privy's window." }));
  const asset = el("label", { className: "field" });
  asset.append(el("span", { text: "Coin" }));
  const select = el("select", { attrs: { id: "withdraw-asset" } });
  for (const choice of model.assets) {
    const option = el("option", { text: choice.label, attrs: { value: choice.id } });
    if (choice.id === model.withdrawAsset) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => actions.setWithdrawAsset(select.value));
  asset.append(select);
  body.append(asset);
  const amount = el("label", { className: "field" });
  amount.append(el("span", { text: "Amount" }));
  const amountRow = el("div", { className: "search-row" });
  const input = el("input", {
    attrs: {
      id: "withdraw-amount",
      type: "text",
      inputmode: "decimal",
      maxlength: "32",
      autocomplete: "off",
      spellcheck: "false",
      value: model.withdrawAmount || "",
    },
  });
  input.addEventListener("input", () => actions.setWithdrawAmount(input.value));
  amountRow.append(input);
  amountRow.append(el("button", {
    className: "ghost",
    text: "Max",
    attrs: { type: "button" },
    on: { click: () => actions.setMax() },
  }));
  amount.append(amountRow);
  body.append(amount);
  const dest = el("label", { className: "field" });
  dest.append(el("span", { text: "Solana address" }));
  const destRow = el("div", { className: "search-row" });
  const destInput = el("input", {
    attrs: {
      id: "withdraw-to",
      type: "text",
      maxlength: "120",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Paste an address",
      value: model.withdrawTo || "",
    },
  });
  destInput.addEventListener("input", () => actions.setWithdrawTo(destInput.value));
  destRow.append(destInput);
  const file = el("input", {
    attrs: { type: "file", accept: "image/*", id: "withdraw-scan", "aria-label": "Scan a QR code" },
  });
  file.addEventListener("change", () => {
    const picked = file.files && file.files[0];
    if (picked) actions.scanAddress(picked);
  });
  destRow.append(el("label", { className: "ghost file-btn", attrs: { for: "withdraw-scan" }, text: "Scan" }));
  destRow.append(file);
  dest.append(destRow);
  body.append(dest);
  if (model.withdrawError) body.append(el("p", { className: "field-error", text: model.withdrawError }));
  body.append(el("p", { className: "fine", text: model.feeHint || "Network fee is shown on the next screen." }));
  body.append(el("button", {
    className: "primary",
    text: "Review",
    attrs: { type: "button" },
    on: { click: () => actions.reviewWithdraw() },
  }));
  return body;
}

function confirmSheet(model, actions) {
  const body = el("div", { className: "confirm-sheet", attrs: { "data-region": "withdraw-confirm" } });
  body.append(el("h2", { text: model.confirmTitle || "Confirm send" }));
  for (const line of model.confirmLines || []) {
    body.append(el("p", { text: line }));
  }
  body.append(el("p", {
    className: "fine",
    text: "The next window is Privy's. Honey Charts cannot send this by itself.",
  }));
  if (model.withdrawError) body.append(el("p", { className: "field-error", text: model.withdrawError }));
  const row = el("div", { className: "wallet-actions" });
  row.append(el("button", {
    className: "ghost",
    text: "Back",
    attrs: { type: "button" },
    on: { click: () => actions.backToWithdraw() },
  }));
  row.append(el("button", {
    className: "primary",
    text: model.busy ? "Waiting for approval…" : "Confirm",
    attrs: { type: "button", disabled: model.busy ? "true" : null },
    on: { click: () => actions.confirmSend() },
  }));
  body.append(row);
  return body;
}

function hiveSheet(model, actions) {
  const body = el("div");
  body.append(hiveVault(model, actions));
  return body;
}

export function paintDepositButton(slot, actions) {
  clear(slot);
  slot.append(el("button", {
    className: "primary deposit-btn",
    text: "Deposit",
    attrs: { type: "button" },
    on: { click: () => actions.openDeposit() },
  }));
}

export function feeHint(parts) {
  const bits = [`Network fee about ${formatTokenAmount(parts.signature, SOL_DECIMALS)} SOL.`];
  if (parts.accountRent > 0n) {
    bits.push(`A new token account adds about ${formatTokenAmount(parts.accountRent, SOL_DECIMALS)} SOL.`);
  }
  bits.push("Max leaves that fee plus a little SOL so this wallet can pay the next one.");
  return bits.join(" ");
}

export function confirmLines({ symbol, amountText, to, parts, offline }) {
  const lines = [
    offline ? `Take offline ${amountText} ${symbol}` : `Send ${amountText} ${symbol}`,
    `To ${to}`,
    `Network fee about ${formatTokenAmount(spendLamports(parts), SOL_DECIMALS)} SOL`,
    "Network: Solana",
  ];
  return lines;
}

export function assetChoices(tokens) {
  const choices = [{ id: "SOL", label: "SOL" }];
  for (const token of tokens || []) {
    if (token.mint === USDC_MINT) choices.push({ id: token.mint, label: "USDC" });
  }
  for (const token of tokens || []) {
    if (token.mint === USDC_MINT) continue;
    choices.push({ id: token.mint, label: token.symbol || shortAddress(token.mint) });
  }
  return choices;
}

export { feeParts };
