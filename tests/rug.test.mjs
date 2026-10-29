import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHoneyScore } from "../js/score.js";
import { memoryStorage } from "../js/store.js";
import { createCreatorCache } from "../js/creator-scan.js";
import {
  classifyLaunch,
  creatorScoreFlags,
  firstSigner,
  historyHeadline,
  mintsInitializedBy,
  readRugcheckCreator,
  serialRuggerPenalty,
  snapshotFromPair,
  summarizeLaunches,
  unknownLine,
} from "../js/creator.js";

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WALLET = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const OTHER = "7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6";
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function snap(extra = {}) {
  return {
    hasPair: true,
    priceUsd: 1,
    priceChange: { h24: -5 },
    marketCap: 1000,
    liquidityUsd: 20000,
    volume: { h24: 100 },
    txns: { h24: 4 },
    pairCreatedAt: NOW - 10 * DAY,
    rugged: null,
    ...extra,
  };
}

function judged(extra, now = NOW) {
  return classifyLaunch(snap(extra), now);
}

describe("launch loss heuristic", () => {
  it("counts a drop of more than 90% and ignores a drop of exactly 90%", () => {
    const dumped = judged({ priceUsd: 0.4, priceChange: { h24: -95.2 }, liquidityUsd: 8000 });
    assert.equal(dumped.outcome, "loss");
    assert.equal(dumped.reasons[0].code, "drawdown");
    assert.match(dumped.reasons[0].text, /95\.2%/);
    assert.match(dumped.reasons[0].text, /24-hour/);

    const exact = judged({ priceChange: { h24: -90 }, liquidityUsd: 8000, priceUsd: 1 });
    assert.equal(exact.outcome, "alive");

    const justOver = judged({ priceChange: { h24: -90.2 }, liquidityUsd: 8000 });
    assert.equal(justOver.outcome, "loss");
  });

  it("counts the change window when the current price is missing", () => {
    const fromChange = classifyLaunch({
      hasPair: true,
      priceUsd: null,
      priceChange: { h6: -96 },
      marketCap: null,
      liquidityUsd: null,
      volume: {},
      txns: {},
      pairCreatedAt: null,
      rugged: null,
    }, NOW);
    assert.equal(fromChange.outcome, "loss");
    assert.match(fromChange.reasons[0].text, /6-hour/);
  });

  it("uses market cap only when price is missing and the change is not itself past 90%", () => {
    const capped = classifyLaunch({
      hasPair: true,
      priceUsd: null,
      priceChange: { h24: -40 },
      marketCap: 500,
      liquidityUsd: 20000,
      volume: { h24: 10 },
      txns: { h24: 2 },
      pairCreatedAt: NOW - 10 * DAY,
      rugged: null,
    }, NOW);
    assert.equal(capped.outcome, "alive");
    assert.equal(capped.reasons.some((reason) => reason.code === "drawdown"), false);
  });

  it("does not treat missing prices, volume, or liquidity as zero", () => {
    const parsed = snapshotFromPair({
      priceUsd: "1",
      liquidity: {},
      volume: {},
      txns: {},
      pairCreatedAt: NOW - 10 * DAY,
    });
    assert.equal(parsed.volume.h24, null);
    assert.equal(parsed.liquidityUsd, null);
    assert.equal(parsed.priceChange.h24, null);
    const missing = classifyLaunch(parsed, NOW);
    assert.equal(missing.outcome, "unknown");
    assert.equal(missing.reasons[0].text, "not enough data");

    const dustWithoutTrades = judged({
      priceUsd: null,
      priceChange: {},
      marketCap: null,
      liquidityUsd: 0,
      volume: {},
      txns: {},
    });
    assert.equal(dustWithoutTrades.outcome, "unknown");
  });

  it("counts liquidity removed only after reported trades", () => {
    const removed = judged({ priceChange: { h24: -10 }, liquidityUsd: 40, volume: { h24: 250 }, txns: { h24: 3 } });
    assert.equal(removed.outcome, "loss");
    assert.ok(removed.reasons.some((reason) => reason.code === "liquidity"));

    const quietDust = judged({
      priceUsd: null,
      priceChange: {},
      liquidityUsd: 0,
      volume: { h24: 0 },
      txns: { h24: 0 },
      pairCreatedAt: NOW - 60 * 60 * 1000,
    });
    assert.equal(quietDust.outcome, "unknown");
  });

  it("counts an old pair with zero reported trading as no trading, and leaves a young pair unknown", () => {
    const dead = judged({
      priceUsd: 0,
      priceChange: { h24: 0 },
      liquidityUsd: 0,
      volume: { h24: 0 },
      txns: { h24: 0 },
      pairCreatedAt: NOW - 3 * DAY,
    });
    assert.equal(dead.outcome, "loss");
    assert.ok(dead.reasons.some((reason) => reason.code === "no-trading"));

    const young = judged({
      priceUsd: 0,
      priceChange: { h24: 0 },
      liquidityUsd: 0,
      volume: { h24: 0 },
      txns: { h24: 0 },
      pairCreatedAt: NOW - 60 * 60 * 1000,
    });
    assert.equal(young.outcome, "unknown");
  });

  it("counts a loaded RugCheck rugged flag without inventing one", () => {
    const rugged = classifyLaunch({ hasPair: false, rugged: true }, NOW);
    assert.equal(rugged.outcome, "loss");
    assert.equal(rugged.reasons[0].code, "rugged");
    const clean = classifyLaunch({ hasPair: false, rugged: false }, NOW);
    assert.equal(clean.outcome, "unknown");
  });

  it("keeps a liquid pair with a modest change alive", () => {
    assert.equal(judged({ priceChange: { h24: 12 }, liquidityUsd: null, priceUsd: 0.2 }).outcome, "alive");
    assert.equal(judged({ liquidityUsd: 25000, priceChange: {} }).outcome, "alive");
  });
});

