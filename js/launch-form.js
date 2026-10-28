import { httpsOnlyUrl } from "./sanitize.js";

const NAME_MAX = 32;
const SYMBOL_MAX = 10;
const DESCRIPTION_MAX = 500;
const URI_MAX = 200;
const IMAGE_URL_MAX = 500;
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const IMAGE_MAX_BYTES = 1500000;
const U64_MAX = (1n << 64n) - 1n;

export function validateLaunch(fields, imageFile, options = {}) {
  const errors = [];
  const name = readText(fields && fields.name, NAME_MAX, "Name", errors);
  const symbolRaw = readText(fields && fields.symbol, SYMBOL_MAX, "Symbol", errors);
  let symbol = "";
  if (symbolRaw) {
    if (!/^[A-Za-z0-9]{1,10}$/.test(symbolRaw)) {
      errors.push("Symbol must be 1–10 letters or numbers.");
    } else {
      symbol = symbolRaw.toUpperCase();
    }
  }
  const decimals = readDecimals(fields && fields.decimals, errors);
  const supply = readSupply(fields && fields.supply, decimals, errors);
  const imageUrl = readOptionalUrl(fields && fields.imageUrl, IMAGE_URL_MAX, "Image URL", errors);
  const description = readOptionalText(fields && fields.description, DESCRIPTION_MAX, "Description", errors);
  const website = readOptionalUrl(fields && fields.website, URI_MAX, "Website", errors);
  const twitter = readOptionalUrl(fields && fields.twitter, URI_MAX, "X link", errors);
  const telegram = readOptionalUrl(fields && fields.telegram, URI_MAX, "Telegram link", errors);
  const metadataUri = options.requireMetadata === false
    ? readOptionalUrl(fields && fields.metadataUri, URI_MAX, "Metadata link", errors)
    : readRequiredUrl(fields && fields.metadataUri, URI_MAX, "Metadata link", errors);
  const file = readImageFile(imageFile, errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      name,
      symbol,
      decimals,
      supply,
      imageUrl,
      imageFile: file,
      description,
      website,
      twitter,
      telegram,
      metadataUri,
    },
  };
}

export function metadataDocument(form) {
  const doc = {
    name: form.name,
    symbol: form.symbol,
    description: form.description,
  };
  if (form.imageUrl) doc.image = form.imageUrl;
  else if (form.imageFile) doc.image = imageDownloadName(form.imageFile);
  if (form.website) doc.external_url = form.website;
  const extensions = {};
  if (form.twitter) extensions.twitter = form.twitter;
  if (form.telegram) extensions.telegram = form.telegram;
  if (Object.keys(extensions).length) doc.extensions = extensions;
  return doc;
}

export function imageDownloadName(file) {
  const ext = IMAGE_TYPES[file && file.type] || "png";
  return `image.${ext}`;
}

export function describeLaunch(form, { revokeMint, revokeFreeze, fee }) {
  const lines = [
    `Create a new SPL token mint for ${form.symbol}.`,
    `Mint ${form.supply} ${form.symbol} (${form.decimals} decimals) to the connected wallet.`,
    `Write Metaplex metadata that points at the metadata link.`,
  ];
  if (revokeMint) lines.push("Revoke mint authority, so no more tokens of this mint can be created.");
  else lines.push("Leave mint authority on the connected wallet. That wallet can create more tokens later.");
  if (revokeFreeze) lines.push("Revoke freeze authority, so holder accounts cannot be frozen.");
  else lines.push("Leave freeze authority on the connected wallet. That wallet can freeze holder accounts.");
  if (fee) lines.push(`Transfer ${fee.sol} SOL to the launch fee address.`);
  lines.push("No liquidity pool is created.");
  return lines;
}

export function rawSupply(supply, decimals) {
  return BigInt(supply) * (10n ** BigInt(decimals));
}

function readText(value, max, label, errors) {
  if (typeof value !== "string" || /[\u0000-\u001F\u007F]/.test(value)) {
    errors.push(`${label} cannot include control characters.`);
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    errors.push(`${label} is required.`);
    return "";
  }
  if (trimmed.length > max) {
    errors.push(`${label} must be ${max} characters or fewer.`);
    return "";
  }
  return trimmed;
}

function readOptionalText(value, max, label, errors) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || /[\u0000-\u001F\u007F]/.test(value)) {
    errors.push(`${label} cannot include control characters.`);
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    errors.push(`${label} must be ${max} characters or fewer.`);
    return "";
  }
  return trimmed;
}

function readOptionalUrl(value, max, label, errors) {
  if (value == null || String(value).trim() === "") return "";
  const url = httpsOnlyUrl(value, max);
  if (!url) {
    errors.push(`${label} must be an https link, ${max} characters or fewer.`);
    return "";
  }
  return url;
}

function readRequiredUrl(value, max, label, errors) {
  const url = httpsOnlyUrl(value, max);
  if (!url) {
    errors.push(`${label} must be an https link, ${max} characters or fewer. Host metadata.json and paste that link.`);
    return "";
  }
  return url;
}

function readDecimals(value, errors) {
  const text = String(value == null || value === "" ? "6" : value).trim();
  if (!/^[0-9]$/.test(text)) {
    errors.push("Decimals must be a whole number from 0 to 9.");
    return 6;
  }
  return Number(text);
}

function readSupply(value, decimals, errors) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[1-9][0-9]{0,17}$/.test(text)) {
    errors.push("Total supply must be a whole number greater than zero.");
    return "1";
  }
  try {
    const raw = rawSupply(text, decimals);
    if (raw <= 0n || raw > U64_MAX) {
      errors.push("That supply does not fit in an SPL token with those decimals.");
      return "1";
    }
  } catch {
    errors.push("Total supply must be a whole number greater than zero.");
    return "1";
  }
  return text;
}

function readImageFile(file, errors) {
  if (!file) return null;
  if (!IMAGE_TYPES[file.type]) {
    errors.push("Image file must be PNG, JPEG, GIF, or WebP.");
    return null;
  }
  if (file.size > IMAGE_MAX_BYTES) {
    errors.push("Image file must be 1.5 MB or smaller. This site does not upload it.");
    return null;
  }
  return file;
}
