import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { routeFromSearch } from "../js/paths.js";
import { tradeWindows, readHolderList, holderBarStep } from "../js/activity.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

describe("mint query alias", () => {
  it("opens ?t= the same way as ?ca=", () => {
    assert.deepEqual(routeFromSearch(`?ca=${BONK}`), { name: "token", ca: BONK });
    assert.deepEqual(routeFromSearch(`?t=${BONK}`), { name: "token", ca: BONK });
    assert.deepEqual(routeFromSearch(`t=${BONK}`), { name: "token", ca: BONK });
    assert.deepEqual(routeFromSearch(`?ca=${BONK}&t=${WIF}`), { name: "token", ca: BONK });
    assert.equal(routeFromSearch("?t=not-a-mint").name, "home");
    assert.match(routeFromSearch("?t=not-a-mint").error, /contract address/);
    assert.equal(routeFromSearch("?view=hive").name, "hive");
    assert.deepEqual(routeFromSearch(`?wallet=${BONK}`), { name: "wallet", wallet: BONK });
    assert.equal(routeFromSearch("").name, "home");
  });
});

describe("token activity", () => {
  it("reads pair trade windows without inventing fills", () => {
    const rows = tradeWindows({
      txns: { m5: { buys: 2, sells: 1 }, h1: { buys: 10, sells: 4 }, h24: { buys: "9", sells: -1 } },
      volume: { m5: 25, h1: 100, h6: null, h24: 5000 },
    });
    assert.deepEqual(rows.map((row) => row.label), ["5m", "1h", "6h", "24h"]);
    assert.equal(rows[0].buys, 2);
    assert.equal(rows[0].sells, 1);
    assert.equal(rows[0].volume, 25);
    assert.equal(rows[2].buys, null);
    assert.equal(rows[2].volume, null);
    assert.equal(rows[3].buys, 9);
    assert.equal(rows[3].sells, null);
    assert.deepEqual(tradeWindows(null).map((row) => row.buys), [null, null, null, null]);
  });

  it("keeps only readable RugCheck holders", () => {
    const parsed = readHolderList({
      totalHolders: 4046.4,
      topHolders: [
        { owner: BONK, address: WIF, pct: 2.85, uiAmount: 28500000, insider: true },
        { address: "not-an-address", pct: 1.2, uiAmount: -4 },
        { owner: BONK, pct: 140 },
        { pct: 3 },
      ],
    });
    assert.equal(parsed.total, 4046);
    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.rows[0].owner, BONK);
    assert.equal(parsed.rows[0].insider, true);
    assert.equal(parsed.rows[0].uiAmount, 28500000);
    assert.equal(parsed.rows[1].address, "");
    assert.equal(parsed.rows[1].uiAmount, null);
    assert.equal(parsed.rows[2].pct, 3);
    assert.deepEqual(readHolderList(null), { total: null, rows: [] });
    assert.equal(holderBarStep(2.85), 5);
    assert.equal(holderBarStep(100), 100);
    assert.equal(holderBarStep(-4), 0);
  });
});

describe("token page layout source", () => {
  it("uses a full-width chart column with the trade box on the right", () => {
    const css = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");
    const render = readFileSync(new URL("../js/render.js", import.meta.url), "utf8");
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*380px/);
    assert.match(css, /\.trade-dock/);
    assert.match(css, /isolation:\s*isolate/);
    assert.doesNotMatch(css, /1120px/);
    assert.match(render, /token-main/);
    assert.match(render, /token-rail/);
    assert.match(render, /id: "swap-mount"/);
    assert.match(render, /Trades/);
    assert.match(render, /Holders/);
  });
});
