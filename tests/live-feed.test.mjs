import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { memoryStorage } from "../js/store.js";
import { clipText, safeImageUrl, safeTokenImageUrl } from "../js/sanitize.js";
import {
  LAUNCH_CAP,
  bondingProgress,
  capLaunches,
  decorateLaunch,
  formatLaunchAge,
  ingestLaunch,
  launchFromJupiterToken,
  normalizePumpMessage,
  pickKing,
  pushTape,
  selectGraduated,
  selectGraduating,
  selectNew,
  sparklinePath,
  sparklinePoints,
} from "../js/launch-feed.js";
import {
  chooseImage,
  extractIpfsCid,
  ipfsUrls,
  metadataImageValue,
  fetchableMetadataTargets,
  metadataTargets,
  nextImageUrl,
  orderImageSources,
  preferredImageUrl,
  proxyImageUrl,
  readImageCache,
  resolveMetadataImage,
  writeImageCache,
} from "../js/token-image.js";

const CID = `Qm${"a".repeat(44)}`;
const MINT = "DXufyZW86n4RM8nwcN2WMPJZvTL8cLyTSze2oSKwpWXB";
const MINT_B = "CwKkzq3bqNyKiz9ke4pvHmMKAiTijYkn8zT1WWwuxu8V";

describe("token image order and URL safety", () => {
  it("prefers metadata, then DexScreener, Jupiter, and GeckoTerminal", () => {
    const ordered = orderImageSources({
      metadata: "https://gateway.pinata.cloud/ipfs/meta.png",
      dex: "https://cdn.dexscreener.com/cms/images/abc.png",
      jupiter: "https://ipfs.io/ipfs/jup.png",
      gecko: "https://assets.geckoterminal.com/gecko.png",
      cached: "https://arweave.net/cached",
      direct: "https://cdn.example.com/direct.png",
    });
    assert.deepEqual(ordered, [
      "https://gateway.pinata.cloud/ipfs/meta.png",
      "https://cdn.dexscreener.com/cms/images/abc.png",
      "https://ipfs.io/ipfs/jup.png",
      "https://assets.geckoterminal.com/gecko.png",
      "https://arweave.net/cached",
      "https://cdn.example.com/direct.png",
    ]);
    assert.equal(chooseImage({
      metadata: "javascript:alert(1)",
      dex: "https://cdn.dexscreener.com/cms/images/abc.png",
      jupiter: "https://evil.example/icon.png",
    }), "https://cdn.dexscreener.com/cms/images/abc.png");
    assert.equal(chooseImage({ gecko: "https://assets.geckoterminal.com/only.png" }), "https://assets.geckoterminal.com/only.png");
  });

  it("rejects active, credentialed, and private image URLs", () => {
    assert.equal(safeTokenImageUrl("javascript:alert(1)"), null);
    assert.equal(safeTokenImageUrl("data:image/svg+xml,<svg></svg>"), null);
    assert.equal(safeTokenImageUrl("http://cdn.example.com/a.png"), null);
    assert.equal(safeTokenImageUrl("https://user:pass@cdn.example.com/a.png"), null);
    assert.equal(safeTokenImageUrl("https://127.0.0.1/a.png"), null);
    assert.equal(safeTokenImageUrl("https://10.1.2.3/a.png"), null);
    assert.equal(safeTokenImageUrl("https://192.168.0.8/a.png"), null);
    assert.equal(safeTokenImageUrl("https://169.254.169.254/latest"), null);
    assert.equal(safeTokenImageUrl("https://localhost/a.png"), null);
    assert.equal(safeTokenImageUrl("https://printer.local/a.png"), null);
    assert.equal(safeImageUrl("https://evil.test/logo.png"), null);
    assert.equal(safeTokenImageUrl("https://cdn.example.com/logo.png"), "https://cdn.example.com/logo.png");
    assert.equal(proxyImageUrl("javascript:alert(1)"), "");
    assert.match(proxyImageUrl("https://cdn.example.com/a.png"), /^https:\/\/wsrv\.nl\/\?url=/);
  });

  it("rewrites IPFS and Arweave metadata through public gateways", () => {
    assert.equal(extractIpfsCid(`ipfs://${CID}`), CID);
    assert.equal(extractIpfsCid(`https://cf-ipfs.com/ipfs/${CID}`), CID);
    assert.equal(ipfsUrls(CID)[0], `https://gateway.pinata.cloud/ipfs/${CID}`);
    assert.equal(preferredImageUrl(`ipfs://${CID}`), `https://gateway.pinata.cloud/ipfs/${CID}`);
    assert.equal(nextImageUrl(`https://gateway.pinata.cloud/ipfs/${CID}`), `https://4everland.io/ipfs/${CID}`);
    const targets = metadataTargets(`https://ipfs.io/ipfs/${CID}`);
    assert.equal(targets[0], `https://gateway.pinata.cloud/ipfs/${CID}`);
    assert.ok(targets.includes(`https://ipfs.io/ipfs/${CID}`));
    assert.equal(metadataTargets("javascript:alert(1)").length, 0);
    assert.deepEqual(fetchableMetadataTargets("https://gg.sc/metadata/token.json"), []);
    assert.equal(fetchableMetadataTargets(`ipfs://${CID}`).length, 3);
    assert.equal(metadataImageValue({ name: "<img>", image: `ipfs://${CID}` }), `ipfs://${CID}`);
    assert.equal(metadataImageValue({ image: { url: "https://cdn.example.com/a.png" } }), "https://cdn.example.com/a.png");
    assert.equal(preferredImageUrl("https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I"), "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I");
  });

  it("reads a metadata image and caches only safe URLs", async () => {
    const calls = [];
    const image = await resolveMetadataImage(`ipfs://${CID}`, async (url) => {
      calls.push(url);
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ image: "https://cdn.example.com/honey.png", name: "<b>nope</b>" }),
      };
    });
    assert.equal(image, "https://cdn.example.com/honey.png");
    assert.equal(calls[0], `https://gateway.pinata.cloud/ipfs/${CID}`);
    const storage = memoryStorage();
    writeImageCache(storage, {
      [MINT]: "https://cdn.example.com/honey.png",
      nope: "https://cdn.example.com/x.png",
      [MINT_B]: "javascript:alert(1)",
    });
    const cache = readImageCache(storage);
    assert.equal(cache[MINT], "https://cdn.example.com/honey.png");
    assert.equal(cache[MINT_B], undefined);
    assert.equal(cache.nope, undefined);
  });
});

