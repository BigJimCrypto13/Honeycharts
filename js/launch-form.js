const NAME_MAX = 32;
const SYMBOL_MAX = 10;
const DESCRIPTION_MAX = 500;
const URL_MAX = 200;
const IMAGE_BYTES_MAX = 1_000_000;
const INITIAL_BUY_MAX = 10;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function validateLaunch(fields, imageFile) {
  const errors = [];
  const name = cleanText(fields && fields.name, NAME_MAX, "Name", errors, true);
  const symbol = cleanSymbol(fields && fields.symbol, errors);
  const description = cleanText(fields && fields.description, DESCRIPTION_MAX, "Description", errors, true);
  const website = cleanUrl(fields && fields.website, "Website", errors);
  const twitter = cleanUrl(fields && fields.twitter, "X", errors);
  const telegram = cleanUrl(fields && fields.telegram, "Telegram", errors);
  const initialBuySol = cleanInitialBuy(fields && fields.initialBuy, errors);
  const metadataUri = cleanMetadataUri(fields && fields.metadataUri, errors);
  const image = cleanImage(imageFile, errors, !metadataUri);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { name, symbol, description, website, twitter, telegram, initialBuySol, image, metadataUri },
  };
}

export function pumpMetadata(form, imageUrl) {
  const doc = {
    name: form.name,
    symbol: form.symbol,
    description: form.description,
    image: imageUrl,
    showName: true,
    createdOn: "https://pump.fun",
  };
  if (form.website) doc.website = form.website;
  if (form.twitter) doc.twitter = form.twitter;
  if (form.telegram) doc.telegram = form.telegram;
  return doc;
}

export function describeLaunch(form, fee) {
  const lines = [
    form.metadataUri
      ? "Use the metadata link you pasted, then create a Pump.fun bonding-curve token that can be traded immediately."
      : "Upload the image and metadata with no API key, then create a Pump.fun bonding-curve token that can be traded immediately.",
  ];
  if (form.initialBuySol > 0) {
    lines.push(`Buy ${form.initialBuySol} SOL of the new token in the same transaction.`);
  } else {
    lines.push("No initial buy. The token is still tradable on the bonding curve.");
  }
  if (fee && fee.sol > 0) {
    lines.push(`Includes ${fee.sol} SOL Honeycharts launch fee`);
  }
  lines.push("A small network priority fee is included.");
  lines.push("Pump.fun also charges its own creation cost. Your wallet shows the full total before you approve.");
  return lines;
}

export function imageDownloadName(file) {
  const type = file && file.type;
  const ext = type === "image/jpeg" ? "jpg" : type === "image/gif" ? "gif" : type === "image/webp" ? "webp" : "png";
  return `token.${ext}`;
}

function cleanText(value, max, label, errors, required) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    if (required) errors.push(`${label} is required.`);
    return "";
  }
  if (text.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
  if (/[\u0000-\u001F\u007F]/.test(text)) errors.push(`${label} cannot include control characters.`);
  return text;
}

function cleanSymbol(value, errors) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!text) {
    errors.push("Symbol is required.");
    return "";
  }
  if (text.length > SYMBOL_MAX || !/^[A-Z0-9]+$/.test(text)) {
    errors.push("Symbol must be 1–10 letters or numbers.");
  }
  return text;
}

function cleanUrl(value, label, errors) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length > URL_MAX || !/^https:\/\/[^\s]+$/.test(text) || /[\u0000-\u001F\u007F]/.test(text)) {
    errors.push(`${label} must be an https link, 200 characters or fewer.`);
    return "";
  }
  return text;
}

function cleanInitialBuy(value, errors) {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (!text || text === "0") return 0;
  if (!/^\d+(\.\d{1,9})?$/.test(text)) {
    errors.push("Initial buy must be a SOL amount such as 0 or 0.1.");
    return 0;
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > INITIAL_BUY_MAX) {
    errors.push(`Initial buy must be between 0 and ${INITIAL_BUY_MAX} SOL.`);
    return 0;
  }
  return amount;
}

function cleanMetadataUri(value, errors) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length > 300 || !/^https:\/\/[^\s]+$/.test(text) || /[\u0000-\u001F\u007F]/.test(text)) {
    errors.push("Metadata link must be an https link, 300 characters or fewer.");
    return "";
  }
  try {
    const url = new URL(text);
    if (url.username || url.password) {
      errors.push("Metadata link must be an https link, 300 characters or fewer.");
      return "";
    }
  } catch {
    errors.push("Metadata link must be an https link, 300 characters or fewer.");
    return "";
  }
  return text;
}

function cleanImage(file, errors, required) {
  if (!file) {
    if (required) errors.push("Image is required.");
    return null;
  }
  if (!IMAGE_TYPES.has(file.type)) {
    errors.push("Image must be PNG, JPEG, GIF, or WebP.");
  }
  if (typeof file.size === "number" && file.size > IMAGE_BYTES_MAX) {
    errors.push("Image must be 1 MB or smaller.");
  }
  return file;
}
