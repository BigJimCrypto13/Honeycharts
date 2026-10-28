import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair } from "../vendor/solana-bundle.js";
import { launchFeeConfig } from "../js/config.js";
import { addLaunchFee, forgetMint, loadSolana, prepareLaunch, solToLamports } from "../js/launch-tx.js";

const form = {
  name: "Honey Test",
  symbol: "HTEST",
  description: "Structure test only. This transaction is not sent.",
  website: "",
  twitter: "",
  telegram: "",
  initialBuySol: 0,
};

describe("pump launch transaction", () => {
  it("adds the disclosed launch fee to the unsigned create transaction and does not send it", async () => {
    const solana = await loadSolana();
    const payer = Keypair.generate().publicKey.toBase58();
    const connection = new solana.Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const prepared = await prepareLaunch({
      connection,
      payer,
      form,
      metadataUri: "https://example.com/honeycharts-metadata.json",
    });
    try {
      const fee = launchFeeConfig();
      const lookups = [];
      for (const lookup of prepared.transaction.message.addressTableLookups) {
        const found = await connection.getAddressLookupTable(lookup.accountKey);
        assert.ok(found.value);
        lookups.push(found.value);
      }
      const message = solana.TransactionMessage.decompile(prepared.transaction.message, {
        addressLookupTableAccounts: lookups,
      });
      const transfer = message.instructions.find((ix) => {
        if (!ix.programId.equals(solana.SystemProgram.programId) || ix.data[0] !== 2) return false;
        return ix.keys.some((key) => key.pubkey.toBase58() === fee.wallet);
      });
      assert.ok(transfer, "launch fee transfer missing");
      const lamports = new DataView(transfer.data.buffer, transfer.data.byteOffset, transfer.data.byteLength).getBigUint64(4, true);
      assert.equal(lamports, solToLamports(fee.sol));
      const simulation = await connection.simulateTransaction(prepared.transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      assert.ok(simulation.value);
      assert.equal(typeof addLaunchFee, "function");
    } finally {
      forgetMint(prepared.mint);
    }
  });
});
