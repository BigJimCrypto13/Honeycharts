// Pure account rules: usernames, profile songs, and Hive merge.
// No network, no wallet, no DOM.

import { isValidCA, httpsOnlyUrl } from "./sanitize.js";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const BIO_MAX = 280;
export const DISPLAY_NAME_MAX = 40;
export const SONG_TITLE_MAX = 80;
export const HIVE_SYNC_LIMIT = 200;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "api",
  "everyone",
  "help",
  "hive",
  "honey",
  "honeycharts",
  "launch",
  "moderator",
  "null",
  "official",
  "owner",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "undefined",
  "wallet",
  "www",
];

const RESERVED = new Set(RESERVED_USERNAMES);
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const ACCOUNTS_OFFLINE = "Accounts are coming online. Profiles, follows, and Hive sync start after the database is switched on. Your Hive stays on this browser.";
export const HIVE_LEAD_LOCAL = "A watchlist saved in this browser only. It is not uploaded, and it is not a portfolio.";
export const HIVE_LEAD_SYNCED = "Saved in this browser and copied to your account. Notes stay on this browser. It is not a portfolio.";
export const HIVE_LEAD_OFFLINE = "Saved in this browser. Account sync is coming online. It is not a portfolio.";

export function validateUsername(raw) {
  if (typeof raw !== "string") return fail("Pick a username.");
  const username = raw.trim().toLowerCase();
  if (!username) return fail("Pick a username.");
  if (username.length < USERNAME_MIN) return fail("Usernames need at least 3 characters.");
  if (username.length > USERNAME_MAX) return fail("Usernames can be at most 20 characters.");
  if (!/^[a-z]/.test(username)) return fail("Usernames start with a letter.");
  if (!/^[a-z0-9_]+$/.test(username)) return fail("Use letters, numbers, and underscores only.");
  if (username.endsWith("_") || username.includes("__")) {
    return fail("Don't end a username with an underscore, or use two in a row.");
  }
  if (RESERVED.has(username)) return fail("That username is reserved.");
  return { ok: true, username };
}

export function validateEmail(raw) {
  if (typeof raw !== "string") return fail("Enter an email address.");
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail("That email address does not look valid.");
  }
  return { ok: true, email };
}

export function validatePassword(raw) {
  if (typeof raw !== "string" || raw.length < 8) {
    return fail("Use a password of at least 8 characters.");
  }
  if (raw.length > 72) return fail("That password is too long.");
  return { ok: true, password: raw };
}

export function validateAvatarFile(file) {
  if (!file) return fail("Choose an image.");
  const type = typeof file.type === "string" ? file.type : "";
  if (!AVATAR_TYPES.has(type)) return fail("Use a PNG, JPG, WEBP, or GIF.");
  const size = typeof file.size === "number" ? file.size : 0;
  if (size <= 0 || size > AVATAR_MAX_BYTES) return fail("That image must be under 2 MB.");
  return { ok: true };
}

export function cleanXHandle(raw) {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: "" };
  let value = String(raw).trim();
  value = value.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "");
  value = value.replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) {
    return fail("X handle should be 1–15 letters, numbers, or underscores.");
  }
  return { ok: true, value };
}

export function cleanTelegram(raw) {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: "" };
  let value = String(raw).trim();
  value = value.replace(/^https?:\/\/(www\.)?t\.me\//i, "");
  value = value.replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{5,32}$/.test(value)) {
    return fail("Telegram username should be 5–32 letters, numbers, or underscores.");
  }
  return { ok: true, value };
}

export function cleanSolanaAddress(raw) {
  if (raw == null || String(raw).trim() === "") return { ok: true, value: "" };
  const value = String(raw).trim();
  if (!isValidCA(value)) return fail("That public Solana address is not valid.");
  return { ok: true, value };
}

