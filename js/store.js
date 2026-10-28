import { isValidCA } from "./sanitize.js";

export const HIVE_KEY = "honeycharts.hive.v1";
export const RECENT_KEY = "honeycharts.recent.v1";
export const MAX_TOKENS = 200;
export const MAX_RECENT = 12;
export const MAX_IMPORT_RECENT = 30;
const MAX_BYTES = 500000;

const FILE_TOKEN_KEYS = new Set(["ca", "note", "addedAt"]);
const STORED_TOKEN_KEYS = new Set(["ca", "note", "addedAt", "name", "symbol"]);
const FILE_RECENT_KEYS = new Set(["ca", "viewedAt"]);
const STORED_RECENT_KEYS = new Set(["ca", "viewedAt", "name", "symbol"]);
const FILE_ROOT_KEYS = new Set(["version", "app", "exportedAt", "tokens", "recent"]);

export const IMPORT_ERRORS = {
  "file-size": "That file is too large to import.",
  json: "That file is not valid JSON.",
  shape: "That file is not a Hive backup.",
  field: "That file has fields Honeycharts does not accept.",
  version: "That backup version is not supported. Expected version 1.",
  app: "That file is not a Honeycharts backup.",
  tokens: "That backup has no token list.",
  "too-many": "A Hive can hold at most 200 tokens.",
  token: "One of the token entries is not valid.",
  "token-field": "A token entry has fields that are not allowed.",
  ca: "A token entry has an invalid Solana address.",
  duplicate: "That backup lists the same address twice.",
  note: "A note must be text, 280 characters or fewer, with no control characters.",
  time: "A timestamp in that backup is not valid.",
  recent: "The recent list in that backup is not valid.",
  storage: "This browser blocked saving the Hive.",
};

export function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

export function detectStorage() {
  try {
    if (typeof localStorage === "undefined") {
      return { storage: memoryStorage(), persistent: false };
    }
    const probe = "__honeycharts_probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return { storage: localStorage, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

export function parseHiveDocument(text, source) {
  if (typeof text !== "string" || text.length > MAX_BYTES) fail("file-size");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("json");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("shape");
  const kind = source === "hive" || source === "recent" ? source : "file";
  const allowNames = kind !== "file";
  const rootKeys = kind === "recent"
    ? new Set(["version", "app", "recent"])
    : kind === "hive"
      ? new Set(["version", "app", "tokens"])
      : FILE_ROOT_KEYS;
  for (const key of Object.keys(data)) {
    if (!rootKeys.has(key)) fail("field");
  }
  if (data.version !== 1) fail("version");
  if (data.app != null && data.app !== "honeycharts") fail("app");
  if (kind === "file" && data.exportedAt != null && (typeof data.exportedAt !== "string" || data.exportedAt.length > 40)) {
    fail("field");
  }
  let tokens = [];
  if (kind !== "recent") {
    if (!Array.isArray(data.tokens)) fail("tokens");
    if (data.tokens.length > MAX_TOKENS) fail("too-many");
    tokens = parseTokenList(data.tokens, allowNames);
  }
  let recent = null;
  if (kind === "recent" || data.recent != null) {
    recent = parseRecentList(data.recent, allowNames);
  }
  return { version: 1, tokens, recent };
}

function parseTokenList(list, allowNames) {
  const allowed = allowNames ? STORED_TOKEN_KEYS : FILE_TOKEN_KEYS;
  const seen = new Set();
  const tokens = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("token");
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) fail("token-field");
    }
    if (typeof entry.ca !== "string" || !isValidCA(entry.ca)) fail("ca");
    if (seen.has(entry.ca)) fail("duplicate");
    seen.add(entry.ca);
    tokens.push({
      ca: entry.ca,
      note: readNote(entry.note),
      addedAt: readTime(entry.addedAt),
      name: allowNames ? readLabel(entry.name, 64) : "",
      symbol: allowNames ? readLabel(entry.symbol, 16) : "",
    });
  }
  return tokens;
}

function parseRecentList(list, allowNames) {
  if (!Array.isArray(list) || list.length > MAX_IMPORT_RECENT) fail("recent");
  const allowed = allowNames ? STORED_RECENT_KEYS : FILE_RECENT_KEYS;
  const seen = new Set();
  const recent = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("recent");
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) fail("recent");
    }
    if (typeof entry.ca !== "string" || !isValidCA(entry.ca)) fail("recent");
    if (seen.has(entry.ca)) fail("recent");
    seen.add(entry.ca);
    recent.push({
      ca: entry.ca,
      viewedAt: readTime(entry.viewedAt, true),
      name: allowNames ? readLabel(entry.name, 64) : "",
      symbol: allowNames ? readLabel(entry.symbol, 16) : "",
    });
  }
  return recent;
}

function readNote(note) {
  if (note == null) return "";
  if (typeof note !== "string" || note.length > 280) fail("note");
  if (/[\u0000-\u001F\u007F]/.test(note)) fail("note");
  return note.trim();
}

function readLabel(value, max) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > max) fail("token-field");
  if (/[\u0000-\u001F\u007F]/.test(value)) fail("token-field");
  return value.trim();
}

function readTime(value, required = false) {
  if (value == null) {
    if (required) fail("time");
    return Date.now();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) fail("time");
  if (value < 0 || value > Date.now() + 24 * 60 * 60 * 1000) fail("time");
  return value;
}

function fail(code) {
  throw new Error(code);
}

