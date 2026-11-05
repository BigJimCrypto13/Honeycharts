// Pure wallet math. No network, no DOM, no key material.

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xyybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const BASE_SIGNATURE_FEE = 5000n;
export const TOKEN_ACCOUNT_RENT = 2039280n;
export const RENT_EXEMPT_MIN = 890880n;
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const HIVE_VAULT_KEY = "honeycharts.hivevault.v1";
export const EXTERNAL_WALLET_KEY = "honeycharts.wallet.external";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i += 1) ALPHABET_INDEX[ALPHABET.charCodeAt(i)] = i;

export const DEPOSIT_GUIDES = [
  {
    id: "robinhood",
    label: "From Robinhood",
    steps: [
      "Open Robinhood and tap Crypto.",
      "Pick SOL or USDC, then tap Send.",
      "Paste this address and choose the Solana network.",
    ],
  },
  {
    id: "coinbase",
    label: "From Coinbase",
    steps: [
      "Open Coinbase and tap Send.",
      "Choose SOL or USDC.",
      "Paste this address and select the Solana network.",
    ],
  },
  {
    id: "phantom",
    label: "From Phantom",
    steps: [
      "Open Phantom and tap Send.",
      "Choose SOL or USDC.",
      "Paste this address. Phantom already sends on Solana.",
    ],
  },
  {
    id: "other",
    label: "Other wallet",
    steps: [
      "Open the wallet or exchange you already use.",
      "Choose Send, then SOL or USDC.",
      "Paste this address and send on the Solana network only.",
    ],
  },
];

