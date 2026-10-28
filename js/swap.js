import { isValidCA } from "./sanitize.js";

// Official Jupiter Plugin loader. The loader pulls plugin-<version>-app.js itself.
// https://developers.jup.ag/docs/tool-kits/plugin/html-app-example
const PLUGIN_SRC = "https://plugin.jup.ag/plugin-v1.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

// Referral fee is disabled. Do not pass referralAccount or referralFee until a
// lawyer reviews a Jupiter referral arrangement. A future config would look like:
// referralAccount: "<referral account pubkey>",
// referralFee: 0,
const REFERRAL_FEE_ENABLED = false;

let scriptPromise = null;

export function jupiterSwapUrl(ca) {
  if (!isValidCA(ca)) return null;
  return `https://jup.ag/swap/SOL-${ca}`;
}

export async function mountSwap(ca) {
  if (!isValidCA(ca)) throw new Error("ca");
  await loadPlugin();
  if (!window.Jupiter || typeof window.Jupiter.init !== "function") {
    throw new Error("jupiter-missing");
  }
  if (!document.getElementById("swap-mount")) throw new Error("jupiter-mount");

  // Wallet connection stays inside the plugin. Passthrough is off so this page
  // never receives a wallet, a public key, or a signature request.
  window.Jupiter.init({
    displayMode: "integrated",
    integratedTargetId: "swap-mount",
    autoConnect: false,
    enableWalletPassthrough: false,
    formProps: swapForm(ca),
  });
  await waitForWidget();
}

function swapForm(ca) {
  const form = {
    initialInputMint: SOL_MINT,
    initialOutputMint: ca,
    fixedMint: ca,
  };
  if (REFERRAL_FEE_ENABLED) {
    throw new Error("referral-fee-disabled");
  }
  return form;
}

function loadPlugin() {
  if (window.Jupiter && typeof window.Jupiter.init === "function") return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLUGIN_SRC;
    script.async = true;
    script.dataset.jupiterPlugin = "1";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(new Error("jupiter-script"));
    }, { once: true });
    document.head.append(script);
  });
  return scriptPromise;
}

function waitForWidget() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (widgetReady()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > 8000) {
        clearInterval(timer);
        reject(new Error("jupiter-timeout"));
      }
    }, 150);
  });
}

function widgetReady() {
  const root = document.getElementById("jupiter-plugin-instance");
  if (!root) return false;
  if (hasShadow(root)) return true;
  return root.textContent.trim().length > 40;
}

function hasShadow(node) {
  if (node.shadowRoot && node.shadowRoot.childNodes.length > 0) return true;
  for (const child of node.children || []) {
    if (hasShadow(child)) return true;
  }
  return false;
}
