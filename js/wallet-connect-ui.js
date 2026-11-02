// Always-visible Phantom and Solflare choices. A missing wallet links to the
// install page, or on a phone opens that wallet's browser. This file does
// not sign a transaction and does not read a wallet secret.

import {
  connectChoices,
  headerWalletNote,
  isLikelyMobile,
  previewForcesPhone,
} from "./account-logic.js";
import { listLoginWallets } from "./auth-wallet.js";
import { el } from "./dom.js";
import { listLaunchWallets } from "./wallet.js";

export function walletEnvironment() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const mobile = isLikelyMobile(ua) || (typeof location !== "undefined" && previewForcesPhone(location));
  const pageUrl = typeof location !== "undefined" ? location.href : "";
  return { mobile, pageUrl };
}

export function accountConnectPlan() {
  return connectChoices(listLoginWallets().map((item) => item.name), walletEnvironment());
}

export function launchConnectPlan() {
  return connectChoices(listLaunchWallets().map((item) => item.name), walletEnvironment());
}

export function renderAccountWallets(options) {
  const plan = options.plan || accountConnectPlan();
  const block = el("div", { className: "account-solana", attrs: { id: "wallet-connect" } });
  block.append(el("h3", { text: "Connect wallet" }));
  block.append(el("p", {
    className: "fine",
    text: "Sign in with Solana only signs a login message. It does not send a transaction or move tokens. Honey Charts never asks for a wallet secret.",
  }));
  for (const choice of plan.brands) block.append(accountChoice(choice, options));
  for (const choice of plan.extras) block.append(accountChoice(choice, options));
  if (plan.brands.some((item) => item.action === "install") && options.onEmail) {
    block.append(el("button", {
      className: "ghost",
      text: "Create account with email",
      attrs: { type: "button" },
      on: { click: () => options.onEmail() },
    }));
  }
  return block;
}

export function renderHeaderWallets(onReady) {
  const plan = accountConnectPlan();
  const wrap = el("div", { className: "header-wallets" });
  const row = el("div", { className: "header-account-row" });
  for (const choice of [...plan.brands, ...plan.extras]) row.append(headerChoice(choice, onReady));
  wrap.append(row);
  const note = headerWalletNote(plan);
  if (note) wrap.append(el("p", { className: "fine header-wallet-note", text: note }));
  return wrap;
}

export function renderLaunchWallets(options) {
  const plan = launchConnectPlan();
  const detected = Array.isArray(options.wallets) ? options.wallets : [];
  const block = el("div", { className: "account-solana" });
  block.append(el("h3", { text: "Connect wallet" }));
  block.append(el("p", {
    className: "fine",
    text: "Phantom or Solflare only. You sign the launch in that wallet. Honeycharts never sees your keys.",
  }));
  for (const choice of plan.brands) {
    if (choice.action === "sign-in") {
      const match = detected.find((item) => item && item.name && item.name.toLowerCase().includes(choice.id));
      const button = el("button", {
        className: "primary",
        text: options.busy ? "Waiting for your wallet…" : `Connect ${choice.name} to launch`,
        attrs: { type: "button" },
        on: { click: () => options.onConnect && options.onConnect(match || null) },
      });
      if (options.busy) button.disabled = true;
      block.append(button);
      continue;
    }
    block.append(linkChoice(choice, `Connect ${choice.name}`));
  }
  if (plan.brands.some((item) => item.action !== "sign-in") && options.onEmail) {
    block.append(el("button", {
      className: "ghost",
      text: "Create account with email",
      attrs: { type: "button" },
      on: { click: () => options.onEmail() },
    }));
  }
  return block;
}

export function renderTradeWallets(options) {
  const plan = accountConnectPlan();
  const block = el("div", { className: "account-solana trade-wallets" });
  block.append(el("h3", { text: "Connect wallet" }));
  block.append(el("p", {
    className: "fine",
    text: "A swap is approved in your wallet, inside Jupiter. Honey Charts never sees your keys.",
  }));
  for (const choice of [...plan.brands, ...plan.extras]) {
    if (choice.action === "sign-in") {
      block.append(el("button", {
        className: "primary",
        text: `Connect ${choice.name}`,
        attrs: { type: "button" },
        on: {
          click: () => options.onInstalled && options.onInstalled(choice),
        },
      }));
      block.append(el("p", {
        className: "fine",
        text: `${choice.name} is in this browser. Use Connect inside the Jupiter form. Honey Charts does not take your wallet.`,
      }));
      continue;
    }
    const label = choice.action === "browse" ? `Open in ${choice.name}` : `Connect ${choice.name}`;
    block.append(linkChoice(choice, label));
  }
  if (plan.brands.some((item) => item.action !== "sign-in") && options.onEmail) {
    block.append(el("button", {
      className: "ghost",
      text: "Create account with email",
      attrs: { type: "button" },
      on: { click: () => options.onEmail() },
    }));
  }
  return block;
}

function accountChoice(choice, options) {
  const label = `Sign in with ${choice.name}`;
  if (choice.action === "sign-in") {
    return el("button", {
      className: "primary",
      text: label,
      attrs: { type: "button" },
      on: { click: () => options.onReady && options.onReady(choice) },
    });
  }
  return linkChoice(choice, label);
}

function headerChoice(choice, onReady) {
  const label = `Sign in with ${choice.name}`;
  const node = choice.action === "sign-in"
    ? el("button", {
      className: "ghost header-wallet",
      attrs: { type: "button", "aria-label": label },
      on: { click: () => onReady && onReady(choice) },
    })
    : el("a", {
      className: "ghost header-wallet",
      attrs: choice.action === "browse"
        ? { href: choice.href, "aria-label": label }
        : { href: choice.href, target: "_blank", rel: "noopener noreferrer", "aria-label": label },
    });
  node.append(el("span", { className: "wallet-long", text: label }));
  node.append(el("span", { className: "wallet-short", text: choice.name }));
  return node;
}

function linkChoice(choice, text) {
  const wrap = el("div", { className: "wallet-choice" });
  const attrs = choice.action === "browse"
    ? { href: choice.href }
    : { href: choice.href, target: "_blank", rel: "noopener noreferrer" };
  wrap.append(el("a", { className: "primary", text, attrs }));
  if (choice.note) wrap.append(el("p", { className: "fine", text: choice.note }));
  return wrap;
}