export function decodeBase58(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 32 || text.length > 44) return null;
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const bytes = [];
  for (let i = zeros; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const digit = code < 128 ? ALPHABET_INDEX[code] : -1;
    if (digit < 0) return null;
    let carry = digit;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    while (carry > 0) {
      bytes.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[out.length - 1 - i] = bytes[i];
  return out;
}

export function encodeBase58(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

export function isSolanaAddress(value) {
  const bytes = decodeBase58(typeof value === "string" ? value.trim() : "");
  return Boolean(bytes && bytes.length === 32);
}

export function addressFromScan(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const uri = text.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  if (uri) return uri[1];
  return text;
}

export function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return isSolanaAddress(text) ? text : "";
}

export function withdrawAddressError(address, ownAddress) {
  const text = typeof address === "string" ? address.trim() : "";
  if (!text) return "Paste a Solana address.";
  if (!isSolanaAddress(text)) {
    return "That is not a Solana address. Use the long base58 address and send on the Solana network only.";
  }
  const own = typeof ownAddress === "string" ? ownAddress.trim() : "";
  if (own && text === own) return "That is this wallet. Paste a different address.";
  return "";
}

export function parseTokenAmount(input, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const text = typeof input === "number" && Number.isFinite(input)
    ? String(input)
    : typeof input === "string" ? input.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  if (whole.length > 15 || frac.length > decimals) return null;
  const padded = frac.padEnd(decimals, "0");
  try {
    const scale = 10n ** BigInt(decimals);
    const value = BigInt(whole) * scale + (padded ? BigInt(padded) : 0n);
    if (value <= 0n) return null;
    return value;
  } catch {
    return null;
  }
}

export function formatTokenAmount(amount, decimals) {
  if (typeof amount !== "bigint" || amount < 0n) return "";
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "";
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

export function feeParts({ tokenTransfer = false, destinationNeedsAccount = false } = {}) {
  return {
    signature: BASE_SIGNATURE_FEE,
    accountRent: tokenTransfer && destinationNeedsAccount ? TOKEN_ACCOUNT_RENT : 0n,
    reserve: RENT_EXEMPT_MIN,
  };
}

export function spendLamports(parts) {
  const signature = parts && typeof parts.signature === "bigint" ? parts.signature : 0n;
  const accountRent = parts && typeof parts.accountRent === "bigint" ? parts.accountRent : 0n;
  return signature + accountRent;
}

export function maxSolAfterFee(balanceLamports, feeLamports, rentLamports = RENT_EXEMPT_MIN) {
  let balance;
  let fee;
  let rent;
  try {
    balance = typeof balanceLamports === "bigint" ? balanceLamports : BigInt(balanceLamports);
    fee = typeof feeLamports === "bigint" ? feeLamports : BigInt(feeLamports);
    rent = typeof rentLamports === "bigint" ? rentLamports : BigInt(rentLamports);
  } catch {
    return 0n;
  }
  if (balance < 0n || fee < 0n || rent < 0n) return 0n;
  const keep = fee + rent;
  if (balance <= keep) return 0n;
  return balance - keep;
}

export function canCoverFee(solBalance, parts) {
  let balance;
  try {
    balance = typeof solBalance === "bigint" ? solBalance : BigInt(solBalance);
  } catch {
    return false;
  }
  const hold = spendLamports(parts) + (parts && typeof parts.reserve === "bigint" ? parts.reserve : 0n);
  return balance >= hold;
}

export function needsMoreSol(balanceLamports, spendRaw) {
  if (typeof balanceLamports !== "bigint") return false;
  if (balanceLamports <= 0n) return true;
  if (spendRaw == null || spendRaw === "") return false;
  let spend;
  try {
    spend = typeof spendRaw === "bigint" ? spendRaw : BigInt(spendRaw);
  } catch {
    return false;
  }
  return spend > 0n && balanceLamports < spend;
}

export function amountUsd(amount, decimals, price) {
  if (typeof amount !== "bigint" || amount < 0n) return null;
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  const scale = 10n ** BigInt(decimals);
  const human = Number(amount) / Number(scale);
  if (!Number.isFinite(human)) return null;
  return human * price;
}

export function formatUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  if (value > 0 && value < 0.01) return "<$0.01";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function shortAddress(address) {
  if (typeof address !== "string" || address.length < 8) return address || "";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function readRpcUrl(publicRpc, heliusKey) {
  const fallback = typeof publicRpc === "string" && publicRpc.startsWith("https://") ? publicRpc : "";
  const key = typeof heliusKey === "string" ? heliusKey.trim() : "";
  if (/^[A-Za-z0-9-]{8,80}$/.test(key)) {
    return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
  }
  return fallback;
}

export function wsUrlFor(httpUrl) {
  if (typeof httpUrl !== "string") return "";
  if (httpUrl.startsWith("https://solana-rpc.publicnode.com")) return "wss://solana-rpc.publicnode.com";
  if (httpUrl.startsWith("https://mainnet.helius-rpc.com")) {
    return httpUrl.replace("https://", "wss://");
  }
  return "";
}

export function emptyVault() {
  return { coldAddress: "", parked: [] };
}

export function cleanVault(raw) {
  const vault = emptyVault();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return vault;
  vault.coldAddress = normalizeAddress(raw.coldAddress);
  const parked = Array.isArray(raw.parked) ? raw.parked : [];
  const seen = new Set();
  for (const mint of parked) {
    const clean = normalizeAddress(mint);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    vault.parked.push(clean);
    if (vault.parked.length >= 40) break;
  }
  return vault;
}

export function readVault(storage) {
  if (!storage) return emptyVault();
  try {
    return cleanVault(JSON.parse(storage.getItem(HIVE_VAULT_KEY) || "null"));
  } catch {
    return emptyVault();
  }
}

export function writeVault(storage, vault) {
  if (!storage) return;
  const clean = cleanVault(vault);
  storage.setItem(HIVE_VAULT_KEY, JSON.stringify(clean));
}

export function togglePark(vault, mint) {
  const next = cleanVault(vault);
  const clean = normalizeAddress(mint);
  if (!clean) return next;
  if (next.parked.includes(clean)) next.parked = next.parked.filter((item) => item !== clean);
  else next.parked = next.parked.concat(clean).slice(0, 40);
  return next;
}

export function preferExternal(storage) {
  if (!storage) return false;
  return storage.getItem(EXTERNAL_WALLET_KEY) === "1";
}

export function setPreferExternal(storage, on) {
  if (!storage) return;
  if (on) storage.setItem(EXTERNAL_WALLET_KEY, "1");
  else storage.removeItem(EXTERNAL_WALLET_KEY);
}

export function snapshotBalances(solLamports, tokens) {
  return {
    sol: typeof solLamports === "bigint" ? solLamports : 0n,
    tokens: (Array.isArray(tokens) ? tokens : []).map((token) => ({
      mint: token.mint,
      amount: typeof token.amount === "bigint" ? token.amount : 0n,
      decimals: token.decimals,
      symbol: token.symbol || "",
    })),
  };
}

export function incomingDeltas(before, after) {
  if (!before || !after) return [];
  const events = [];
  if (typeof after.sol === "bigint" && typeof before.sol === "bigint" && after.sol > before.sol) {
    events.push({
      mint: "SOL",
      symbol: "SOL",
      decimals: SOL_DECIMALS,
      delta: after.sol - before.sol,
    });
  }
  const prior = new Map();
  for (const token of before.tokens || []) prior.set(token.mint, token.amount);
  for (const token of after.tokens || []) {
    const was = prior.get(token.mint) || 0n;
    if (token.amount > was) {
      events.push({
        mint: token.mint,
        symbol: token.symbol || "Token",
        decimals: token.decimals,
        delta: token.amount - was,
      });
    }
  }
  return events;
}

export function depositToastText(event) {
  if (!event) return "";
  const amount = formatTokenAmount(event.delta, event.decimals);
  if (!amount) return "";
  return `Deposit received: +${amount} ${event.symbol || "Token"}`;
}

export function activityWhen(unixSeconds, nowMs) {
  if (!Number.isFinite(unixSeconds)) return "";
  const delta = Math.max(0, nowMs - unixSeconds * 1000);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function parseActivityRows(tx, owner) {
  if (!tx || typeof owner !== "string" || !isSolanaAddress(owner)) return [];
  const meta = tx.meta;
  if (!meta || meta.err) return [];
  const keys = accountKeyList(tx);
  const index = keys.indexOf(owner);
  let solDelta = 0n;
  if (index >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
    try {
      solDelta = BigInt(meta.postBalances[index] || 0) - BigInt(meta.preBalances[index] || 0);
    } catch {
      solDelta = 0n;
    }
  }
  const tokens = tokenDeltas(meta, owner);
  const signature = signatureOf(tx);
  const when = Number.isFinite(tx.blockTime) ? tx.blockTime : null;
  const rows = [];
  for (const token of tokens) {
    rows.push(activityRow(signature, when, token.delta, token.decimals, token.symbol || "Token", token.mint));
  }
  const feeNoise = tokens.length > 0 && solDelta < 0n && solDelta > -50000n;
  if (solDelta !== 0n && !feeNoise) {
    rows.push(activityRow(signature, when, solDelta, SOL_DECIMALS, "SOL", "SOL"));
  }
  return rows;
}

export function sumHoldings(accounts) {
  const map = new Map();
  for (const row of accounts || []) {
    if (!row || !isSolanaAddress(row.mint) || typeof row.amount !== "bigint") continue;
    const current = map.get(row.mint);
    if (!current) {
      map.set(row.mint, {
        mint: row.mint,
        amount: row.amount,
        decimals: row.decimals,
        account: row.account,
        programId: row.programId || TOKEN_PROGRAM_ID,
        sourceAmount: row.amount,
      });
      continue;
    }
    current.amount += row.amount;
    if (row.amount > 0n && (!current.account || row.amount > (current.sourceAmount || 0n))) {
      current.account = row.account;
      current.programId = row.programId || current.programId;
      current.sourceAmount = row.amount;
    }
  }
  return [...map.values()];
}

export function offlineTransfers(vault, holdings) {
  const clean = cleanVault(vault);
  if (!clean.coldAddress) return [];
  const parked = new Set(clean.parked);
  const transfers = [];
  for (const row of holdings || []) {
    if (!parked.has(row.mint) || row.amount <= 0n) continue;
    transfers.push({
      mint: row.mint,
      amount: row.amount,
      decimals: row.decimals,
      account: row.account,
      programId: row.programId || TOKEN_PROGRAM_ID,
      symbol: row.symbol || "Token",
    });
  }
  return transfers;
}

export function priceFromPairs(pairs, mint) {
  if (!Array.isArray(pairs)) return null;
  let best = null;
  for (const pair of pairs) {
    const base = pair && pair.baseToken;
    if (!base || base.address !== mint) continue;
    const price = Number(pair.priceUsd);
    if (!Number.isFinite(price) || price < 0) continue;
    const liquidity = pair.liquidity && Number(pair.liquidity.usd);
    const score = Number.isFinite(liquidity) ? liquidity : 0;
    if (best && score <= best.score) continue;
    best = {
      score,
      price,
      symbol: typeof base.symbol === "string" ? base.symbol : "",
      name: typeof base.name === "string" ? base.name : "",
      image: pair.info && typeof pair.info.imageUrl === "string" ? pair.info.imageUrl : "",
    };
  }
  if (!best) return null;
  return { price: best.price, symbol: best.symbol, name: best.name, image: best.image };
}

export function stablePrice(mint, price) {
  if (typeof price === "number" && Number.isFinite(price)) return price;
  if (mint === USDC_MINT) return 1;
  return null;
}

function activityRow(signature, when, delta, decimals, symbol, mint) {
  return {
    signature,
    when,
    direction: delta > 0n ? "in" : "out",
    amount: delta > 0n ? delta : -delta,
    decimals,
    symbol,
    mint,
  };
}

function signatureOf(tx) {
  const list = tx.transaction && tx.transaction.signatures;
  return Array.isArray(list) && typeof list[0] === "string" ? list[0] : "";
}

function accountKeyList(tx) {
  const message = tx.transaction && tx.transaction.message;
  const keys = message && message.accountKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => {
    if (typeof key === "string") return key;
    return key && typeof key.pubkey === "string" ? key.pubkey : "";
  });
}

function tokenDeltas(meta, owner) {
  const pre = new Map();
  for (const row of meta.preTokenBalances || []) rememberToken(pre, row, owner);
  const post = new Map();
  for (const row of meta.postTokenBalances || []) rememberToken(post, row, owner);
  const mints = new Set([...pre.keys(), ...post.keys()]);
  const events = [];
  for (const mint of mints) {
    const before = pre.get(mint);
    const after = post.get(mint);
    const delta = (after ? after.amount : 0n) - (before ? before.amount : 0n);
    if (delta === 0n) continue;
    const sample = after || before;
    events.push({ mint, delta, decimals: sample.decimals, symbol: sample.symbol });
  }
  return events;
}

function rememberToken(map, row, owner) {
  if (!row || row.owner !== owner || !row.uiTokenAmount) return;
  const mint = row.mint;
  if (!isSolanaAddress(mint)) return;
  let amount = 0n;
  try {
    amount = BigInt(row.uiTokenAmount.amount);
  } catch {
    return;
  }
  const decimals = Number(row.uiTokenAmount.decimals);
  const current = map.get(mint);
  if (!current) {
    map.set(mint, { amount, decimals: Number.isInteger(decimals) ? decimals : 0, symbol: "" });
    return;
  }
  current.amount += amount;
}

function sampleBytes(seed) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = (seed * 13 + i * 17) & 0xff;
  if (bytes[0] === 0) bytes[0] = seed || 1;
  return bytes;
}

export const SAMPLE_ADDRESS = encodeBase58(sampleBytes(4));
export const SAMPLE_COLD = encodeBase58(sampleBytes(9));

const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

export function sampleSnapshot(nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  return {
    address: SAMPLE_ADDRESS,
    sol: 1500000000n,
    tokens: [
      {
        mint: USDC_MINT,
        amount: 25000000n,
        decimals: USDC_DECIMALS,
        symbol: "USDC",
        name: "USD Coin",
        usd: 25,
        image: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
        account: SAMPLE_ADDRESS,
        programId: TOKEN_PROGRAM_ID,
      },
      {
        mint: BONK_MINT,
        amount: 125000000000n,
        decimals: 5,
        symbol: "BONK",
        name: "Bonk",
        usd: 18.4,
        image: "https://assets.coingecko.com/coins/images/28600/small/bonk.jpg",
        account: SAMPLE_ADDRESS,
        programId: TOKEN_PROGRAM_ID,
      },
    ],
    activity: [
      { signature: "sample-sol-in", direction: "in", amount: 500000000n, decimals: SOL_DECIMALS, symbol: "SOL", mint: "SOL", when: now - 3600 },
      { signature: "sample-usdc-out", direction: "out", amount: 10000000n, decimals: USDC_DECIMALS, symbol: "USDC", mint: USDC_MINT, when: now - 86400 },
    ],
    coldAddress: SAMPLE_COLD,
    parked: [BONK_MINT],
    solPrice: 150,
  };
}
