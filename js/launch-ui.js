import { el } from "./dom.js";
import { launchFeeConfig } from "./config.js";
import { metadataDocument, imageDownloadName, describeLaunch } from "./launch-form.js";
import { formatLamports } from "./launch-tx.js";
import { tokenPath } from "./paths.js";
import { safeHttpUrl } from "./sanitize.js";

const CLUSTER_COPY = {
  devnet: "Devnet (test)",
  mainnet: "Mainnet",
};

export function renderLaunch(root, state, actions) {
  root.replaceChildren();
  const page = el("div", { className: "stack launch" });
  page.append(el("section", { className: "hero" }, [
    el("h1", { text: "Launch a token" }),
    el("p", {
      text: "Create a standard SPL token from this browser. Honeycharts does not create a liquidity pool and does not endorse the token.",
    }),
  ]));
  page.append(el("p", {
    className: "disclaimer",
    text: "Creating a token is the creator's responsibility. Honeycharts is not a broker or custodian and does not endorse tokens made here. No liquidity pool is created. You can add liquidity later on Raydium or Meteora. Not financial advice, DYOR.",
  }));
  page.append(clusterControl(state, actions));
  page.append(feeNotice());
  if (state.message) page.append(el("p", { className: "banner", text: state.message }));
  if (state.errors && state.errors.length) {
    const list = el("ul", { className: "errors" });
    for (const error of state.errors) list.append(el("li", { text: error }));
    page.append(list);
  }
  if (state.step === "done" && state.result) page.append(donePanel(state));
  else if (state.step === "review" && state.form) page.append(reviewPanel(state, actions));
  else page.append(formPanel(state, actions));
  root.append(page);
}

function clusterControl(state, actions) {
  const group = el("fieldset", { className: "panel cluster" });
  group.append(el("legend", { text: "Network" }));
  group.append(radio("devnet", state, actions));
  group.append(radio("mainnet", state, actions));
  if (state.cluster === "mainnet") {
    group.append(el("p", {
      className: "banner",
      text: "Mainnet spends real SOL. The review screen asks you to confirm that before you can sign.",
    }));
  }
  return group;
}

function radio(cluster, state, actions) {
  const id = `cluster-${cluster}`;
  const input = el("input", {
    attrs: { type: "radio", name: "cluster", id, value: cluster },
    on: { change: () => actions.setLaunchCluster(cluster) },
  });
  if (state.cluster === cluster) input.checked = true;
  const label = el("label", { attrs: { for: id } });
  label.append(input, document.createTextNode(` ${CLUSTER_COPY[cluster]}`));
  return label;
}

function feeNotice() {
  const fee = launchFeeConfig();
  if (!fee) {
    return el("p", { className: "fine", text: "No launch fee is configured." });
  }
  return el("p", {
    className: "fee-note",
    text: `Includes a launch fee of ${fee.sol} SOL, transferred to a separate address in the same transaction.`,
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
    text: "This creates a standard SPL token with the original Token Program, plus Metaplex metadata. This site cannot host the image or the metadata file.",
  }));
  form.append(textField("Name", "launch-name", state.fields.name, { maxlength: "32", required: "required" }, actions));
  form.append(textField("Symbol", "launch-symbol", state.fields.symbol, { maxlength: "10", required: "required", autocapitalize: "characters" }, actions));
  form.append(textField("Decimals", "launch-decimals", state.fields.decimals, { inputmode: "numeric", maxlength: "1" }, actions));
  form.append(textField("Total supply", "launch-supply", state.fields.supply, { inputmode: "numeric", required: "required", maxlength: "18" }, actions));
  form.append(textField("Image URL", "launch-image-url", state.fields.imageUrl, { type: "url", placeholder: "https://…" }, actions));
  form.append(fileField(state, actions));
  form.append(areaField("Description", "launch-description", state.fields.description, actions));
  form.append(textField("Website", "launch-website", state.fields.website, { type: "url", placeholder: "https://…" }, actions));
  form.append(textField("X", "launch-twitter", state.fields.twitter, { type: "url", placeholder: "https://x.com/…" }, actions));
  form.append(textField("Telegram", "launch-telegram", state.fields.telegram, { type: "url", placeholder: "https://t.me/…" }, actions));
  form.append(textField("Metadata JSON link", "launch-metadata", state.fields.metadataUri, { type: "url", placeholder: "https://…/metadata.json", required: "required" }, actions));
  form.append(el("p", {
    className: "fine",
    text: "Download metadata.json, host it yourself, then paste the https link above. On-chain metadata can only store that link, and it must be 200 characters or fewer.",
  }));
  const downloads = el("div", { className: "hero-actions" });
  downloads.append(el("button", {
    className: "ghost",
    text: "Download metadata.json",
    attrs: { type: "button" },
    on: { click: () => actions.downloadMetadata() },
  }));
  if (state.imageFile) {
    downloads.append(el("button", {
      className: "ghost",
      text: "Download image file",
      attrs: { type: "button" },
      on: { click: () => actions.downloadImage() },
    }));
  }
  form.append(downloads);
  form.append(el("button", { className: "primary", text: "Review launch", attrs: { type: "submit" } }));
  return form;
}