export function createHive(storage) {
  let loaded = readStored(storage, HIVE_KEY, "hive");
  let reset = loaded.reset;
  let tokens = loaded.items;

  function persist() {
    writeStored(storage, HIVE_KEY, { version: 1, app: "honeycharts", tokens });
  }

  return {
    wasReset() {
      return reset;
    },
    clearReset() {
      reset = false;
    },
    list() {
      return tokens.map((token) => ({ ...token }));
    },
    has(ca) {
      return tokens.some((token) => token.ca === ca);
    },
    get(ca) {
      const found = tokens.find((token) => token.ca === ca);
      return found ? { ...found } : null;
    },
    add(ca, name = "", symbol = "") {
      if (!isValidCA(ca)) fail("ca");
      if (this.has(ca)) return false;
      if (tokens.length >= MAX_TOKENS) fail("too-many");
      tokens.push({
        ca,
        note: "",
        addedAt: Date.now(),
        name: cleanLabel(name, 64),
        symbol: cleanLabel(symbol, 16),
      });
      persist();
      return true;
    },
    remove(ca) {
      const next = tokens.filter((token) => token.ca !== ca);
      if (next.length === tokens.length) return false;
      tokens = next;
      persist();
      return true;
    },
    restore(token) {
      if (!token || !isValidCA(token.ca)) fail("ca");
      if (this.has(token.ca)) return false;
      if (tokens.length >= MAX_TOKENS) fail("too-many");
      tokens.push({
        ca: token.ca,
        note: cleanNote(token.note),
        addedAt: typeof token.addedAt === "number" ? token.addedAt : Date.now(),
        name: cleanLabel(token.name, 64),
        symbol: cleanLabel(token.symbol, 16),
      });
      persist();
      return true;
    },
    setNote(ca, note) {
      const token = tokens.find((item) => item.ca === ca);
      if (!token) return false;
      token.note = cleanNote(note);
      persist();
      return true;
    },
    remember(ca, name, symbol) {
      const token = tokens.find((item) => item.ca === ca);
      if (!token) return false;
      if (name) token.name = cleanLabel(name, 64);
      if (symbol) token.symbol = cleanLabel(symbol, 16);
      persist();
      return true;
    },
    merge(incoming) {
      const map = new Map(tokens.map((token) => [token.ca, { ...token }]));
      let added = 0;
      let updated = 0;
      for (const token of incoming) {
        const prev = map.get(token.ca);
        if (prev) {
          prev.note = token.note;
          updated += 1;
        } else {
          map.set(token.ca, {
            ca: token.ca,
            note: token.note,
            addedAt: token.addedAt,
            name: "",
            symbol: "",
          });
          added += 1;
        }
      }
      const next = [...map.values()];
      if (next.length > MAX_TOKENS) fail("too-many");
      tokens = next;
      persist();
      return { added, updated, total: next.length };
    },
    replaceAll(next) {
      if (next.length > MAX_TOKENS) fail("too-many");
      tokens = next.map((token) => ({
        ca: token.ca,
        note: token.note || "",
        addedAt: token.addedAt,
        name: cleanLabel(token.name, 64),
        symbol: cleanLabel(token.symbol, 16),
      }));
      persist();
    },
  };
}

export function createRecent(storage) {
  let items = readStored(storage, RECENT_KEY, "recent").items;

  function persist() {
    writeStored(storage, RECENT_KEY, { version: 1, app: "honeycharts", recent: items });
  }

  return {
    list() {
      return items.map((item) => ({ ...item }));
    },
    touch(ca, name, symbol) {
      if (!isValidCA(ca)) return;
      const prev = items.find((item) => item.ca === ca);
      const next = items.filter((item) => item.ca !== ca);
      next.unshift({
        ca,
        viewedAt: Date.now(),
        name: name ? cleanLabel(name, 64) : (prev ? prev.name : ""),
        symbol: symbol ? cleanLabel(symbol, 16) : (prev ? prev.symbol : ""),
      });
      items = next.slice(0, MAX_RECENT);
      persist();
    },
    clear() {
      items = [];
      persist();
    },
    replaceAll(next) {
      const sorted = [...next].sort((a, b) => b.viewedAt - a.viewedAt).slice(0, MAX_RECENT);
      items = sorted.map((item) => ({
        ca: item.ca,
        viewedAt: item.viewedAt,
        name: cleanLabel(item.name, 64),
        symbol: cleanLabel(item.symbol, 16),
      }));
      persist();
    },
  };
}

function readStored(storage, key, source) {
  const raw = storage.getItem(key);
  if (!raw) return { items: [], reset: false };
  try {
    const parsed = parseHiveDocument(raw, source);
    const items = source === "recent" ? (parsed.recent || []) : parsed.tokens;
    return { items, reset: false };
  } catch {
    return { items: [], reset: true };
  }
}

function writeStored(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    fail("storage");
  }
}

export function exportBackup(hive, recent) {
  return {
    version: 1,
    app: "honeycharts",
    exportedAt: new Date().toISOString(),
    tokens: hive.list().map(({ ca, note, addedAt }) => ({ ca, note, addedAt })),
    recent: recent.list().map(({ ca, viewedAt }) => ({ ca, viewedAt })),
  };
}

export function applyImport(hive, recent, parsed, mode) {
  if (mode === "replace") {
    hive.replaceAll(parsed.tokens);
    if (parsed.recent) recent.replaceAll(parsed.recent);
    return { added: parsed.tokens.length, updated: 0, total: hive.list().length, replaced: true };
  }
  const result = hive.merge(parsed.tokens);
  return { ...result, replaced: false };
}

export function cleanNote(note) {
  if (typeof note !== "string") return "";
  return note.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 280);
}

function cleanLabel(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}
