const DEX_NAMES = {
  raydium: "Raydium",
  orca: "Orca",
  meteora: "Meteora",
  pumpswap: "PumpSwap",
  pumpfun: "pump.fun",
  launchlab: "LaunchLab",
  fluxbeam: "FluxBeam",
  moonshot: "Moonshot",
  heaven: "Heaven",
  lifinity: "Lifinity",
};

export function formatCompactUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const scaled = abs / div;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}$${scaled.toFixed(digits)}${suffix}`;
    }
  }
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: abs >= 100 ? 0 : 2 })}`;
}

export function formatPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let digits = 2;
  if (abs < 1) digits = 4;
  if (abs < 0.01) digits = 6;
  if (abs < 0.0001) digits = 8;
  if (abs < 0.000001) digits = 10;
  if (abs < 0.00000001) digits = 12;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: abs >= 1 ? 2 : 0,
    maximumFractionDigits: digits,
  })}`;
}

export function formatPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatAge(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function formatAgo(ms) {
  return formatAge(ms) === "—" ? "—" : `${formatAge(ms)} ago`;
}

export function shortCa(ca) {
  if (typeof ca !== "string" || ca.length < 10) return ca || "";
  return `${ca.slice(0, 4)}…${ca.slice(-4)}`;
}

export function dexLabel(dexId) {
  if (typeof dexId !== "string") return "Unknown DEX";
  const key = dexId.toLowerCase();
  if (DEX_NAMES[key]) return DEX_NAMES[key];
  if (!/^[a-z0-9 ._-]{1,32}$/i.test(dexId)) return "Unknown DEX";
  return dexId.slice(0, 32);
}

export function pctClass(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

export function asFinite(value) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}