function textField(label, id, value, attrs, actions) {
  const wrap = el("label", { className: "field", attrs: { for: id } });
  wrap.append(el("span", { text: label }));
  const input = el("input", {
    attrs: { id, name: id, type: "text", value: value || "", ...attrs },
    on: { input: (event) => actions.patchLaunch(id, event.currentTarget.value) },
  });
  wrap.append(input);
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
  wrap.append(el("span", { text: "Or choose an image file" }));
  wrap.append(el("input", {
    attrs: { id: "launch-image-file", type: "file", accept: "image/png,image/jpeg,image/gif,image/webp" },
    on: { change: (event) => actions.setLaunchImage(event.currentTarget.files && event.currentTarget.files[0]) },
  }));
  wrap.append(el("span", {
    className: "fine",
    text: state.imageFile
      ? `Selected ${imageDownloadName(state.imageFile)}. It stays in this browser until you download it.`
      : "PNG, JPEG, GIF, or WebP. Nothing is uploaded.",
  }));
  return wrap;
}

function reviewPanel(state, actions) {
  const form = state.form;
  const fee = launchFeeConfig();
  const panel = el("section", { className: "panel stack" });
  panel.append(el("h2", { text: "Review before signing" }));
  panel.append(el("p", { text: `${form.name} (${form.symbol}) on ${CLUSTER_COPY[state.cluster]}.` }));
  const list = el("ul", { className: "review-list" });
  for (const line of describeLaunch(form, {
    revokeMint: state.revokeMint,
    revokeFreeze: state.revokeFreeze,
    fee,
  })) {
    list.append(el("li", { text: line }));
  }
  panel.append(list);
  panel.append(el("p", { className: "fine", text: `Metadata link: ${form.metadataUri}` }));
  panel.append(check("Revoke mint authority", "launch-revoke-mint", state.revokeMint, "Recommended. No more tokens can be minted. This improves the Honey Score.", () => actions.patchLaunchFlag("revokeMint")));
  panel.append(check("Revoke freeze authority", "launch-revoke-freeze", state.revokeFreeze, "Recommended. Holder accounts cannot be frozen. This improves the Honey Score.", () => actions.patchLaunchFlag("revokeFreeze")));
  panel.append(costBlock(state, fee));
  if (state.cluster === "mainnet") {
    panel.append(check(
      "I understand this spends real SOL on mainnet",
      "launch-mainnet-ok",
      state.mainnetConfirmed,
      "Required before you can sign on mainnet.",
      () => actions.patchLaunchFlag("mainnetConfirmed"),
    ));
  }
  if (state.wallet) {
    panel.append(el("p", { text: `Connected with ${state.wallet.name}: ${state.wallet.address}` }));
    const sign = el("button", {
      className: "primary",
      text: state.busy ? "Waiting for your wallet…" : `Sign on ${CLUSTER_COPY[state.cluster]}`,
      attrs: { type: "button" },
      on: { click: () => actions.signLaunch() },
    });
    if (state.busy || (state.cluster === "mainnet" && !state.mainnetConfirmed)) sign.disabled = true;
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
      const connect = el("button", {
        className: "primary",
        text: state.busy ? "Waiting for your wallet…" : "Connect wallet to launch",
        attrs: { type: "button" },
        on: { click: () => actions.connectLaunch(wallets[0]) },
      });
      if (state.busy) connect.disabled = true;
      panel.append(connect);
    } else {
      for (const choice of wallets) {
        const connect = el("button", {
          className: "primary",
          text: `Connect ${choice.name} to launch`,
          attrs: { type: "button" },
          on: { click: () => actions.connectLaunch(choice) },
        });
        if (state.busy) connect.disabled = true;
        panel.append(connect);
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
  panel.append(poolLinks());
  return panel;
}

function check(label, id, checked, help, onChange) {
  const wrap = el("label", { className: "check field", attrs: { for: id } });
  const input = el("input", {
    attrs: { type: "checkbox", id },
    on: { change: onChange },
  });
  input.checked = checked;
  wrap.append(input);
  const text = el("span", { className: "check-copy" });
  text.append(el("span", { text: label }));
  text.append(el("span", { className: "fine", text: help }));
  wrap.append(text);
  return wrap;
}

function costBlock(state, fee) {
  const block = el("div", { className: "stack" });
  block.append(el("h3", { text: "Estimated SOL" }));
  if (!state.estimate) {
    block.append(el("p", { className: "muted", text: "Estimating rent from the Solana RPC…" }));
    return block;
  }
  const estimate = state.estimate;
  const rows = [
    ["Mint account rent", estimate.mintRent],
    ["Your token account rent", estimate.accountRent],
    ["Metadata account rent", estimate.metadataRent],
    ["Transaction fee", estimate.txFee],
  ];
  const list = el("ul", { className: "review-list" });
  for (const [label, lamports] of rows) {
    list.append(el("li", { text: `${label}: ${formatLamports(lamports)} SOL` }));
  }
  if (fee) list.append(el("li", { text: `Launch fee: ${fee.sol} SOL` }));
  list.append(el("li", { text: `Total: ${formatLamports(estimate.total)} SOL` }));
  block.append(list);
  block.append(el("p", {
    className: "fine",
    text: "This is an estimate. Your wallet shows the final transaction before you approve it.",
  }));
  return block;
}

function donePanel(state) {
  const result = state.result;
  const panel = el("section", { className: "panel stack" });
  panel.append(el("h2", { text: "Token created" }));
  panel.append(el("p", { text: "The new mint address is:" }));
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
  const explorer = result.cluster === "devnet"
    ? `https://solscan.io/token/${result.mint}?cluster=devnet`
    : `https://solscan.io/token/${result.mint}`;
  panel.append(el("a", {
    className: "text-link",
    text: "View on Solscan",
    attrs: { href: explorer, target: "_blank", rel: "noopener noreferrer" },
  }));
  panel.append(el("p", {
    className: "disclaimer",
    text: "No liquidity pool was created. The chart stays empty until someone adds a market. Honeycharts does not endorse this token.",
  }));
  panel.append(poolLinks());
  return panel;
}

function poolLinks() {
  const row = el("div", { className: "link-row" });
  row.append(el("a", {
    className: "text-link",
    text: "Add liquidity on Raydium",
    attrs: { href: "https://raydium.io/liquidity/create-pool/", target: "_blank", rel: "noopener noreferrer" },
  }));
  row.append(el("a", {
    className: "text-link",
    text: "Add liquidity on Meteora",
    attrs: { href: "https://app.meteora.ag/", target: "_blank", rel: "noopener noreferrer" },
  }));
  return row;
}

function shareHref(form, chartPath) {
  const page = new URL(chartPath, location.origin).href;
  const symbol = form && form.symbol ? form.symbol : "a token";
  const text = `Launching ${symbol} on Honeycharts`;
  const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(page)}`;
  return safeHttpUrl(href);
}

export function downloadMetadata(form) {
  const doc = metadataDocument(form);
  downloadBlob("metadata.json", new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
}

export function downloadImage(file) {
  if (!file) return;
  downloadBlob(imageDownloadName(file), file);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
