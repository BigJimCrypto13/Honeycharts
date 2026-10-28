import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCoin,
  creatorFromReport,
  mintFromCreateTransaction,
  summarizeHistory,
  MIN_PAIR_AGE_MS,
  PUMP_PROGRAM,
} from "../js/creator-check.js";
import { readCreatorCache, writeCreatorCache } from "../js/creator-cache.js";

const WALLET = "9WfYYnaUTR2gjXFmjMa58fpBMfJCA1oDz2fGakcguRfj";
const MINT = "4LLwtXzS5kmbbAB3Lxic1KcMLs44gagFKexmjbQcpump";

describe("creator history heuristic", () => {
  it("counts a 90 percent drop and an old thin market, and ignores a brand-new thin market", () => {
    const drop = classifyCoin({ change24: -95, liquidityUsd: 20000, pairAgeMs: MIN_PAIR_AGE_MS });
    assert.equal(drop.loss, true);
    assert.ok(drop.reasons.some((reason) => reason.includes("90%")));

    const fresh = classifyCoin({ liquidityUsd: 10, pairAgeMs: 60 * 1000 });
    assert.equal(fresh.enough, true);
    assert.equal(fresh.loss, false);

    const pulled = classifyCoin({ liquidityUsd: 100, pairAgeMs: MIN_PAIR_AGE_MS + 1 });
    assert.equal(pulled.loss, true);
    assert.equal(classifyCoin({ rugged: true }).loss, true);
    assert.equal(classifyCoin({}).enough, false);
  });

  it("does not call a pattern serial until two coins with data have losses", () => {
    const one = summarizeHistory([
      { mint: MINT, enough: true, loss: true, reasons: ["Price fell more than 90% in 24 hours"] },
    ]);
    assert.equal(one.serial, false);
    assert.equal(one.status, "insufficient");
    assert.match(one.headline, /1 of 1/);
    assert.match(one.headline, /Not enough data/);

    const none = summarizeHistory([{ mint: MINT, enough: false, loss: false, reasons: [] }]);
    assert.equal(none.serial, false);
    assert.match(none.headline, /Not enough data/);

    const two = summarizeHistory([
      { mint: MINT, enough: true, loss: true, reasons: ["Price fell more than 90% in 24 hours"] },
      { mint: WALLET, enough: true, loss: true, reasons: ["RugCheck marked this coin rugged"] },
      { mint: "So11111111111111111111111111111111111111112", enough: true, loss: false, reasons: [] },
    ]);
    assert.equal(two.serial, true);
    assert.equal(two.losses, 2);
    assert.equal(two.checked, 3);
    assert.match(two.headline, /2 of 3 coins from this wallet lost more than 90%/);
  });

  it("reads a RugCheck creator and a Pump create transaction", () => {
    assert.deepEqual(creatorFromReport({ creator: WALLET }, MINT), { wallet: WALLET, source: "rugcheck" });
    assert.equal(creatorFromReport({ creator: MINT }, MINT), null);
    const tx = {
      transaction: {
        message: {
          accountKeys: [
            { pubkey: WALLET, signer: true },
            { pubkey: MINT, signer: true },
            { pubkey: PUMP_PROGRAM, signer: false },
          ],
        },
      },
      meta: { logMessages: ["Program log: Instruction: CreateV2"] },
    };
    assert.equal(mintFromCreateTransaction(tx, WALLET), MINT);
    const trade = {
      transaction: tx.transaction,
      meta: { logMessages: ["Program log: Instruction: Buy"] },
    };
    assert.equal(mintFromCreateTransaction(trade, WALLET), null);
  });

  it("caches a wallet summary and ignores a broken store", () => {
    const storage = memoryStorage();
    writeCreatorCache(storage, WALLET, { headline: "0 of 2 coins from this wallet lost more than 90%." }, 1000);
    assert.equal(readCreatorCache(storage, WALLET, 1000 + 1000).headline.includes("0 of 2"), true);
    assert.equal(readCreatorCache(storage, WALLET, 1000 + 31 * 60 * 1000), null);
    assert.equal(readCreatorCache({ getItem() { throw new Error("nope"); } }, WALLET, 1000), null);
  });
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
  };
}
