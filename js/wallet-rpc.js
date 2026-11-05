// Read-only Solana JSON-RPC. Nothing here signs or sends.

import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  isSolanaAddress,
  parseActivityRows,
  priceFromPairs,
  sumHoldings,
} from "./wallet-logic.js";

export async function rpc(url, method, params, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!response.ok) throw new Error("The Solana network did not answer.");
  const body = await response.json();
  if (body && body.error) {
    const message = body.error.message ? String(body.error.message) : "The Solana network returned an error.";
    throw new Error(message);
  }
  return body ? body.result : null;
}

export function readLamports(result) {
  try {
    if (typeof result === "number" || typeof result === "string") return BigInt(result);
    if (result && (typeof result.value === "number" || typeof result.value === "string")) return BigInt(result.value);
  } catch {
    return 0n;
  }
  return 0n;
}

export function parseTokenAccounts(result, programId) {
  const rows = result && Array.isArray(result.value) ? result.value : [];
  const parsed = [];
  for (const row of rows) {
    const info = row && row.account && row.account.data && row.account.data.parsed && row.account.data.parsed.info;
    if (!info || !isSolanaAddress(info.mint)) continue;
    let amount = 0n;
    try {
      amount = BigInt(info.tokenAmount && info.tokenAmount.amount);
    } catch {
      continue;
    }
    if (amount <= 0n) continue;
    const decimals = Number(info.tokenAmount && info.tokenAmount.decimals);
    parsed.push({
      mint: info.mint,
      amount,
      decimals: Number.isInteger(decimals) ? decimals : 0,
      account: typeof row.pubkey === "string" ? row.pubkey : "",
      programId: programId || TOKEN_PROGRAM_ID,
    });
  }
  return parsed;
}

export async function loadHoldings(url, address, signal) {
  const solResult = await rpc(url, "getBalance", [address, { commitment: "confirmed" }], signal);
  const classic = await rpc(url, "getTokenAccountsByOwner", [
    address,
    { programId: TOKEN_PROGRAM_ID },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ], signal);
  let extra = { value: [] };
  try {
    extra = await rpc(url, "getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_2022_PROGRAM_ID },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ], signal);
  } catch {
    extra = { value: [] };
  }
  return {
    sol: readLamports(solResult),
    tokens: sumHoldings([
      ...parseTokenAccounts(classic, TOKEN_PROGRAM_ID),
      ...parseTokenAccounts(extra, TOKEN_2022_PROGRAM_ID),
    ]),
  };
}

export async function loadActivity(url, address, signal) {
  const listed = await rpc(url, "getSignaturesForAddress", [address, { limit: 8 }], signal);
  const rows = [];
  for (const item of Array.isArray(listed) ? listed : []) {
    if (!item || item.err || typeof item.signature !== "string") continue;
    const tx = await rpc(url, "getTransaction", [item.signature, {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }], signal);
    if (!tx) continue;
    if (!Number.isFinite(tx.blockTime) && Number.isFinite(item.blockTime)) tx.blockTime = item.blockTime;
    rows.push(...parseActivityRows(tx, address));
    if (rows.length >= 8) break;
  }
  return rows.slice(0, 8);
}

export async function accountExists(url, address, signal) {
  const result = await rpc(url, "getAccountInfo", [address, { commitment: "confirmed" }], signal);
  return Boolean(result && result.value);
}

export async function loadTokenMeta(mints, signal) {
  const list = (mints || []).filter(isSolanaAddress).slice(0, 30);
  const meta = new Map();
  if (!list.length) return meta;
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${list.join(",")}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) return meta;
  const body = await response.json();
  const pairs = Array.isArray(body) ? body : body && body.pairs;
  for (const mint of list) {
    const found = priceFromPairs(pairs, mint);
    if (found) meta.set(mint, found);
  }
  return meta;
}

export function watchAccount(wsUrl, address, onChange) {
  if (!wsUrl || typeof WebSocket === "undefined") return () => {};
  let socket = null;
  let timer = 0;
  let closed = false;
  function open() {
    if (closed) return;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      timer = setTimeout(open, 8000);
      return;
    }
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "accountSubscribe",
        params: [address, { commitment: "confirmed", encoding: "jsonParsed" }],
      }));
    });
    socket.addEventListener("message", (event) => {
      let body = null;
      try {
        body = JSON.parse(String(event.data || ""));
      } catch {
        return;
      }
      if (body && body.method === "accountNotification") onChange();
    });
    socket.addEventListener("close", () => {
      if (!closed) timer = setTimeout(open, 8000);
    });
  }
  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    if (socket) socket.close();
  };
}