describe("live launch feed", () => {
  it("parses a pump create, ignores acks, and keeps the dev buy in SOL", () => {
    assert.equal(normalizePumpMessage({ message: "Successfully subscribed to token creation events." }), null);
    assert.equal(normalizePumpMessage({ txType: "buy", mint: MINT, solAmount: 1 }), null);
    const parsed = normalizePumpMessage({
      signature: "sig",
      mint: MINT,
      txType: "create",
      initialBuy: 200963210.657135,
      solAmount: 6.913580245,
      vSolInBondingCurve: 36.913580245,
      marketCapSol: 42.33030153787057,
      name: "<img src=x onerror=alert(1)>",
      symbol: "GOOGLEGATE",
      uri: "https://gg.sc/metadata/token.json",
      pool: "pump",
    }, 1_700_000_000_000);
    assert.equal(parsed.token.ca, MINT);
    assert.equal(parsed.token.devBuySol, 6.913580245);
    assert.equal(parsed.token.name, clipText("<img src=x onerror=alert(1)>", 64));
    assert.equal(parsed.token.uri, "https://gg.sc/metadata/token.json");
    assert.equal(parsed.token.graduated, false);
    assert.ok(Math.abs(decorateLaunch(parsed.token, 100).progress - ((36.913580245 - 30) / 85) * 100) < 0.001);
    const moved = normalizePumpMessage({ txType: "migration", mint: MINT, pool: "pump-amm" }, 1_700_000_000_500);
    assert.equal(moved.token.graduated, true);
    assert.equal(moved.token.launchpad, "pumpswap");
    assert.equal(normalizePumpMessage({ txType: "create", mint: MINT, uri: "javascript:alert(1)", name: "x", symbol: "X" }).token.uri, "");
  });

  it("dedupes by mint, caps the list, and pins a token near graduation", () => {
    let list = [];
    list = ingestLaunch(list, normalizePumpMessage({
      txType: "create", mint: MINT, symbol: "OLD", solAmount: 1, vSolInBondingCurve: 106.5, pool: "pump", name: "Old",
    }, 1_000).token, { solPrice: 100, now: 10_000 });
    list = ingestLaunch(list, normalizePumpMessage({
      txType: "create", mint: MINT, symbol: "OLD", solAmount: 3, marketCapSol: 40, pool: "pump",
    }, 5_000).token, { solPrice: 100, now: 10_000 });
    assert.equal(list.length, 1);
    assert.equal(list[0].devBuySol, 1);
    assert.equal(list[0].symbol, "OLD");
    assert.equal(list[0].marketCapSol, 40);
    for (let index = 0; index < 210; index += 1) {
      const ca = jupiterMint(index);
      list = ingestLaunch(list, {
        ...list[0],
        ca,
        symbol: `T${index}`,
        createdAt: 2_000 + index,
        vSol: 30,
        graduated: false,
        marketCapSol: 28,
        spark: [],
        images: { metadata: "", dex: "", jupiter: "", gecko: "", cached: "", direct: "" },
      }, { solPrice: 100, now: 20_000, cap: LAUNCH_CAP, pinned: 80 });
    }
    assert.ok(list.length <= LAUNCH_CAP + 80);
    assert.ok(list.some((token) => token.ca === MINT));
    assert.equal(list.some((token) => token.symbol === "T0"), false);
    assert.ok(list.some((token) => token.symbol === "T209"));
    const decorated = list.map((token) => decorateLaunch(token, 100));
    const fresh = selectNew(decorated, 200);
    assert.equal(fresh.some((token) => token.graduated), false);
    assert.equal(fresh[0].symbol, "T209");
    const hot = selectGraduating(decorated, 10);
    assert.equal(hot[0].ca, MINT);
    assert.ok(hot[0].progress >= 45);
  });

  it("formats launch age, fills graduating and graduated columns, and draws a sparkline", () => {
    assert.equal(formatLaunchAge(12_000), "12s ago");
    assert.equal(formatLaunchAge(2_000), "just now");
    assert.equal(formatLaunchAge(90_000), "1m ago");
    assert.equal(bondingProgress({ vSol: 30, launchpad: "pump.fun" }), 0);
    assert.ok(Math.abs(bondingProgress({ vSol: 115, launchpad: "pump.fun" }) - 100) < 0.01);
    assert.equal(bondingProgress({ marketCapUsd: 5000, solPrice: 100, launchpad: "met-dbc" }), null);
    const low = decorateLaunch({ ca: MINT, graduated: false, launchpad: "pump.fun", vSol: 42, marketCapUsd: 4000, createdAt: 10 }, 100);
    const high = decorateLaunch({ ca: MINT_B, graduated: false, launchpad: "pump.fun", vSol: 100, marketCapUsd: 20000, createdAt: 20 }, 100);
    const done = decorateLaunch({ ca: jupiterMint(1), graduated: true, launchpad: "pumpswap", marketCapUsd: 80000, createdAt: 30, liquidity: 60000 }, 100);
    const trending = { ca: jupiterMint(2), graduated: false, trending: true, liquidity: 25000, marketCapUsd: 90000, createdAt: 5 };
    assert.equal(selectGraduating([low], 10)[0].ca, MINT);
    assert.equal(selectGraduating([low, high, { ...high, ca: jupiterMint(3), vSol: 90 }, { ...high, ca: jupiterMint(4), vSol: 110 }, { ...high, ca: jupiterMint(5), vSol: 120 }], 10)[0].progress >= 45, true);
    assert.deepEqual(selectGraduated([done, trending, low], 10).map((token) => token.ca), [done.ca, trending.ca]);
    assert.equal(pickKing([low, high]).ca, MINT_B);
    const path = sparklinePath([1, 2, 1.5], 64, 20);
    assert.match(path, /^M/);
    assert.match(path, / L/);
    assert.equal(sparklinePath([1], 64, 20), "");
    assert.deepEqual(sparklinePoints([1, null, -2, 3]), [1, 3]);
    const tape = pushTape(pushTape([], { id: "a", kind: "launch", ca: MINT, symbol: "<b>H</b>", devBuySol: 1.2, at: 10 }), {
      id: "a", kind: "launch", ca: MINT, symbol: "H", at: 11,
    });
    assert.equal(tape.length, 1);
    assert.equal(tape[0].symbol, clipText("<b>H</b>", 16));
    const jup = launchFromJupiterToken({
      id: MINT,
      name: "Honey",
      symbol: "HNY",
      icon: `ipfs://${CID}`,
      mcap: 4200,
      usdPrice: 0.00001,
      graduatedPool: "pool",
      createdAt: "2026-11-02T01:00:00Z",
    });
    assert.equal(jup.graduated, true);
    assert.match(jup.images.jupiter, /gateway\.pinata\.cloud/);
  });

  it("keeps launch names as text in the home view", () => {
    const home = readFileSync(new URL("../js/home-view.js", import.meta.url), "utf8");
    const feed = readFileSync(new URL("../js/live-feed.js", import.meta.url), "utf8");
    assert.equal(home.includes("innerHTML"), false);
    assert.equal(feed.includes("subscribeTokenTrade"), true);
    assert.match(feed, /subscribeNewToken/);
    assert.match(feed, /subscribeMigration/);
    assert.match(home, /King of the hive/);
    assert.match(home, /About to graduate/);
    assert.equal(feed.includes('method: "subscribeTokenTrade"'), false);
  });
});

function jupiterMint(index) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let body = "";
  let n = index + 1;
  for (let i = 0; i < 32; i += 1) {
    body += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + i + 3;
  }
  return `F${body.slice(0, 42)}`;
}
