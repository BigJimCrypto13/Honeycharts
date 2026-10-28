// Validation and string cleaning. API text is untrusted.

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_FIND = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const IMAGE_HOSTS = new Set(["cdn.dexscreener.com", "dd.dexscreener.com"]);
const IMAGE_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

export function isValidCA(value) {
  return typeof value === "string" && BASE58_RE.test(value);
}

export function extractCA(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (isValidCA(trimmed)) return trimmed;
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) return null;

  const fromUrl = caFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  const matches = trimmed.match(BASE58_FIND) || [];
  const valid = matches.filter(isValidCA);
  if (valid.length === 1) return valid[0];
  return null;
}

function caFromUrl(value) {
  let href = value;
  if (/^dexscreener\.com\//i.test(href) || /^solscan\.io\//i.test(href)) {
    href = `https://${href}`;
  }
  if (!/^https?:\/\//i.test(href)) return null;
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const segment = parts[i];
    if (isValidCA(segment)) return segment;
  }
  return null;
}

export function clipText(value, max) {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  if (max <= 1) return cleaned.slice(0, max);
  return `${cleaned.slice(0, max - 1)}…`;
}

export function safeHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

export function safeImageUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (IMAGE_ID_RE.test(trimmed)) {
    return `https://cdn.dexscreener.com/cms/images/${trimmed}?width=128&height=128&fit=crop&quality=95&format=auto`;
  }
  const href = safeHttpUrl(trimmed);
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== "https:") return null;
  if (!IMAGE_HOSTS.has(url.hostname)) return null;
  return url.href;
}

export function safeLinkLabel(kind, href) {
  const safe = safeHttpUrl(href);
  if (!safe) return null;
  let host = "";
  try {
    host = new URL(safe).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host.length > 48) host = `${host.slice(0, 47)}…`;
  const names = {
    twitter: "X",
    telegram: "Telegram",
    discord: "Discord",
    website: "Link",
  };
  const prefix = names[kind] || "Link";
  return { href: safe, label: `${prefix} · ${host}` };
}