describe("serial rugger summary", () => {
  it("says 4 of 5 when four classified coins are down more than 90%", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => judged({ priceChange: { h24: -97 } })),
      judged({ priceChange: { h24: -4 } }),
    ];
    const summary = summarizeLaunches(rows);
    assert.equal(summary.losses, 4);
    assert.equal(summary.alive, 1);
    assert.equal(summary.known, 5);
    assert.equal(summary.serial, true);
    assert.equal(summary.headline, "4 of 5 coins from this wallet lost over 90%");
    assert.equal(historyHeadline(summary), summary.headline);
    assert.equal(serialRuggerPenalty(summary), 28);
  });

  it("does not call one loss, or an all-unknown wallet, a serial rugger", () => {
    const once = summarizeLaunches([
      judged({ priceChange: { h24: -99 } }),
      judged({ priceChange: { h24: 3 } }),
    ]);
    assert.equal(once.serial, false);
    assert.equal(once.penalty, 0);
    assert.equal(once.headline, "1 of 2 coins from this wallet lost over 90%");

    const unknown = summarizeLaunches([
      { outcome: "unknown", reasons: [{ code: "unknown", text: "not enough data" }] },
      { outcome: "unknown", reasons: [{ code: "unknown", text: "not enough data" }] },
    ]);
    assert.equal(unknown.serial, false);
    assert.equal(unknown.headline, "not enough data");
    assert.equal(unknown.penalty, 0);
    assert.equal(unknownLine(unknown), "");
  });

  it("uses died-or-lost wording when a loss is not a 90% price drop", () => {
    const summary = summarizeLaunches([
      judged({ priceChange: { h24: -10 }, liquidityUsd: 20, volume: { h24: 80 } }),
      judged({ priceChange: { h24: -8 }, liquidityUsd: 15, volume: { h24: 40 } }),
    ]);
    assert.equal(summary.serial, true);
    assert.equal(summary.headline, "2 of 2 coins from this wallet died or lost over 90%");
  });

  it("keeps unclassified coins out of the ratio", () => {
    const summary = summarizeLaunches([
      judged({ priceChange: { h24: -96 } }),
      judged({ priceChange: { h24: -97 } }),
      { outcome: "unknown", reasons: [{ code: "unknown", text: "not enough data" }] },
    ]);
    assert.equal(summary.headline, "2 of 2 coins from this wallet lost over 90%");
    assert.equal(summary.unknownLine, "1 more: not enough data");
    assert.equal(summary.serial, true);
  });

  it("lowers the Honey Score for repeat losses and leaves missing history unchanged", () => {
    const pair = {
      liquidity: { usd: 300000 },
      pairCreatedAt: Date.now() - 400 * 24 * 60 * 60 * 1000,
      priceUsd: "1",
      volume: { h24: 1000 },
    };
    const report = {
      mintAuthority: null,
      freezeAuthority: null,
      token: { mintAuthority: null, freezeAuthority: null },
      markets: [],
      topHolders: [],
      risks: [],
      rugged: false,
    };
    const base = buildHoneyScore(pair, report, {});
    const same = buildHoneyScore(pair, report, { creator: null });
    assert.equal(same.score, base.score);

    const summary = summarizeLaunches([
      ...Array.from({ length: 4 }, () => judged({ priceChange: { h24: -97 } })),
      judged({ priceChange: { h24: -4 } }),
    ]);
    const penalized = buildHoneyScore(pair, report, { creator: summary });
    assert.equal(base.score - penalized.score, summary.penalty);
    const flag = penalized.flags.find((item) => item.title === "Serial Rugger");
    assert.ok(flag);
    assert.equal(flag.points, -summary.penalty);
    assert.match(flag.detail, /4 of 5 coins from this wallet lost over 90%/);

    const incomplete = buildHoneyScore(pair, null, { reportError: "network", creator: summary });
    assert.equal(incomplete.score, 55 - summary.penalty);
    assert.ok(incomplete.score < 55);

    const thin = summarizeLaunches([{ outcome: "unknown", reasons: [] }]);
    const untouched = buildHoneyScore(pair, report, { creator: thin });
    assert.equal(untouched.score, base.score);
    assert.equal(creatorScoreFlags(thin).flags[0].title, "Creator history: not enough data");
  });
});

