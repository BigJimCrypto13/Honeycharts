import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateLaunch } from "../js/launch-form.js";
import {
  clusterUrl,
  confirmSignature,
  forgetMint,
  loadSolana,
  prepareLaunch,
} from "../js/launch-tx.js";

describe("devnet token launch", () => {
  it("creates an SPL mint, metadata, and revoked authorities", async (t) => {
    const solana = await loadSolana();
    const endpoint = process.env.SOLANA_RPC || clusterUrl("devnet");
    const connection = new solana.Connection(endpoint, "confirmed");
    const payer = solana.Keypair.generate();
    let mint = null;
    try {
      const airdrop = await requestAirdrop(connection, payer.publicKey);
      assert.equal(airdrop, true);
      const form = validateLaunch({
        name: "Honey Dev",
        symbol: "HDEV",
        decimals: "6",
        supply: "1000",
        imageUrl: "",
        description: "Devnet harness token",
        website: "",
        twitter: "",
        telegram: "",
        metadataUri: "https://example.com/honeycharts-devnet-metadata.json",
      });
      assert.equal(form.ok, true);
      const prepared = await prepareLaunch({
        connection,
        payer: payer.publicKey.toBase58(),
        form: form.value,
        revokeMint: true,
        revokeFreeze: true,
        fee: null,
      });
      mint = prepared.mint;
      prepared.transaction.partialSign(payer);
      const signature = await connection.sendRawTransaction(prepared.transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await confirmSignature(connection, signature, prepared.lastValidBlockHeight);
      const mintAccount = await connection.getParsedAccountInfo(prepared.mint.publicKey, "confirmed");
      const info = mintAccount.value && mintAccount.value.data && mintAccount.value.data.parsed && mintAccount.value.data.parsed.info;
      assert.ok(info, "mint account missing");
      assert.equal(info.decimals, 6);
      assert.equal(info.mintAuthority, null);
      assert.equal(info.freezeAuthority, null);
      assert.equal(info.supply, "1000000000");
      const metadataProgram = new solana.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
      const [metadata] = solana.PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode("metadata"),
          metadataProgram.toBytes(),
          prepared.mint.publicKey.toBytes(),
        ],
        metadataProgram,
      );
      const metadataAccount = await connection.getAccountInfo(metadata, "confirmed");
      assert.ok(metadataAccount, "metadata account missing");
      assert.equal(metadataAccount.owner.toBase58(), metadataProgram.toBase58());
    } catch (error) {
      const message = String((error && error.message) || error);
      if (!process.env.SOLANA_RPC && /410|faucet is closed/i.test(message)) {
        t.skip("Public devnet faucet is closed. Set SOLANA_RPC to a validator that can fund the test wallet.");
        return;
      }
      throw error;
    } finally {
      forgetMint(mint);
      if (payer) payer.secretKey.fill(0);
    }
  });
});

async function requestAirdrop(connection, publicKey) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(publicKey, 1500000000);
      const latest = await connection.getLatestBlockhash("confirmed");
      await confirmSignature(connection, signature, latest.lastValidBlockHeight);
      return true;
    } catch (error) {
      lastError = error;
      const message = String((error && error.message) || error);
      if (/410|faucet is closed/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}
