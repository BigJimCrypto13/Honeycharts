import { pumpMetadata } from "./launch-form.js";

const PRICE_URL = "https://uploader.irys.xyz/price/solana/";
const GATEWAY = "https://gateway.irys.xyz";

let bundlePromise = null;

function loadIrys() {
  if (!bundlePromise) bundlePromise = import("../vendor/irys-bundle.js");
  return bundlePromise;
}

export function gatewayUri(id) {
  const text = typeof id === "string" ? id.trim() : "";
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(text)) return "";
  return `${GATEWAY}/${text}`;
}

export async function quoteStorageLamports(bytes) {
  const size = Math.max(1, Math.ceil(Number(bytes) || 0));
  const response = await fetch(`${PRICE_URL}${size}`);
  const text = (await response.text()).trim();
  if (!response.ok || !/^\d+$/.test(text)) throw new Error("Couldn't price permanent storage.");
  return BigInt(text);
}

export function irysWallet(provider) {
  if (!provider || !provider.publicKey || typeof provider.publicKey.toBuffer !== "function") {
    throw new Error("Connect Phantom or Solflare before storing the image.");
  }
  return {
    publicKey: provider.publicKey,
    async signMessage(message) {
      if (typeof provider.signMessage !== "function") {
        throw new Error("This wallet cannot sign the storage message.");
      }
      const signed = await provider.signMessage(message, "utf8");
      if (signed instanceof Uint8Array) return signed;
      if (signed && signed.signature instanceof Uint8Array) return signed.signature;
      throw new Error("The wallet did not return a storage signature.");
    },
    async sendTransaction(transaction, connection, options) {
      if (typeof provider.sendTransaction !== "function") {
        throw new Error("This wallet cannot pay for storage.");
      }
      return provider.sendTransaction(transaction, connection, options);
    },
  };
}

export async function uploadPermanent(form, provider) {
  if (!form || !form.image) throw new Error("Choose an image or paste a metadata link.");
  const { WebUploader, WebSolana } = await loadIrys();
  const irys = await WebUploader(WebSolana).withProvider(irysWallet(provider)).mainnet();
  const imageBytes = new Uint8Array(await form.image.arrayBuffer());
  const imageId = receiptId(await payAndUpload(irys, imageBytes, form.image.type || "image/png"));
  const imageUrl = gatewayUri(imageId);
  if (!imageUrl) throw new Error("Permanent image storage did not return a link.");
  const json = new TextEncoder().encode(JSON.stringify(pumpMetadata(form, imageUrl)));
  const metadataId = receiptId(await payAndUpload(irys, json, "application/json"));
  const uri = gatewayUri(metadataId);
  if (!uri) throw new Error("Permanent metadata storage did not return a link.");
  return uri;
}

async function payAndUpload(irys, bytes, contentType) {
  const data = globalThis.Buffer ? globalThis.Buffer.from(bytes) : bytes;
  const price = await irys.getPrice(data.length);
  const balance = await irys.getBalance();
  if (balance.isLessThan(price)) {
    const due = price.minus(balance).integerValue();
    if (!due.isZero()) await irys.fund(due);
  }
  return irys.upload(data, { tags: [{ name: "Content-Type", value: contentType }] });
}

function receiptId(receipt) {
  if (!receipt) return "";
  if (typeof receipt === "string") return receipt;
  if (typeof receipt.id === "string") return receipt.id;
  return "";
}
