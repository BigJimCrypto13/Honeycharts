import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { memoryStorage, readWelcomeDismissed, dismissWelcome, WELCOME_KEY } from "../js/store.js";
import { tokenTradePath, routeFromSearch } from "../js/paths.js";
import { lamportsFromSol, lamportsFromUsd, buildSwapForm } from "../js/swap.js";
import { safeImageUrl } from "../js/sanitize.js";
import {
  GRADUATED_LIQUIDITY,
  BOARD_WINDOWS,
  parseGeckoPools,
  parseJupiterTokens,
  withRank,
  mergeCoinRows,
  overlayDexPair,
  selectTable,
  topMovers,
  splitStep,
  buildTokenAbout,
  xSearchUrl,
  readMajors,
  SOL_MINT,
} from "../js/board.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const MEME = "8pjfN5Ayb4rucGpYE3tZWN6v3EysizjPx1v62zx1pump";

describe("home board lists", () => {
  it("reads a GeckoTerminal pool and skips the SOL side", () => {
    const rows = parseGeckoPools({
      data: [{
        attributes: {
          name: "KIM / SOL",
          base_token_price_usd: "0.2",
          market_cap_usd: null,
          fdv_usd: "1500",
          reserve_in_usd: "40000",
          pool_created_at: "2026-10-31T21:02:02Z",
          price_change_percentage: { m5: "1.5", h1: "4", h6: "-6", h24: "-12.5" },
          volume_usd: { h24: "9000" },
          transactions: { h24: { buys: 10, sells: 4, buyers: 7, sellers: 3 } },
        },
        relationships: {
          base_token: { data: { id: `solana_${MEME}` } },
          quote_token: { data: { id: `solana_${SOL_MINT}` } },
        },
      }, {
        attributes: { name: "SOL / USDC", base_token_price_usd: "100", reserve_in_usd: "9" },
        relationships: {
          base_token: { data: { id: `solana_${SOL_MINT}` } },
          quote_token: { data: { id: "solana_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } },
        },
      }],
      included: [{
        id: `solana_${MEME}`,
        attributes: { address: MEME, name: "Kim Coin", symbol: "KIM", image_url: "https://assets.geckoterminal.com/kim" },
      }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ca, MEME);
    assert.equal(rows[0].symbol, "KIM");
    assert.equal(rows[0].marketCap, 1500);
    assert.equal(rows[0].change.h24, -12.5);
    assert.equal(rows[0].txns.h24.buyers, 7);
    assert.equal(rows[0].txns.h24.buyVolume, null);
    assert.equal(parseGeckoPools(null).length, 0);
  });

  it("reads Jupiter holder counts and buy or sell volume", () => {
    const rows = parseJupiterTokens([{
      id: BONK,
      name: "Bonk",
      symbol: "Bonk",
      icon: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
      usdPrice: 0.00001,
      mcap: 1000,
      liquidity: 80000,
      holderCount: 42,
      firstPool: { createdAt: "2024-01-01T00:00:00Z" },
      stats24h: { priceChange: -1.5, buyVolume: 30, sellVolume: 10, numBuys: 3, numSells: 1 },
    }, { id: SOL_MINT, symbol: "SOL", holderCount: 999 }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].holders, 42);
    assert.equal(rows[0].txns.h24.buyVolume, 30);
    assert.equal(rows[0].txns.h24.buyers, null);
    assert.equal(rows[0].volume.h24, 40);
  });

  it("keeps the first trending rank and sorts each filter", () => {
    const gt = withRank(parseGeckoPools({
      data: [{
        attributes: { reserve_in_usd: "10", price_change_percentage: { h24: "5" } },
        relationships: { base_token: { data: { id: `solana_${MEME}` } } },
      }],
      included: [{ id: `solana_${MEME}`, attributes: { address: MEME, symbol: "KIM" } }],
    }), "trendingRank", 0);
    const jup = withRank([{
      ...parseJupiterTokens([{ id: BONK, symbol: "Bonk", holderCount: 9, liquidity: 10, stats24h: { priceChange: 1 } }])[0],
    }], "trendingRank", 1000);
    const traded = parseJupiterTokens([{ id: WIF, symbol: "WIF", holderCount: 50, liquidity: GRADUATED_LIQUIDITY, mcap: 10 }]);
    const rows = mergeCoinRows([gt, jup, traded]);
    const trending = selectTable(rows, { filter: "trending", windowId: "h24", sortKey: "default" });
    assert.deepEqual(trending.map((row) => row.symbol), ["KIM", "Bonk"]);
    const held = selectTable(rows, { filter: "held", sortKey: "default" });
    assert.deepEqual(held.map((row) => row.symbol), ["WIF", "Bonk"]);
    const graduated = selectTable(rows, { filter: "graduated", sortKey: "default" });
    assert.deepEqual(graduated.map((row) => row.ca), [WIF]);
    const hive = selectTable(rows, { filter: "hive", sortKey: "default", hiveOrder: [BONK] });
    assert.deepEqual(hive.map((row) => row.ca), [BONK]);
    const byChange = selectTable(rows, { filter: "trending", windowId: "h24", sortKey: "change", sortDir: "desc" });
    assert.equal(byChange[0].symbol, "KIM");
    const movers = topMovers(rows, "h24", 2);
    assert.equal(movers[0].change.h24, 5);
    assert.equal(BOARD_WINDOWS.map((item) => item.label).join(","), "5m,1h,6h,24h");
    assert.match(BOARD_WINDOWS[2].title, /do not publish a 4 hour/);
  });

  it("lets DexScreener figures replace a discovery row without erasing buyers", () => {
    const row = parseJupiterTokens([{ id: BONK, symbol: "Bonk", stats24h: { buyVolume: 2, sellVolume: 2 } }])[0];
    row.txns.h24.buyers = 8;
    const next = overlayDexPair(row, {
      priceUsd: "1.25",
      marketCap: 90,
      liquidity: { usd: 70 },
      priceChange: { h24: 3 },
      volume: { h24: 15 },
      txns: { h24: { buys: 4, sells: 1 } },
      baseToken: { name: "Bonk", symbol: "BONK" },
      info: { imageUrl: "https://cdn.dexscreener.com/cms/images/abc.png" },
    });
    assert.equal(next.priceUsd, 1.25);
    assert.equal(next.symbol, "BONK");
    assert.equal(next.txns.h24.buys, 4);
    assert.equal(next.txns.h24.buyers, 8);
    assert.equal(next.txns.h24.buyVolume, 2);
    const majors = readMajors(new Map([
      [SOL_MINT, { pair: { priceUsd: "150", priceChange: { h24: 1 } } }],
    ]));
    assert.equal(majors.sol.price, 150);
    assert.equal(majors.btc, null);
  });
});

describe("token about card", () => {
  it("uses real buy and sell volume and does not invent unique wallets", () => {
    const about = buildTokenAbout({
      geckoInfo: { data: { attributes: {
        description: "A dog coin.",
        websites: ["https://www.bonkcoin.com"],
        twitter_handle: "bonk_inu",
        telegram_handle: "bonkcoin",
      } } },
      geckoPool: { attributes: { transactions: { h24: { buyers: 11, sellers: 9, buys: 20, sells: 10 } } } },
      jupiterToken: { id: BONK, stats24h: { buyVolume: 70, sellVolume: 30, numBuys: 5, numSells: 4, priceChange: -2 } },
      pair: { priceChange: { h24: 6 }, txns: { h24: { buys: 8, sells: 2 } }, volume: { h24: 100 } },
    });
    assert.equal(about.description, "A dog coin.");
    assert.equal(about.windows.h24.change, 6);
    assert.equal(about.windows.h24.buys, 8);
    assert.equal(about.windows.h24.buyVolume, 70);
    assert.equal(about.windows.h24.buyers, 11);
    assert.equal(about.windows.h1.buyers, null);
    assert.equal(about.windows.h1.buyVolume, null);
    assert.equal(about.links[0].label, "Website");
    assert.equal(about.links.some((link) => link.href === "https://x.com/bonk_inu"), true);
    assert.equal(splitStep(70, 30), 70);
    assert.equal(splitStep(null, 1), null);
    assert.equal(xSearchUrl("Bonk", BONK), "https://x.com/search?q=%24Bonk&src=typed_query&f=live");
    const empty = buildTokenAbout({});
    assert.equal(empty.windows.h24.buyers, null);
    assert.equal(empty.windows.h24.buyVolume, null);
  });
});

describe("quick buy and welcome", () => {
  it("opens a token with a preset and remembers a dismissed intro", () => {
    assert.equal(tokenTradePath("/Honeycharts/", BONK, 0.1), `/Honeycharts/?ca=${BONK}&buy=0.1`);
    assert.equal(tokenTradePath("/", BONK, 2), `/?ca=${BONK}`);
    assert.equal(routeFromSearch(`?ca=${BONK}&buy=0.1`).name, "token");
    assert.equal(routeFromSearch(`?t=${BONK}&buy=0.5`).ca, BONK);
    assert.equal(lamportsFromUsd(10, 100), "100000000");
    assert.equal(lamportsFromUsd(7, 100), null);
    assert.equal(lamportsFromSol("0.1"), "100000000");
    assert.equal(lamportsFromSol("101"), null);
    assert.equal(buildSwapForm(BONK, { lamports: "250000000" }).initialAmount, "250000000");
    assert.equal(buildSwapForm(BONK, { side: "sell", lamports: "250000000" }).initialAmount, undefined);
    const storage = memoryStorage();
    assert.equal(readWelcomeDismissed(storage), false);
    assert.equal(dismissWelcome(storage), true);
    assert.equal(storage.getItem(WELCOME_KEY), "1");
    assert.equal(readWelcomeDismissed(storage), true);
    assert.match(safeImageUrl("https://assets.geckoterminal.com/kim"), /geckoterminal/);
    assert.equal(safeImageUrl("https://evil.test/logo.png"), null);
  });

  it("keeps the intro copy and the coming-soon card in the home view", () => {
    const home = readFileSync(new URL("../js/home-view.js", import.meta.url), "utf8");
    const render = readFileSync(new URL("../js/render.js", import.meta.url), "utf8");
    assert.match(home, /Honey Charts\. Where the buzz starts\. Join the hive\./);
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.match(html, /<title>Honey Charts \| Where the buzz starts<\/title>/);
    assert.match(html, /name="description" content="Honey Charts\. Where the buzz starts\. Join the hive\."/);
    assert.match(html, /property="og:description" content="Honey Charts\. Where the buzz starts\. Join the hive\."/);
    assert.match(home, /Search or pick a trending coin/);
    assert.match(home, /Check its Honey Score and rug flags/);
    assert.match(home, /Connect your own wallet and trade \(we never see your keys\)/);
    assert.match(home, /Add coins to your Hive/);
    assert.match(home, /Leaderboard & callouts coming soon/);
    assert.match(home, /Top movers/);
    assert.match(home, /Not a live trade tape/);
    assert.match(home, /Paid promotions/);
    assert.match(render, /About /);
    assert.match(render, /Buy \$\{symbol\} in Jupiter/);
    assert.match(render, /"data-region": "pills"/);
    assert.match(render, /trend-rail/);
  });
});
