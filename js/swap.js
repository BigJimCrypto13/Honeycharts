import { isValidCA } from "./sanitize.js";
import { referralFeeConfig } from "./config.js";

// Official Jupiter Plugin loader. The loader pulls plugin-<version>-app.js itself.
// https://developers.jup.ag/docs/tool-kits/plugin/html-app-example
const PLUGIN_SRC = "https://plugin.jup.ag/plugin-v1.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

// Buy shortcuts. The plugin's initialAmount is the input mint in its smallest
// unit (lamports for SOL). It has no "percent of the wallet" field, and this
// page does not read a balance, so sell amounts stay in the plugin form.
export const BUY_SOL_AMOUNTS = [0.1, 0.5, 1];
export const BUY_USD_PRESETS = [10, 25, 100];
export const MAX_BUY_SOL = 100;

let scriptPromise = null;
let initSerial = 0;

export function jupiterSwapUrl(ca) {
  if (!isValidCA(ca)) return null;
  return `https://jup.ag/swap/SOL-${ca}`;
}

export function solToSmallestUnit(sol) {
  const text = typeof sol === "number" ? fixedSol(sol) : typeof sol === "string" ? sol.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(text) || text.length > 18) return null;
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 9) return null;
  const padded = (frac + "000000000").slice(0, 9);
  try {
    return (BigInt(whole) * 1000000000n + BigInt(padded)).toString();
  } catch {
    return null;
  }
}

export function lamportsFromSol(sol) {
  const lamports = solToSmallestUnit(sol);
  if (!lamports || lamports === "0") return null;
  const max = BigInt(MAX_BUY_SOL) * 1000000000n;
  if (BigInt(lamports) > max) return null;
  return lamports;
}

export function lamportsFromUsd(usd, solPriceUsd) {
  if (!BUY_USD_PRESETS.includes(usd)) return null;
  if (typeof solPriceUsd !== "number" || !Number.isFinite(solPriceUsd) || solPriceUsd <= 0) return null;
  return lamportsFromSol(usd / solPriceUsd);
}

function fixedSol(number) {
  if (!Number.isFinite(number) || number < 0) return "";
  return number.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
}

export async function mountSwap(ca, options = {}) {
  if (!isValidCA(ca)) throw new Error("ca");
  const serial = ++initSerial;
  await loadPlugin();
  if (serial !== initSerial) return;
  if (!window.Jupiter || typeof window.Jupiter.init !== "function") {
    throw new Error("jupiter-missing");
  }
  const mount = document.getElementById("swap-mount");
  if (!mount) throw new Error("jupiter-mount");
  while (mount.firstChild) mount.removeChild(mount.firstChild);

  // Wallet connection stays inside the plugin. Passthrough is off so this page
  // never receives a wallet, a public key, or a signature request.
  window.Jupiter.init({
    displayMode: "integrated",
    integratedTargetId: "swap-mount",
    autoConnect: false,
    enableWalletPassthrough: false,
    formProps: buildSwapForm(ca, options),
  });
  await waitForWidget();
  if (serial !== initSerial) return;
}

export function buildSwapForm(ca, options = {}) {
  const side = options.side === "sell" ? "sell" : "buy";
  const form = {
    initialInputMint: side === "sell" ? ca : SOL_MINT,
    initialOutputMint: side === "sell" ? SOL_MINT : ca,
    fixedMint: ca,
  };
  if (side === "buy" && BUY_SOL_AMOUNTS.includes(options.solAmount)) {
    const amount = solToSmallestUnit(options.solAmount);
    if (amount) form.initialAmount = amount;
  } else if (side === "buy" && typeof options.lamports === "string" && /^\d{1,12}$/.test(options.lamports)) {
    try {
      const value = BigInt(options.lamports);
      const max = BigInt(MAX_BUY_SOL) * 1000000000n;
      if (value > 0n && value <= max) form.initialAmount = value.toString();
    } catch {
      // Ignore a bad amount. The form still opens with no size filled in.
    }
  }
  const fee = referralFeeConfig();
  if (!fee) return form;
  // Plugin field referralFee is the fee in basis points (feeBps on the order).
  form.referralAccount = fee.account;
  form.referralFee = fee.bps;
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
