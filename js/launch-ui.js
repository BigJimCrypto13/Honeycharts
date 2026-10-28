import { el } from "./dom.js";
import { launchFeeConfig } from "./config.js";
import { describeLaunch, imageDownloadName } from "./launch-form.js";
import { PUMP_PRIORITY_FEE_SOL } from "./launch-tx.js";
import { tokenPath } from "./paths.js";
import { safeHttpUrl } from "./sanitize.js";

export function renderLaunch(root, state, actions) {
  root.replaceChildren();
  const page = el("div", { className: "stack launch" });
  page.append(el("section", { className: "hero" }, [
    el("h1", { text: "Launch a token" }),
    el("p", {
      text: "Name, ticker, image, and description. One signature creates a Pump.fun bonding-curve token that can be traded immediately on mainnet.",
    }),
  ]));
  page.append(el("p", {
    className: "disclaimer",
    text: "You are the creator. Honeycharts does not endorse the token, hold your keys, or custody funds. A bonding curve can go to zero. This spends real SOL on mainnet. Not financial advice, DYOR.",
  }));
  page.append(feeNotice());
  if (state.message) page.append(el("p", { className: "banner", text: state.message }));
  if (state.errors && state.errors.length) {
    const list = el("ul", { className: "errors" });
    for (const error of state.errors) list.append(el("li", { text: error }));
    page.append(list);
  }
  if (state.step === "done" && state.result) page.append(donePanel(state, actions));
  else if (state.step === "review" && state.form) page.append(reviewPanel(state, actions));
  else page.append(formPanel(state, actions));
  root.append(page);
}

function feeNotice() {
  const fee = launchFeeConfig();
  if (!fee) return el("p", { className: "fine", text: "No launch fee is configured." });
  return el("p", {
    className: "fee-note",
    text: `Includes ${fee.sol} SOL Honeycharts launch fee`,
  });
}

function formPanel(state, actions) {
  const form = el("form", {
    className: "panel stack",
    attrs: { id: "launch-form" },
    on: { submit: (event) => { event.preventDefault(); actions.reviewLaunch(); } },
  });
  form.append(el("h2", { text: "Token details" }));
  form.append(el("p", {
    className: "fine",
    text: "Mainnet only. Pump.fun sets the supply and the bonding curve. You do not add a liquidity pool yourself.",
  }));
  form.append(textField("Name", "launch-name", state.fields.name, { maxlength: "32", required: "required" }, actions));
  form.append(textField("Ticker", "launch-symbol", state.fields.symbol, { maxlength: "10", required: "required", autocapitalize: "characters" }, actions));
  form.append(fileField(state, actions));
  form.append(areaField("Description", "launch-description", state.fields.description, actions));
  form.append(textField("Initial buy (SOL)", "launch-initial-buy", state.fields.initialBuy, { inputmode: "decimal", maxlength: "12" }, actions));
  form.append(el("p", { className: "fine", text: "Default is 0. You can buy up to 10 SOL of the new token in the launch transaction." }));
  form.append(textField("Metadata link (optional)", "launch-metadata", state.fields.metadataUri, { type: "url", placeholder: "https://…" }, actions));
  form.append(el("p", {
    className: "fine",
    text: "Leave this empty and the image is uploaded for you. No API key. Pump.fun's uploader is tried first. If it is blocked, the file is stored for up to 72 hours. Paste your own https metadata link if the image must last longer.",
  }));
  form.append(textField("Website", "launch-website", state.fields.website, { type: "url", placeholder: "https://…" }, actions));
  form.append(textField("X", "launch-twitter", state.fields.twitter, { type: "url", placeholder: "https://x.com/…" }, actions));
  form.append(textField("Telegram", "launch-telegram", state.fields.telegram, { type: "url", placeholder: "https://t.me/…" }, actions));
  form.append(el("button", { className: "primary", text: "Review launch", attrs: { type: "submit" } }));
  return form;
}

function textField(label, id, value, attrs, actions) {
  const wrap = el("label", { className: "field", attrs: { for: id } });
  wrap.append(el("span", { text: label }));
  wrap.append(el("input", {
    attrs: { id, name: id, type: "text", value: value || "", ...attrs },
    on: { input: (event) => actions.patchLaunch(id, event.currentTarget.value) },
  }));
  return wrap;
}

function areaField(label, id, value, actions) {
  const wrap = el("label", { className: "field", attrs: { for: id } });
  wrap.append(el("span", { text: label }));
  const area = el("textarea", {
    attrs: { id, name: id, maxlength: "500", rows: "3" },
    on: { input: (event) => actions.patchLaunch(id, event.currentTarget.value) },
  });
  area.value = value || "";
  wrap.append(area);
  return wrap;
}

function fileField(state, actions) {
  const wrap = el("label", { className: "field", attrs: { for: "launch-image-file" } });
  wrap.append(el("span", { text: "Image" }));
  wrap.append(el("input", {
    attrs: { id: "launch-image-file", type: "file", accept: "image/png,image/jpeg,image/gif,image/webp" },
    on: {
      change: (event) => {
        const file = event.currentTarget.files && event.currentTarget.files[0];
        actions.setLaunchImage(file);
        const caption = event.currentTarget.parentElement.querySelector(".fine");
        if (caption) {
          caption.textContent = file
            ? `Selected ${imageDownloadName(file)}. It is uploaded only when you sign.`
            : "PNG, JPEG, GIF, or WebP, 1 MB or smaller.";
        }
      },
    },
  }));
  wrap.append(el("span", {
    className: "fine",
    text: state.imageFile
      ? `Selected ${imageDownloadName(state.imageFile)}. It is uploaded when you sign, unless you pasted a metadata link.`
      : "PNG, JPEG, GIF, or WebP, 1 MB or smaller.",
  }));
  return wrap;
}

