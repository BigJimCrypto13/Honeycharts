import { launchFeeConfig } from "./config.js";
import { pumpMetadata } from "./launch-form.js";

export const CLUSTERS = {
  mainnet: "https://api.mainnet-beta.solana.com",
};

export const PUMP_PRIORITY_FEE_SOL = 0.00005;
const PUMP_LOCAL = "https://pumpportal.fun/api/trade-local";
const PUMP_IPFS = "https://pump.fun/api/ipfs";
const LITTERBOX = "https://litterbox.catbox.moe/resources/internals/api.php";

let solanaPromise = null;

export function loadSolana() {
  if (!solanaPromise) {
    solanaPromise = import("../vendor/solana-bundle.js");
  }
  return solanaPromise;
}

export function clusterUrl() {
  return CLUSTERS.mainnet;
}

export function solToLamports(sol) {
  const text = typeof sol === "number" ? String(sol) : String(sol || "0").trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) throw new Error("Invalid SOL amount.");
  const [whole, frac = ""] = text.split(".");
  const padded = (frac + "000000000").slice(0, 9);
  return BigInt(whole) * 1000000000n + BigInt(padded);
}

export function formatLamports(lamports) {
  const value = typeof lamports === "bigint" ? lamports : BigInt(lamports);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1000000000n;
  const frac = (abs % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function forgetMint(mint) {
  if (mint && mint.secretKey) mint.secretKey.fill(0);
}

export async function uploadLaunchMetadata(form) {
  if (form.metadataUri) return form.metadataUri;
  const fromPump = await tryPumpIpfs(form);
  if (fromPump) return fromPump;
  return uploadViaLitterbox(form);
}

async function tryPumpIpfs(form) {
  try {
    const body = new FormData();
    body.append("file", form.image, fileName(form.image, "token.png"));
    body.append("name", form.name);
    body.append("symbol", form.symbol);
    body.append("description", form.description);
    body.append("twitter", form.twitter || "");
    body.append("telegram", form.telegram || "");
    body.append("website", form.website || "");
    body.append("showName", "true");
    const response = await fetch(PUMP_IPFS, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return "";
    const payload = await response.json().catch(() => null);
    const uri = payload && (payload.metadataUri || payload.metadata_uri);
    return httpsUri(uri);
  } catch {
    return "";
  }
}

async function uploadViaLitterbox(form) {
  const imageUrl = await uploadLitterboxFile(form.image, fileName(form.image, "token.png"));
  const json = JSON.stringify(pumpMetadata(form, imageUrl));
  const metadataFile = new File([json], "metadata.json", { type: "application/json" });
  return uploadLitterboxFile(metadataFile, "metadata.json");
}

async function uploadLitterboxFile(file, name) {
  const body = new FormData();
  body.append("reqtype", "fileupload");
  body.append("time", "72h");
  body.append("fileToUpload", file, name);
  const response = await fetch(LITTERBOX, { method: "POST", body });
  const text = (await response.text()).trim();
  const url = hostedFileUrl(text);
  if (!response.ok || !url) throw new Error("The image upload did not return a link. Paste an https metadata link and try again.");
  return url;
}

export function hostedFileUrl(text) {
  const value = String(text || "").trim();
  if (!/^https:\/\/litter\.catbox\.moe\/[A-Za-z0-9]+\.[A-Za-z0-9]{2,5}$/.test(value)) return "";
  return value;
}

function httpsUri(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^https:\/\/[^\s]+$/.test(text) || text.length > 300) return "";
  try {
    const url = new URL(text);
    if (url.username || url.password || url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function fileName(file, fallback) {
  const name = file && typeof file.name === "string" ? file.name : "";
  return /^[A-Za-z0-9._-]{1,80}$/.test(name) ? name : fallback;
}

export async function prepareLaunch({
  connection,
  payer,
  form,
  metadataUri,
  fee = launchFeeConfig(),
}) {
  const solana = await loadSolana();
  const mint = solana.Keypair.generate();
  const response = await fetch(PUMP_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/octet-stream" },
    body: JSON.stringify({
      publicKey: payer,
      action: "create",
      tokenMetadata: {
        name: form.name,
        symbol: form.symbol,
        uri: metadataUri,
      },
      mint: mint.publicKey.toBase58(),
      denominatedInSol: "true",
      amount: form.initialBuySol,
      slippage: 10,
      priorityFee: PUMP_PRIORITY_FEE_SOL,
      pool: "pump",
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(clip(text || "Pump.fun did not build a launch transaction."));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let transaction = solana.VersionedTransaction.deserialize(bytes);
  if (fee) transaction = await addLaunchFee(solana, connection, transaction, payer, fee);
  transaction.sign([mint]);
  return { transaction, mint };
}

export async function addLaunchFee(solana, connection, transaction, payer, fee) {
  const lookups = [];
  for (const lookup of transaction.message.addressTableLookups) {
    const found = await connection.getAddressLookupTable(lookup.accountKey);
    if (!found || !found.value) throw new Error("Couldn't load a Solana address table for this launch.");
    lookups.push(found.value);
  }
  const message = solana.TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts: lookups,
  });
  message.instructions.push(solana.SystemProgram.transfer({
    fromPubkey: new solana.PublicKey(payer),
    toPubkey: new solana.PublicKey(fee.wallet),
    lamports: Number(solToLamports(fee.sol)),
  }));
  return new solana.VersionedTransaction(message.compileToV0Message(lookups));
}

export async function confirmSignature(connection, signature, lastValidBlockHeight) {
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const status = await connection.getSignatureStatuses([signature]);
    const value = status && status.value && status.value[0];
    if (value && value.err) throw new Error("The launch transaction failed on Solana.");
    if (value && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) return;
    const height = await connection.getBlockHeight("confirmed");
    if (typeof lastValidBlockHeight === "number" && height > lastValidBlockHeight) {
      throw new Error("The launch transaction expired before it confirmed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("The launch transaction was sent but did not confirm in time.");
}

function clip(text) {
  return String(text).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 160);
}
