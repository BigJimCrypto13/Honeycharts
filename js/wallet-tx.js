// Builds an unsigned Solana transfer. The embedded wallet approves it afterwards.

import { loadSolana } from "./launch-tx.js";
import { TOKEN_PROGRAM_ID, isSolanaAddress } from "./wallet-logic.js";

export function rawTransaction(tx) {
  if (!tx || typeof tx.serialize !== "function") return null;
  if (typeof tx.version === "number") return new Uint8Array(tx.serialize());
  return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

export async function restoreTransaction(bytes) {
  const solana = await loadSolana();
  try {
    return solana.VersionedTransaction.deserialize(bytes);
  } catch {
    return solana.Transaction.from(bytes);
  }
}

export async function destinationNeedsTokenAccount({ rpcUrl, owner, mint, programId }) {
  const solana = await loadSolana();
  const connection = new solana.Connection(rpcUrl, "confirmed");
  const ata = tokenAddress(solana, owner, mint, programId);
  const info = await connection.getAccountInfo(ata);
  return !info;
}

export async function buildSend({
  rpcUrl,
  from,
  to,
  kind,
  amount,
  mint,
  decimals,
  sourceAccount,
  programId,
}) {
  if (!isSolanaAddress(from) || !isSolanaAddress(to)) throw new Error("That address is not on Solana.");
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("Enter an amount greater than zero.");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("That amount is too large to send from this page.");
  const solana = await loadSolana();
  const connection = new solana.Connection(rpcUrl, "confirmed");
  const fromKey = new solana.PublicKey(from);
  const toKey = new solana.PublicKey(to);
  const instructions = [];
  let createdAccount = false;
  if (kind === "sol") {
    instructions.push(solana.SystemProgram.transfer({
      fromPubkey: fromKey,
      toPubkey: toKey,
      lamports: Number(amount),
    }));
  } else {
    if (!isSolanaAddress(mint)) throw new Error("That coin cannot be sent from this page.");
    const program = new solana.PublicKey(programId || TOKEN_PROGRAM_ID);
    const mintKey = new solana.PublicKey(mint);
    const source = isSolanaAddress(sourceAccount)
      ? new solana.PublicKey(sourceAccount)
      : tokenAddress(solana, from, mint, programId);
    const dest = tokenAddress(solana, to, mint, programId);
    const info = await connection.getAccountInfo(dest);
    if (!info) {
      createdAccount = true;
      instructions.push(solana.createAssociatedTokenAccountInstruction(
        fromKey,
        dest,
        toKey,
        mintKey,
        program,
      ));
    }
    const data = new Uint8Array(10);
    data[0] = 12;
    let rest = amount;
    for (let i = 0; i < 8; i += 1) {
      data[1 + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    data[9] = Number(decimals) & 0xff;
    instructions.push(new solana.TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mintKey, isSigner: false, isWritable: false },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: fromKey, isSigner: true, isWritable: false },
      ],
      data,
    }));
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new solana.Transaction({
    feePayer: fromKey,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  tx.add(...instructions);
  return {
    bytes: rawTransaction(tx),
    createdAccount,
  };
}

function tokenAddress(solana, owner, mint, programId) {
  return solana.getAssociatedTokenAddressSync(
    new solana.PublicKey(mint),
    new solana.PublicKey(owner),
    false,
    new solana.PublicKey(programId || TOKEN_PROGRAM_ID),
  );
}
