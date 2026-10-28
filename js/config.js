import { isValidCA } from "./sanitize.js";

// Jupiter referral fee. This is the only place that turns the fee on.
//
// JUPITER_REFERRAL_ACCOUNT is the public referral account (Referral Key)
// from https://referral.jup.ag. It belongs to Jupiter Ultra project
// DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc. An empty or invalid
// value means the swap runs with no Honeycharts fee.
//
// Do not put a wallet secret or key file in this repo.
export const JUPITER_REFERRAL_ACCOUNT = "6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU";

// Integrator fee in basis points. 50 bps is 0.5%.
// Jupiter accepts 50–255 bps. This file's value is clamped to that range
// before it is sent as the plugin's referralFee (their name for feeBps).
export const FEE_BPS = 50;

export const FEE_BPS_MIN = 50;
export const FEE_BPS_MAX = 255;

export function resolveReferralFee(account, feeBps) {
  const trimmed = typeof account === "string" ? account.trim() : "";
  if (!isValidCA(trimmed)) return null;
  const raw = typeof feeBps === "number" ? feeBps : Number(feeBps);
  if (!Number.isFinite(raw)) return null;
  const bps = Math.min(FEE_BPS_MAX, Math.max(FEE_BPS_MIN, Math.round(raw)));
  return { account: trimmed, bps };
}

export function referralFeeConfig() {
  return resolveReferralFee(JUPITER_REFERRAL_ACCOUNT, FEE_BPS);
}

export function formatFeePercent(bps) {
  const text = (bps / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}%`;
}

export function feeDisclosure() {
  const fee = referralFeeConfig();
  if (!fee) return "";
  return `Includes a ${formatFeePercent(fee.bps)} Honeycharts fee.`;
}

// SOL transfer added to the Pump.fun launch transaction. This wallet is a
// public LLC address. Never put a wallet secret in this file.
// Pump.fun pays ongoing creator rewards to the launching wallet, not to a
// platform account. This transfer is Honeycharts' launch revenue.
export const LAUNCH_FEE_SOL = 0.02;
export const LAUNCH_FEE_WALLET = "7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6";

export const LAUNCH_FEE_SOL_MAX = 5;

// Display name for the header and the copyright line. Swap this for the
// owner's LLC legal name later. The trademark mark is added in the page text.
export const COPYRIGHT_OWNER = "Honey Charts";
export const COPYRIGHT_YEAR = 2026;

export function brandLabel() {
  return `${COPYRIGHT_OWNER}™`;
}

export function copyrightNotice() {
  return `© ${COPYRIGHT_YEAR} ${COPYRIGHT_OWNER}™. All rights reserved.`;
}

export function launchFeeConfig() {
  const wallet = typeof LAUNCH_FEE_WALLET === "string" ? LAUNCH_FEE_WALLET.trim() : "";
  if (!isValidCA(wallet)) return null;
  const sol = typeof LAUNCH_FEE_SOL === "number" ? LAUNCH_FEE_SOL : Number(LAUNCH_FEE_SOL);
  if (!Number.isFinite(sol) || sol <= 0) return null;
  const capped = Math.min(sol, LAUNCH_FEE_SOL_MAX);
  return { wallet, sol: capped };
}
