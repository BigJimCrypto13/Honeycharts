import { isValidCA } from "./sanitize.js";

// Jupiter referral fee. This is the only place that turns the fee on.
//
// JUPITER_REFERRAL_ACCOUNT is the referral account public key from
// https://referral.jup.ag (the Referral Key). It is a public address.
// Leave it as an empty string until that key exists. An empty or invalid
// value means the swap runs with no Honeycharts fee.
//
// Do not put a private key, seed phrase, or secret-key file in this repo.
export const JUPITER_REFERRAL_ACCOUNT = "";

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