export function parseSongUrl(raw) {
  if (raw == null || String(raw).trim() === "") return { ok: true, song: null };
  const href = httpsOnlyUrl(String(raw).trim(), 500);
  if (!href) return fail("Paste an https link to an mp3, YouTube, or SoundCloud.");
  let url;
  try {
    url = new URL(href);
  } catch {
    return fail("Paste an https link to an mp3, YouTube, or SoundCloud.");
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const videoId = youtubeId(url, host);
  if (videoId) {
    return {
      ok: true,
      song: {
        kind: "youtube",
        videoId,
        pageUrl: href,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0`,
      },
    };
  }
  if (host === "w.soundcloud.com") {
    url.searchParams.set("auto_play", "false");
    return {
      ok: true,
      song: { kind: "soundcloud", pageUrl: href, embedUrl: url.href },
    };
  }
  if (host === "soundcloud.com" || host === "m.soundcloud.com" || host === "on.soundcloud.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const short = host === "on.soundcloud.com" && parts.length >= 1;
    const track = parts.length >= 2 && parts[0] !== "discover" && parts[0] !== "you";
    if (!short && !track) return fail("Paste a SoundCloud track link, not the SoundCloud home page.");
    const pageUrl = `${url.origin}${url.pathname}`;
    const embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(pageUrl)}&auto_play=false&hide_related=true&show_comments=false`;
    return { ok: true, song: { kind: "soundcloud", pageUrl, embedUrl } };
  }
  if (AUDIO_EXT.test(url.pathname)) {
    return { ok: true, song: { kind: "audio", src: href, pageUrl: href } };
  }
  return fail("That link is not an mp3 (or ogg, wav, m4a), YouTube, or SoundCloud URL.");
}

export function songPlayerPlan(song) {
  if (!song) return null;
  return {
    kind: song.kind,
    showPlayButton: true,
    autoplay: false,
    src: song.kind === "audio" ? song.src : song.embedUrl,
  };
}

export function cleanProfileDraft(input) {
  const source = input && typeof input === "object" ? input : {};
  const errors = {};
  let username = "";
  const usernameRaw = source.username == null ? "" : String(source.username);
  if (usernameRaw.trim()) {
    const checked = validateUsername(usernameRaw);
    if (!checked.ok) errors.username = checked.error;
    else username = checked.username;
  }
  const displayName = plainText(source.displayName, DISPLAY_NAME_MAX);
  if (source.displayName != null && String(source.displayName).trim() && !displayName.ok) {
    errors.displayName = "Display name must be 40 characters or fewer, with no control characters.";
  }
  const bio = plainText(source.bio, BIO_MAX);
  if (source.bio != null && String(source.bio).trim() && !bio.ok) {
    errors.bio = "Bio must be 280 characters or fewer, with no control characters.";
  }
  let website = "";
  if (source.website != null && String(source.website).trim()) {
    const href = httpsOnlyUrl(String(source.website).trim(), 200);
    if (!href) errors.website = "Website must be an https link.";
    else website = href;
  }
  const xHandle = cleanXHandle(source.xHandle);
  if (!xHandle.ok) errors.xHandle = xHandle.error;
  const telegram = cleanTelegram(source.telegram);
  if (!telegram.ok) errors.telegram = telegram.error;
  const solanaAddress = cleanSolanaAddress(source.solanaAddress);
  if (!solanaAddress.ok) errors.solanaAddress = solanaAddress.error;
  let songUrl = "";
  if (source.songUrl != null && String(source.songUrl).trim()) {
    const song = parseSongUrl(source.songUrl);
    if (!song.ok) errors.songUrl = song.error;
    else songUrl = song.song.pageUrl || song.song.src;
  }
  const songTitle = plainText(source.songTitle, SONG_TITLE_MAX);
  if (source.songTitle != null && String(source.songTitle).trim() && !songTitle.ok) {
    errors.songTitle = "Song title must be 80 characters or fewer.";
  }
  const hivePublic = source.hivePublic !== false;
  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    values: {
      username,
      displayName: displayName.ok ? displayName.value : "",
      bio: bio.ok ? bio.value : "",
      website,
      xHandle: xHandle.ok ? xHandle.value : "",
      telegram: telegram.ok ? telegram.value : "",
      solanaAddress: solanaAddress.ok ? solanaAddress.value : "",
      songUrl,
      songTitle: songTitle.ok ? songTitle.value : "",
      hivePublic,
    },
  };
}

export function profileFromRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: typeof row.id === "string" ? row.id : "",
    username: typeof row.username === "string" ? row.username : "",
    displayName: typeof row.display_name === "string" ? row.display_name : "",
    avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : "",
    bio: typeof row.bio === "string" ? row.bio : "",
    website: typeof row.website === "string" ? row.website : "",
    xHandle: typeof row.x_handle === "string" ? row.x_handle : "",
    telegram: typeof row.telegram === "string" ? row.telegram : "",
    solanaAddress: typeof row.solana_address === "string" ? row.solana_address : "",
    songUrl: typeof row.profile_song_url === "string" ? row.profile_song_url : "",
    songTitle: typeof row.profile_song_title === "string" ? row.profile_song_title : "",
    hivePublic: row.hive_public !== false,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export function profileToRow(id, values) {
  return {
    id,
    username: values.username || null,
    display_name: values.displayName || null,
    bio: values.bio || null,
    website: values.website || null,
    x_handle: values.xHandle || null,
    telegram: values.telegram || null,
    solana_address: values.solanaAddress || null,
    profile_song_url: values.songUrl || null,
    profile_song_title: values.songTitle || null,
    hive_public: values.hivePublic !== false,
  };
}

export function solanaAddressFromUser(user) {
  if (!user || typeof user !== "object") return "";
  const candidates = [];
  const identities = Array.isArray(user.identities) ? user.identities : [];
  for (const identity of identities) {
    const data = identity && identity.identity_data;
    if (data && typeof data === "object") {
      candidates.push(data.address, data.wallet_address, data.sub);
    }
  }
  const meta = user.user_metadata;
  if (meta && typeof meta === "object") {
    candidates.push(meta.solana_address, meta.address, meta.wallet_address);
  }
  for (const value of candidates) {
    if (isValidCA(value)) return value;
  }
  return "";
}

export function safeAvatarUrl(value, supabaseHost) {
  const href = httpsOnlyUrl(typeof value === "string" ? value : "", 500);
  if (!href || !supabaseHost) return "";
  let url;
  try {
    url = new URL(href);
  } catch {
    return "";
  }
  if (url.hostname !== supabaseHost) return "";
  if (!url.pathname.includes("/avatars/")) return "";
  return href;
}

export function isSchemaOffline(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const blob = `${code} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  if (code === "42P01" || code === "PGRST205" || code === "PGRST204") return true;
  return blob.includes("does not exist")
    || blob.includes("schema cache")
    || blob.includes("could not find the table");
}

export function friendlyAuthError(error) {
  const text = error && typeof error.message === "string" ? error.message : "";
  const lower = text.toLowerCase();
  if (/reject|cancel|denied|closed/i.test(text)) return "The wallet closed the login request. Nothing was signed.";
  if (lower.includes("web3") && (lower.includes("disabled") || lower.includes("not enabled"))) {
    return "Solana sign-in is not switched on yet. Email sign-in can still work.";
  }
  if (lower.includes("provider is not enabled") || lower.includes("unsupported provider")) {
    return "That sign-in method is not switched on yet.";
  }
  if (error && (error.status === 429 || lower.includes("rate limit"))) {
    return "Too many sign-in attempts. Wait a minute, then try again.";
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "That email and password did not match.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "That email already has an account. Sign in instead.";
  }
  if (isSchemaOffline(error)) return ACCOUNTS_OFFLINE;
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Couldn't reach accounts just now. The rest of Honey Charts still works.";
  }
  if (text && text.length <= 180 && !/key|token|secret/i.test(text)) return text;
  return "That didn't work. Try again in a moment.";
}

export function mergeHiveLists(localTokens, remoteItems, limit = HIVE_SYNC_LIMIT) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : HIVE_SYNC_LIMIT;
  const seen = new Set();
  const local = [];
  for (const token of Array.isArray(localTokens) ? localTokens : []) {
    if (!token || !isValidCA(token.ca) || seen.has(token.ca)) continue;
    seen.add(token.ca);
    local.push({
      ca: token.ca,
      note: typeof token.note === "string" ? token.note : "",
      name: typeof token.name === "string" ? token.name : "",
      symbol: typeof token.symbol === "string" ? token.symbol : "",
      addedAt: timeOf(token.addedAt),
    });
  }
  const remoteByMint = new Map();
  for (const item of Array.isArray(remoteItems) ? remoteItems : []) {
    const mint = item && (item.mint || item.ca);
    if (!isValidCA(mint) || remoteByMint.has(mint)) continue;
    const rawTime = item.addedAt != null ? item.addedAt : item.added_at;
    remoteByMint.set(mint, timeOf(rawTime));
  }
  const merged = [];
  const toUpload = [];
  for (const token of local) {
    const hadRemote = remoteByMint.has(token.ca);
    const remoteAt = hadRemote ? remoteByMint.get(token.ca) : 0;
    let addedAt = token.addedAt;
    if (remoteAt > 0 && (addedAt <= 0 || remoteAt < addedAt)) addedAt = remoteAt;
    merged.push({ ...token, addedAt });
    const remoteNeedsLocalTime = hadRemote && addedAt > 0 && remoteAt !== addedAt && (remoteAt <= 0 || addedAt < remoteAt);
    if (!hadRemote || remoteNeedsLocalTime) toUpload.push({ mint: token.ca, addedAt });
    remoteByMint.delete(token.ca);
  }
  const remoteOnly = [...remoteByMint.entries()]
    .map(([mint, addedAt]) => ({ ca: mint, note: "", name: "", symbol: "", addedAt }))
    .sort((a, b) => a.addedAt - b.addedAt || a.ca.localeCompare(b.ca));
  const tokens = [];
  for (const token of merged) {
    if (tokens.length >= cap) break;
    tokens.push(token);
  }
  for (const token of remoteOnly) {
    if (tokens.length >= cap) break;
    tokens.push(token);
  }
  const kept = new Set(tokens.map((token) => token.ca));
  return {
    tokens,
    toUpload: toUpload.filter((item) => kept.has(item.mint)),
    dropped: merged.length + remoteOnly.length - tokens.length,
  };
}

export function followCountLabel(followers, following) {
  return `${countText(followers)} followers · ${countText(following)} following`;
}

export function hiveLeadFor(state) {
  if (!state || !state.signedIn) return "";
  if (state.schema === "offline") return HIVE_LEAD_OFFLINE;
  if (state.schema === "ready") return HIVE_LEAD_SYNCED;
  return "";
}

export function localPreviewKind(locationLike) {
  if (!locationLike) return "";
  const host = locationLike.hostname || "";
  if (host !== "localhost" && host !== "127.0.0.1") return "";
  const search = typeof locationLike.search === "string" ? locationLike.search : "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value = params.get("preview");
  if (value === "signin" || value === "profile" || value === "edit") return value;
  return "";
}

export function supabaseHostFrom(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export const SAMPLE_PROFILE = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "bigjim",
  displayName: "Big Jim",
  avatarUrl: "",
  previewAvatar: "assets/coin.webp",
  bio: "Watching Solana from the hive. Sample profile, shown only on this computer before the database is on.",
  website: "https://bigjimcrypto13.github.io/Honeycharts/",
  xHandle: "bigjimcrypto",
  telegram: "bigjimcrypto",
  solanaAddress: "7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6",
  songUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  songTitle: "Flight of the Bumblebee",
  hivePublic: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  followers: 12,
  following: 3,
  followingViewer: false,
  hive: [{ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", addedAt: 1 }],
};

function countText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "0";
  return String(Math.floor(number));
}

function timeOf(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function plainText(value, max) {
  if (value == null || String(value).trim() === "") return { ok: true, value: "" };
  const text = String(value);
  if (/[\u0000-\u001F\u007F]/.test(text)) return { ok: false, value: "" };
  const trimmed = text.trim();
  if (trimmed.length > max) return { ok: false, value: "" };
  return { ok: true, value: trimmed };
}

function youtubeId(url, host) {
  const known = host === "youtube.com"
    || host === "m.youtube.com"
    || host === "music.youtube.com"
    || host === "youtube-nocookie.com"
    || host === "youtu.be";
  if (!known) return "";
  if (host === "youtu.be") return videoId(url.pathname.split("/").filter(Boolean)[0] || "");
  if (url.pathname === "/watch" || url.pathname === "/watch/") return videoId(url.searchParams.get("v") || "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") return videoId(parts[1] || "");
  return "";
}

function videoId(value) {
  return VIDEO_ID.test(value) ? value : "";
}

function fail(error) {
  return { ok: false, error };
}
