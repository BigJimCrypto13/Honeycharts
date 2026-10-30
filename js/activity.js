import { isValidCA } from "./sanitize.js";
import { asFinite } from "./format.js";

const WINDOWS = [
  ["5m", "m5"],
  ["1h", "h1"],
  ["6h", "h6"],
  ["24h", "h24"],
];

export function tradeWindows(pair) {
  const txns = pair && pair.txns && typeof pair.txns === "object" ? pair.txns : {};
  const volume = pair && pair.volume && typeof pair.volume === "object" ? pair.volume : {};
  return WINDOWS.map(([label, key]) => {
    const bucket = txns[key] && typeof txns[key] === "object" ? txns[key] : {};
    return {
      label,
      buys: nonNegative(bucket.buys),
      sells: nonNegative(bucket.sells),
      volume: nonNegative(volume[key]),
    };
  });
}

export function readHolderList(report) {
  const empty = { total: null, rows: [] };
  if (!report || typeof report !== "object" || Array.isArray(report)) return empty;
  const totalRaw = asFinite(report.totalHolders);
  const total = totalRaw != null && totalRaw >= 0 && totalRaw < 1e12 ? Math.round(totalRaw) : null;
  const list = Array.isArray(report.topHolders) ? report.topHolders : [];
  const rows = [];
  for (const holder of list) {
    if (!holder || typeof holder !== "object") continue;
    const pct = asFinite(holder.pct);
    if (pct == null || pct < 0 || pct > 100) continue;
    const address = isValidCA(holder.address) ? holder.address : "";
    const owner = isValidCA(holder.owner) ? holder.owner : "";
    const amount = asFinite(holder.uiAmount);
    rows.push({
      address,
      owner,
      pct,
      uiAmount: amount != null && amount >= 0 ? amount : null,
      insider: holder.insider === true,
    });
    if (rows.length >= 20) break;
  }
  return { total, rows };
}

export function holderBarStep(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct / 5) * 5));
}

function nonNegative(value) {
  const number = asFinite(value);
  if (number == null || number < 0 || number > 1e15) return null;
  return number;
}
