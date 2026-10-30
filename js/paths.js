// URL helpers for GitHub Pages (repo subpath) and a local server (site root).

import { isValidCA } from "./sanitize.js";

export function appBase(pathname) {
  let path = typeof pathname === "string" && pathname ? pathname : "/";
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  if (!path.endsWith("/")) path += "/";
  return path;
}

export function homePath(pathname) {
  return appBase(pathname);
}

export function hivePath(pathname) {
  return `${appBase(pathname)}?view=hive`;
}

export function launchPath(pathname) {
  return `${appBase(pathname)}?view=launch`;
}

export function tokenPath(pathname, ca) {
  return `${appBase(pathname)}?ca=${encodeURIComponent(ca)}`;
}

export function walletPath(pathname, wallet) {
  const base = appBase(pathname);
  if (!wallet) return `${base}?view=wallet`;
  return `${base}?wallet=${encodeURIComponent(wallet)}`;
}

// `?t=<mint>` is an alias of `?ca=<mint>`. A present `ca` wins when both are set.
export function routeFromSearch(search) {
  const raw = typeof search === "string" ? search : "";
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(query);
  const mint = presentParam(params.get("ca")) ?? presentParam(params.get("t"));
  if (mint != null) {
    if (isValidCA(mint)) return { name: "token", ca: mint };
    return {
      name: "home",
      error: "That address is not a valid Solana contract address (base58, 32–44 characters).",
    };
  }
  const wallet = params.get("wallet");
  if (wallet != null && wallet !== "") {
    const trimmed = wallet.trim();
    if (isValidCA(trimmed)) return { name: "wallet", wallet: trimmed };
    return {
      name: "wallet",
      wallet: "",
      error: "That is not a Solana wallet address (base58, 32–44 characters).",
    };
  }
  if (params.get("view") === "hive") return { name: "hive" };
  if (params.get("view") === "launch") return { name: "launch" };
  if (params.get("view") === "wallet") return { name: "wallet", wallet: "" };
  return { name: "home" };
}

function presentParam(value) {
  if (value == null || value === "") return null;
  return value.trim();
}
