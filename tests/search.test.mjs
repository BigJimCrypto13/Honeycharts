import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_NAME_QUERY,
  SEARCH_RESULT_LIMIT,
  buildSearchResults,
  dexSearchUrl,
  jupiterSearchUrl,
  markerLabel,
  normalizeSearchQuery,
} from "../js/search.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const COPY = "7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6";

function pair(ca, extra = {}) {
  return {
    chainId: "solana",
    baseToken: { address: ca, name: extra.name || "Bonk", symbol: extra.symbol || "BONK" },
    priceUsd: Object.prototype.hasOwnProperty.call(extra, "priceUsd") ? extra.priceUsd : "0.01",
    liquidity: extra.liquidity === undefined ? { usd: 1000 } : extra.liquidity,
    volume: extra.volume === undefined ? { h24: 100 } : extra.volume,
    marketCap: extra.marketCap === undefined ? 5000 : extra.marketCap,
    info: extra.info,
    ...extra.rest,
  };
}

describe("name search query", () => {
  it("strips a leading dollar sign and control characters", () => {
    assert.equal(normalizeSearchQuery("  $WIF "), "WIF");
    assert.equal(normalizeSearchQuery("$$bonk"), "bonk");
    assert.equal(normalizeSearchQuery("pe\u0000pe"), "pe pe");
    assert.equal(normalizeSearchQuery("a"), "a");
    assert.equal(MIN_NAME_QUERY, 2);
    assert.equal(normalizeSearchQuery("x".repeat(40)).length, 32);
  });
});

describe("search ranking", () => {
  it("keeps Solana pairs, dedupes by mint, and ranks liquidity times volume", () => {
    const results = buildSearchResults({
      pairs: [
        pair(COPY, { name: "Bonk", symbol: "BONK", liquidity: { usd: 50 }, volume: { h24: 9_000_000 }, marketCap: 80 }),
        { chainId: "ethereum", baseToken: { address: BONK, name: "Bonk", symbol: "BONK" }, liquidity: { usd: 9e9 }, volume: { h24: 9e9 } },
        pair(BONK, { liquidity: { usd: 1000 }, volume: { h24: 10 }, priceUsd: "0.001" }),
        pair(BONK, {
          liquidity: { usd: 2_000_000 },
          volume: { h24: 80_000 },
          priceUsd: "0.02",
          info: { imageUrl: "https://cdn.dexscreener.com/cms/images/real.png" },
        }),
        pair(WIF, { name: "<script>", symbol: "WIF", liquidity: { usd: 2_000_000 }, volume: { h24: 10 }, marketCap: 90 }),
        pair("not-an-address", { liquidity: { usd: 9e9 } }),
        pair(WIF, { name: "dogwifhat", symbol: "WIF", liquidity: null, volume: null, marketCap: null, priceUsd: null }),
      ],
    }, []);
    assert.deepEqual(results.map((row) => row.ca), [BONK, COPY, WIF]);
    assert.equal(results[0].priceUsd, 0.02);
    assert.equal(results[0].liquidityUsd, 2_000_000);
    assert.equal(results[0].volumeH24, 80_000);
    assert.equal(results[0].image, "https://cdn.dexscreener.com/cms/images/real.png");
    assert.equal(results[1].liquidityUsd, 50);
    assert.equal(results[1].volumeH24, 9_000_000);
    assert.equal(results[2].liquidityUsd, 2_000_000);
    assert.equal(results[2].volumeH24, 10);
    assert.equal(results[0].verified, false);
    assert.equal(results[2].name, "<script>");
  });

  it("sinks a high-liquidity pool that has almost no trading", () => {
    const results = buildSearchResults({
      pairs: [
        pair(COPY, { name: "Bonk", symbol: "Bonk", liquidity: { usd: 1_700_000 }, volume: { h24: 51 }, marketCap: 3_000_000 }),
        pair(BONK, { name: "Bonk", symbol: "Bonk", liquidity: { usd: 300_000 }, volume: { h24: 400_000 }, marketCap: 270_000_000 }),
      ],
    }, []);
    assert.equal(results[0].ca, BONK);
    assert.equal(results[1].ca, COPY);
  });

  it("does not treat a missing liquidity figure as zero in the row", () => {
    const results = buildSearchResults({
      pairs: [pair(BONK, { liquidity: {}, volume: {}, marketCap: null, priceUsd: null })],
    }, []);
    assert.equal(results[0].liquidityUsd, null);
    assert.equal(results[0].volumeH24, null);
    assert.equal(results[0].marketCap, null);
    assert.equal(results[0].priceUsd, null);
  });

  it("marks Jupiter verified and strict mints, and falls back when DexScreener is empty", () => {
    const marked = buildSearchResults({
      pairs: [pair(BONK, { liquidity: { usd: 10 } })],
    }, [
      { id: BONK, name: "Bonk", symbol: "BONK", isVerified: true, tags: ["verified", "strict", "meme"], icon: "https://evil.test/logo.png" },
      { id: "short", name: "Nope", symbol: "NO", isVerified: true, tags: ["strict"] },
    ]);
    assert.equal(marked.length, 1);
    assert.equal(marked[0].source, "dex");
    assert.equal(marked[0].strict, true);
    assert.equal(marked[0].verified, true);
    assert.equal(markerLabel(marked[0]), "Strict list");
    assert.equal(marked[0].image, null);

    const verifiedOnly = buildSearchResults({
      pairs: [pair(WIF, { name: "dogwifhat", symbol: "WIF", liquidity: { usd: 5 } })],
    }, [{ id: WIF, name: "dogwifhat", symbol: "WIF", isVerified: true, tags: ["verified"] }]);
    assert.equal(markerLabel(verifiedOnly[0]), "Verified");

    const fallback = buildSearchResults({ pairs: [] }, [
      { id: COPY, name: "Copy", symbol: "COPY", isVerified: false, tags: ["meme"], usdPrice: 0.2, mcap: 100, liquidity: 5, stats24h: { buyVolume: 3, sellVolume: 4 } },
      { id: BONK, name: "Bonk", symbol: "BONK", isVerified: false, tags: ["strict"], usdPrice: 1, mcap: 50, liquidity: 20, stats24h: { buyVolume: 40, sellVolume: 10 }, icon: "https://cdn.dexscreener.com/cms/images/ok.png" },
    ]);
    assert.equal(fallback.length, 2);
    assert.equal(fallback[0].ca, BONK);
    assert.equal(fallback[0].source, "jupiter");
    assert.equal(fallback[0].strict, true);
    assert.equal(fallback[0].image, "https://cdn.dexscreener.com/cms/images/ok.png");
    assert.equal(fallback[1].volumeH24, 7);
    assert.equal(markerLabel(fallback[1]), "");
    assert.ok(fallback.length <= SEARCH_RESULT_LIMIT);
  });

  it("builds the public search URLs without dropping the query", () => {
    assert.equal(dexSearchUrl("bonk"), "https://api.dexscreener.com/latest/dex/search?q=bonk");
    assert.equal(jupiterSearchUrl("WIF"), "https://api.jup.ag/tokens/v2/search?query=WIF");
    assert.match(dexSearchUrl("dog wif"), /dog%20wif$/);
  });
});