function reviewPanel(state, actions) {
  const form = state.form;
  const fee = launchFeeConfig();
  const panel = el("section", { className: "panel stack" });
  panel.append(el("h2", { text: "Review before signing" }));
  panel.append(el("p", { text: `${form.name} (${form.symbol}) on mainnet.` }));
  const list = el("ul", { className: "review-list" });
  for (const line of describeLaunch(form, fee)) list.append(el("li", { text: line }));
  panel.append(list);
  panel.append(costBlock(form, fee));
  panel.append(check(
    "I understand this creates a live mainnet token and spends real SOL",
    "launch-mainnet-ok",
    state.mainnetConfirmed,
    "Required before you can sign.",
    () => actions.patchLaunchFlag("mainnetConfirmed"),
  ));
  if (state.wallet) {
    panel.append(el("p", { text: `Connected with ${state.wallet.name}: ${state.wallet.address}` }));
    const sign = el("button", {
      className: "primary",
      text: state.busy ? "Waiting for your wallet…" : "Sign and launch",
      attrs: { type: "button" },
      on: { click: () => actions.signLaunch() },
    });
    if (state.busy || !state.mainnetConfirmed) sign.disabled = true;
    panel.append(sign);
  } else {
    const wallets = state.wallets || [];
    if (!wallets.length) {
      const look = el("button", {
        className: "primary",
        text: state.busy ? "Looking for a wallet…" : "Connect wallet to launch",
        attrs: { type: "button" },
        on: { click: () => actions.refreshLaunchWallets() },
      });
      if (state.busy) look.disabled = true;
      panel.append(look);
    } else if (wallets.length === 1) {
      panel.append(connectButton(state, wallets[0], "Connect wallet to launch", actions));
    } else {
      for (const choice of wallets) {
        panel.append(connectButton(state, choice, `Connect ${choice.name} to launch`, actions));
      }
    }
    panel.append(el("p", {
      className: "fine",
      text: "Phantom or Solflare only. You sign in that wallet. Honeycharts never sees your keys.",
    }));
  }
  panel.append(el("button", {
    className: "ghost",
    text: "Back to the form",
    attrs: { type: "button" },
    on: { click: () => actions.editLaunch() },
  }));
  return panel;
}

function connectButton(state, choice, text, actions) {
  const connect = el("button", {
    className: "primary",
    text: state.busy ? "Waiting for your wallet…" : text,
    attrs: { type: "button" },
    on: { click: () => actions.connectLaunch(choice) },
  });
  if (state.busy) connect.disabled = true;
  return connect;
}

function check(label, id, checked, help, onChange) {
  const wrap = el("label", { className: "check field", attrs: { for: id } });
  const input = el("input", {
    attrs: { type: "checkbox", id },
    on: { change: onChange },
  });
  input.checked = checked;
  wrap.append(input);
  const copy = el("span", { className: "check-copy" });
  copy.append(el("span", { text: label }));
  copy.append(el("span", { className: "fine", text: help }));
  wrap.append(copy);
  return wrap;
}

function costBlock(form, fee) {
  const block = el("div", { className: "stack" });
  block.append(el("h3", { text: "SOL in this transaction" }));
  const list = el("ul", { className: "review-list" });
  list.append(el("li", { text: `Initial buy: ${form.initialBuySol} SOL` }));
  if (fee) list.append(el("li", { text: `Includes ${fee.sol} SOL Honeycharts launch fee` }));
  list.append(el("li", { text: `Network priority fee: ${PUMP_PRIORITY_FEE_SOL} SOL` }));
  block.append(list);
  block.append(el("p", {
    className: "fine",
    text: "Pump.fun's account creation cost is inside the same transaction. Your wallet shows the full total before you approve.",
  }));
  return block;
}

function donePanel(state, actions) {
  const result = state.result;
  const panel = el("section", { className: "panel stack" });
  panel.append(el("h2", { text: "Token is live" }));
  panel.append(el("p", { text: "The mint address is:" }));
  panel.append(el("code", { className: "ca", attrs: { translate: "no" }, text: result.mint }));
  const chart = tokenPath(location.pathname, result.mint);
  panel.append(el("a", { className: "button", attrs: { href: chart }, text: "Open the Honeycharts chart" }));
  const share = shareHref(state.form, chart);
  if (share) {
    panel.append(el("a", {
      className: "ghost share-link",
      text: "Share on X",
      attrs: { href: share, target: "_blank", rel: "noopener noreferrer" },
    }));
  }
  panel.append(el("button", {
    className: "ghost",
    text: state.savedHive ? "Saved in Hive" : "Add to Hive",
    attrs: { type: "button" },
    on: { click: () => actions.addLaunchToHive() },
  }));
  panel.append(el("a", {
    className: "text-link",
    text: "View on Solscan",
    attrs: { href: `https://solscan.io/token/${result.mint}`, target: "_blank", rel: "noopener noreferrer" },
  }));
  panel.append(el("a", {
    className: "text-link",
    text: "Trade on Pump.fun",
    attrs: { href: `https://pump.fun/coin/${result.mint}`, target: "_blank", rel: "noopener noreferrer" },
  }));
  panel.append(el("p", {
    className: "disclaimer",
    text: "The bonding curve is live. Honeycharts does not endorse this token. Creator rewards on Pump.fun go to the wallet that signed, not to Honeycharts.",
  }));
  return panel;
}

function shareHref(form, chartPath) {
  const page = new URL(chartPath, location.origin).href;
  const symbol = form && form.symbol ? form.symbol : "a token";
  const text = `Launched ${symbol} on Honeycharts`;
  return safeHttpUrl(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`);
}
