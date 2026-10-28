const KEY = "hc-creator-v1";
const TTL_MS = 30 * 60 * 1000;
const MAX_WALLETS = 40;

export function readCreatorCache(storage, wallet, now = Date.now()) {
  const book = readBook(storage);
  const row = book && book[wallet];
  if (!row || typeof row.at !== "number" || !row.value || typeof row.value !== "object") return null;
  if (now - row.at > TTL_MS) return null;
  return row.value;
}

export function writeCreatorCache(storage, wallet, value, now = Date.now()) {
  if (!storage || typeof storage.setItem !== "function") return;
  const book = readBook(storage) || {};
  book[wallet] = { at: now, value };
  const wallets = Object.keys(book);
  if (wallets.length > MAX_WALLETS) {
    wallets.sort((a, b) => (book[a].at || 0) - (book[b].at || 0));
    for (const old of wallets.slice(0, wallets.length - MAX_WALLETS)) delete book[old];
  }
  try {
    storage.setItem(KEY, JSON.stringify(book));
  } catch {
    // A full or blocked store just means the next visit fetches again.
  }
}

function readBook(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return null;
  }
}
