import { launchFeeConfig } from "./config.js";
import { describeLaunch, rawSupply } from "./launch-form.js";

export const CLUSTERS = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const METADATA_ACCOUNT_SIZE = 679;

let solanaPromise = null;

export function loadSolana() {
  if (!solanaPromise) {
    solanaPromise = import("../vendor/solana-bundle.js");
  }
  return solanaPromise;
}

export function clusterUrl(cluster) {
  return CLUSTERS[cluster] || CLUSTERS.devnet;
}

export async function estimateLaunchLamports(connection, fee) {
  const solana = await loadSolana();
  const mintRent = await connection.getMinimumBalanceForRentExemption(solana.MINT_SIZE);
  const accountRent = await connection.getMinimumBalanceForRentExemption(solana.ACCOUNT_SIZE);
  const metadataRent = await connection.getMinimumBalanceForRentExemption(METADATA_ACCOUNT_SIZE);
  const txFee = 10000;
  const launchFee = fee ? solToLamports(fee.sol) : 0n;
  const total = BigInt(mintRent) + BigInt(accountRent) + BigInt(metadataRent) + BigInt(txFee) + launchFee;
  return {
    mintRent,
    accountRent,
    metadataRent,
    txFee,
    launchFee,
    total,
  };
}

export async function prepareLaunch({
  connection,
  payer,
  form,
  revokeMint,
  revokeFreeze,
  fee = launchFeeConfig(),
}) {
  const solana = await loadSolana();
  const payerKey = new solana.PublicKey(payer);
  const mint = solana.Keypair.generate();
  const ata = solana.getAssociatedTokenAddressSync(mint.publicKey, payerKey);
  const metadataProgram = new solana.PublicKey(METADATA_PROGRAM_ID);
  const [metadata] = solana.PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("metadata"),
      metadataProgram.toBytes(),
      mint.publicKey.toBytes(),
    ],
    metadataProgram,
  );
  const mintRent = await connection.getMinimumBalanceForRentExemption(solana.MINT_SIZE);
  const amount = rawSupply(form.supply, form.decimals);
  const transaction = new solana.Transaction();
  transaction.add(solana.SystemProgram.createAccount({
    fromPubkey: payerKey,
    newAccountPubkey: mint.publicKey,
    space: solana.MINT_SIZE,
    lamports: mintRent,
    programId: solana.TOKEN_PROGRAM_ID,
  }));
  transaction.add(solana.createInitializeMint2Instruction(
    mint.publicKey,
    form.decimals,
    payerKey,
    payerKey,
  ));
  transaction.add(solana.createAssociatedTokenAccountInstruction(
    payerKey,
    ata,
    payerKey,
    mint.publicKey,
  ));
  transaction.add(solana.createMintToInstruction(
    mint.publicKey,
    ata,
    payerKey,
    amount,
  ));
  transaction.add(createMetadataInstruction(solana, {
    metadata,
    mint: mint.publicKey,
    payer: payerKey,
    name: form.name,
    symbol: form.symbol,
    uri: form.metadataUri,
  }));
  if (revokeMint) {
    transaction.add(solana.createSetAuthorityInstruction(
      mint.publicKey,
      payerKey,
      solana.AuthorityType.MintTokens,
      null,
    ));
  }
  if (revokeFreeze) {
    transaction.add(solana.createSetAuthorityInstruction(
      mint.publicKey,
      payerKey,
      solana.AuthorityType.FreezeAccount,
      null,
    ));
  }
  if (fee) {
    transaction.add(solana.SystemProgram.transfer({
      fromPubkey: payerKey,
      toPubkey: new solana.PublicKey(fee.wallet),
      lamports: solToLamports(fee.sol),
    }));
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = payerKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.partialSign(mint);
  return {
    transaction,
    mint,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    actions: describeLaunch(form, { revokeMint, revokeFreeze, fee }),
  };
}

export async function confirmSignature(connection, signature, lastValidBlockHeight) {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    const status = await connection.getSignatureStatuses([signature]);
    const value = status && status.value && status.value[0];
    if (value && value.err) throw new Error("The transaction failed on chain.");
    if (value && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) return;
    const height = await connection.getBlockHeight("confirmed");
    if (typeof lastValidBlockHeight === "number" && height > lastValidBlockHeight) {
      throw new Error("The transaction expired before it was confirmed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The transaction was not confirmed in time.");
}

export function forgetMint(mint) {
  if (mint && mint.secretKey && typeof mint.secretKey.fill === "function") {
    mint.secretKey.fill(0);
  }
}

function createMetadataInstruction(solana, { metadata, mint, payer, name, symbol, uri }) {
  const program = new solana.PublicKey(METADATA_PROGRAM_ID);
  const data = concatBytes([
    Uint8Array.of(33),
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
    u16(0),
    Uint8Array.of(0),
    Uint8Array.of(0),
    Uint8Array.of(0),
    Uint8Array.of(1),
    Uint8Array.of(0),
  ]);
  return new solana.TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: solana.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: solana.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function encodeString(value) {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function solToLamports(sol) {
  const text = String(sol);
  if (!/^\d+(\.\d+)?$/.test(text)) return 0n;
  const [whole, frac = ""] = text.split(".");
  const fracPadded = `${frac}000000000`.slice(0, 9);
  return BigInt(whole) * 1000000000n + BigInt(fracPadded);
}

export function formatLamports(lamports) {
  const value = BigInt(lamports);
  const whole = value / 1000000000n;
  const frac = (value % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}
