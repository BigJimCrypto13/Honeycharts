// Token image resolution. Metadata, CDN fields, and IPFS/Arweave gateways.
// Nothing here writes to the DOM. Callers pass fetch and storage in.

import { isValidCA, safeImageUrl, safeTokenImageUrl } from "./sanitize.js";

export const IMAGE_SLOTS = ["metadata", "dex", "jupiter", "gecko", "cached", "direct"];

export const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://4everland.io/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
];

export const ARWEAVE_GATEWAYS = [
  "https://arweave.net/",
  "https://gateway.irys.xyz/",
];

const AR_HOSTS = new Set(["arweave.net", "www.arweave.net", "gateway.irys.xyz", "arweave.dev"]);
const AR_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif)(?:$|[?#])/i;
const IMAGE_CACHE_KEY = "honeycharts.img.v1";
const IMAGE_CACHE_CAP = 240;

export function emptyImages() {
  return { metadata: "", dex: "", jupiter: "", gecko: "", cached: "", direct: "" };
}

export function cleanImageSlot(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  return safeImageUrl(value) || safeTokenImageUrl(value) || preferredImageUrl(value) || "";
}

export function orderImageSources(sources) {
  const out = [];
  const seen = new Set();
  for (const slot of IMAGE_SLOTS) {
    const clean = cleanImageSlot(sources && sources[slot]);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function chooseImage(sources) {
  return orderImageSources(sources)[0] || "";
}

function isCid(value) {
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) || /^ba[a-z2-7]{20,80}$/.test(value);
}

export function extractIpfsCid(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const fromScheme = trimmed.match(/^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]+)/i);
  if (fromScheme && isCid(fromScheme[1])) return fromScheme[1];
  const fromPath = trimmed.match(/\/ipfs\/([A-Za-z0-9]+)/);
  if (fromPath && isCid(fromPath[1])) return fromPath[1];
  if (isCid(trimmed)) return trimmed;
  return "";
}

export function extractArweaveId(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const scheme = trimmed.match(/^ar:\/\/([A-Za-z0-9_-]{43})$/);
  if (scheme && AR_ID_RE.test(scheme[1])) return scheme[1];
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (!AR_HOSTS.has(url.hostname.toLowerCase())) return "";
  const id = url.pathname.split("/").filter(Boolean)[0] || "";
  return AR_ID_RE.test(id) ? id : "";
}

export function ipfsUrls(cid) {
  if (!isCid(cid)) return [];
  return IPFS_GATEWAYS.map((base) => `${base}${cid}`);
}

export function arweaveUrls(id) {
  if (!AR_ID_RE.test(id || "")) return [];
  return ARWEAVE_GATEWAYS.map((base) => `${base}${id}`);
}

export function looksLikeImageUrl(value) {
  return typeof value === "string" && IMAGE_EXT_RE.test(value.trim());
}

function unique(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function metadataTargets(uri) {
  const out = [];
  const cid = extractIpfsCid(uri);
  if (cid) out.push(...ipfsUrls(cid));
  const ar = extractArweaveId(uri);
  if (ar) out.push(...arweaveUrls(ar));
  const direct = safeTokenImageUrl(uri);
  if (direct) out.push(direct);
  return unique(out).slice(0, 6);
}

export function preferredImageUrl(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  const cid = extractIpfsCid(trimmed);
  if (cid) return ipfsUrls(cid)[0] || "";
  const ar = extractArweaveId(trimmed);
  if (ar) return arweaveUrls(ar)[0] || "";
  return safeTokenImageUrl(trimmed) || "";
}

export function nextImageUrl(failedUrl) {
  if (typeof failedUrl !== "string" || !failedUrl) return "";
  const cid = extractIpfsCid(failedUrl);
  if (cid) {
    const urls = ipfsUrls(cid);
    const index = urls.findIndex((url) => failedUrl.startsWith(url));
    if (index >= 0 && urls[index + 1]) return urls[index + 1];
    return "";
  }
  const ar = extractArweaveId(failedUrl);
  if (ar) {
    const urls = arweaveUrls(ar);
    const index = urls.findIndex((url) => failedUrl.startsWith(url));
    if (index >= 0 && urls[index + 1]) return urls[index + 1];
  }
  return "";
}

export function proxyImageUrl(url) {
  const safe = safeTokenImageUrl(url) || safeImageUrl(url);
  if (!safe) return "";
  let host = "";
  try {
    host = new URL(safe).hostname;
  } catch {
    return "";
  }
  if (host === "wsrv.nl") return "";
  return `https://wsrv.nl/?url=${encodeURIComponent(safe)}&w=160&h=160&fit=cover&n=-1`;
}

export function metadataImageValue(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return "";
  let image = json.image || json.image_url || json.imageUrl || "";
  if (image && typeof image === "object") {
    if (Array.isArray(image)) image = image[0];
    else image = image.url || image.uri || "";
  }
  return typeof image === "string" ? image.trim() : "";
}

const METADATA_FETCH_HOSTS = new Set([
  "gateway.pinata.cloud",
  "4everland.io",
  "ipfs.filebase.io",
  "ipfs.io",
  "arweave.net",
  "www.arweave.net",
  "gateway.irys.xyz",
]);

export function fetchableMetadataTargets(uri) {
  return metadataTargets(uri).filter((url) => {
    try {
      return METADATA_FETCH_HOSTS.has(new URL(url).hostname);
    } catch {
      return false;
    }
  }).slice(0, 3);
}

export async function resolveMetadataImage(uri, fetchImpl, { signal, timeoutMs = 8000 } = {}) {
  if (typeof fetchImpl !== "function") return "";
  const inline = looksLikeImageUrl(uri) ? preferredImageUrl(uri) : "";
  if (inline && !extractIpfsCid(uri) && !extractArweaveId(uri)) return inline;
  const targets = fetchableMetadataTargets(uri);
  for (const url of targets) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, signal, timeoutMs);
      if (!response || !response.ok) continue;
      const type = headerValue(response, "content-type");
      if (type.includes("image/")) {
        const safe = safeTokenImageUrl(url);
        if (safe) return safe;
        continue;
      }
      if (typeof response.json !== "function") continue;
      const json = await response.json();
      const image = preferredImageUrl(metadataImageValue(json));
      if (image) return image;
    } catch {
      // Try the next gateway. A dead host must not blank the card.
    }
  }
  return inline || "";
}

async function fetchWithTimeout(fetchImpl, url, signal, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json, image/*;q=0.9" },
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function headerValue(response, name) {
  if (!response.headers) return "";
  if (typeof response.headers.get === "function") return String(response.headers.get(name) || "");
  return "";
}

export function readImageCache(storage) {
  const out = {};
  if (!storage || typeof storage.getItem !== "function") return out;
  let data;
  try {
    data = JSON.parse(storage.getItem(IMAGE_CACHE_KEY) || "");
  } catch {
    return out;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [ca, url] of Object.entries(data)) {
    if (!isValidCA(ca)) continue;
    const safe = cleanImageSlot(url);
    if (!safe) continue;
    out[ca] = safe;
    if (Object.keys(out).length >= IMAGE_CACHE_CAP) break;
  }
  return out;
}

export function writeImageCache(storage, cache) {
  if (!storage || typeof storage.setItem !== "function") return false;
  const next = {};
  const entries = Object.entries(cache || {}).filter(([ca, url]) => isValidCA(ca) && cleanImageSlot(url));
  for (const [ca, url] of entries.slice(-IMAGE_CACHE_CAP)) next[ca] = cleanImageSlot(url);
  try {
    storage.setItem(IMAGE_CACHE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