describe("creator transaction parsing", () => {
  it("reads RugCheck's creator when it is a wallet address", () => {
    assert.equal(readRugcheckCreator({ creator: WALLET }), WALLET);
    assert.equal(readRugcheckCreator({ creator: { address: `  ${WALLET}  ` } }), WALLET);
    assert.equal(readRugcheckCreator({ creator: "" }), null);
    assert.equal(readRugcheckCreator({ creator: "not-a-wallet" }), null);
    assert.equal(readRugcheckCreator(null), null);
  });

  it("lists a mint only when this wallet is the first signer on the initialize", () => {
    const tx = {
      transaction: {
        message: {
          accountKeys: [
            { pubkey: WALLET, signer: true },
            { pubkey: MINT, signer: true },
            { pubkey: OTHER, signer: false },
          ],
          instructions: [],
        },
      },
      meta: {
        innerInstructions: [{
          instructions: [{
            parsed: { type: "initializeMint2", info: { mint: MINT, decimals: 6 } },
          }],
        }],
      },
    };
    assert.equal(firstSigner(tx), WALLET);
    assert.deepEqual(mintsInitializedBy(tx, WALLET), [MINT]);
    assert.deepEqual(mintsInitializedBy(tx, OTHER), []);
    assert.deepEqual(mintsInitializedBy({
      transaction: { message: { accountKeys: [OTHER, WALLET], instructions: [] } },
      meta: { innerInstructions: [] },
    }, WALLET), []);
  });
});

describe("creator cache", () => {
  it("stores a scan and drops a corrupt cache", () => {
    const storage = memoryStorage();
    const cache = createCreatorCache(storage);
    const now = Date.now();
    cache.save(WALLET, {
      at: now,
      truncated: false,
      rateLimited: false,
      checked: 12,
      mentioned: 12,
      mints: [MINT, "nope", MINT],
    }, [{
      mint: MINT,
      at: now,
      outcome: "loss",
      reasons: [{ code: "drawdown", text: "Price is down 95.0% from the start of the 24-hour window DexScreener reported." }],
      symbol: "PUMP",
      name: "Pump",
      priceUsd: 0.1,
      liquidityUsd: null,
      marketCap: 10,
    }]);
    const saved = cache.getScan(WALLET, now);
    assert.deepEqual(saved.mints, [MINT]);
    assert.equal(cache.getRow(WALLET, MINT, now).outcome, "loss");
    storage.setItem("honeycharts.creator.v1", "{");
    const fresh = createCreatorCache(storage);
    assert.equal(fresh.getScan(WALLET, now), null);
    assert.equal(fresh.peek(WALLET), null);
  });
});
