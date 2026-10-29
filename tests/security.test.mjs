import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { extractCA, isValidCA, safeHttpUrl, safeImageUrl, clipText } from "../js/sanitize.js";
import { appBase, homePath, hivePath, tokenPath, walletPath } from "../js/paths.js";
import { batchUrl, pickBestPair } from "../js/api.js";
import { buildHoneyScore, bandCopy } from "../js/score.js";
import { jupiterSwapUrl, SOL_MINT, buildSwapForm } from "../js/swap.js";
import { FEE_BPS, JUPITER_REFERRAL_ACCOUNT, feeDisclosure, resolveReferralFee } from "../js/config.js";
import {
  memoryStorage,
  createHive,
  createRecent,
  parseHiveDocument,
  exportBackup,
  applyImport,
  HIVE_KEY,
  RECENT_KEY,
} from "../js/store.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

function ca(index) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const chars = "11111111111111111111111111111111".split("");
  chars[31] = alphabet[index % alphabet.length];
  chars[30] = alphabet[Math.floor(index / alphabet.length) % alphabet.length];
  return chars.join("");
}

describe("contract addresses", () => {
  it("accepts base58 addresses in the 32 to 44 character range", () => {
    assert.equal(isValidCA(BONK), true);
    assert.equal(isValidCA(WIF), true);
    assert.equal(isValidCA(ca(1)), true);
  });

  it("rejects lookalike characters, short strings, and non-strings", () => {
    assert.equal(isValidCA("0OIl" + "1".repeat(32)), false);
    assert.equal(isValidCA(BONK.slice(0, 20)), false);
    assert.equal(isValidCA(`${BONK}extraextraextraextra`), false);
    assert.equal(isValidCA(null), false);
  });

  it("pulls one address out of a DexScreener URL", () => {
    assert.equal(extractCA(`https://dexscreener.com/solana/${BONK}?embed=1`), BONK);
    assert.equal(extractCA(`  ${BONK}  `), BONK);
    assert.equal(extractCA(`${BONK} and also ${WIF}`), null);
    assert.equal(extractCA("not an address"), null);
  });
});

describe("urls", () => {
  it("allows only http and https links without credentials", () => {
    assert.equal(safeHttpUrl("https://dexscreener.com/solana/abc"), "https://dexscreener.com/solana/abc");
    assert.equal(safeHttpUrl("http://example.com/path"), "http://example.com/path");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,hi"), null);
    assert.equal(safeHttpUrl("https://user:pass@evil.test/"), null);
  });

  it("allows token images only from DexScreener CDNs or a CMS id", () => {
    assert.equal(
      safeImageUrl("https://cdn.dexscreener.com/cms/images/abc.png"),
      "https://cdn.dexscreener.com/cms/images/abc.png",
    );
    assert.match(safeImageUrl("wxr-7WIgWHon-3OT"), /^https:\/\/cdn\.dexscreener\.com\/cms\/images\/wxr-7WIgWHon-3OT/);
    assert.equal(safeImageUrl("https://evil.test/logo.png"), null);
    assert.equal(safeImageUrl("http://cdn.dexscreener.com/logo.png"), null);
    assert.equal(safeImageUrl("javascript:alert(1)"), null);
  });

  it("clips control characters out of API text", () => {
    assert.equal(clipText("Bonk\u0000<script>", 20), "Bonk <script>");
  });
});

describe("routes", () => {
  it("keeps GitHub Pages and local servers on the repo path", () => {
    assert.equal(appBase("/Honeycharts/index.html"), "/Honeycharts/");
    assert.equal(homePath("/"), "/");
    assert.equal(hivePath("/Honeycharts/"), "/Honeycharts/?view=hive");
    assert.equal(tokenPath("/Honeycharts/", BONK), `/Honeycharts/?ca=${BONK}`);
    assert.equal(walletPath("/Honeycharts/", BONK), `/Honeycharts/?wallet=${BONK}`);
    assert.equal(walletPath("/Honeycharts/"), "/Honeycharts/?view=wallet");
  });
});

describe("dex pair selection", () => {
  it("keeps the deepest pair where the address is the base token", () => {
    const pairs = [
      { chainId: "solana", baseToken: { address: BONK }, liquidity: { usd: 10 } },
      { chainId: "solana", baseToken: { address: WIF }, quoteToken: { address: BONK }, liquidity: { usd: 999 } },
      { chainId: "solana", baseToken: { address: BONK }, liquidity: { usd: 50 } },
      { chainId: "ethereum", baseToken: { address: BONK }, liquidity: { usd: 5000 } },
    ];
    assert.equal(pickBestPair(pairs, BONK).liquidity.usd, 50);
    assert.match(batchUrl([BONK, WIF]), new RegExp(`${BONK},${WIF}$`));
  });
});

describe("honey score", () => {
  it("stays high for a revoked, locked, liquid, older pair with one warning", () => {
    const result = buildHoneyScore(oldLiquidPair(), cleanReport(), {});
    assert.equal(result.incomplete, false);
    assert.equal(result.score, 96);
    assert.equal(result.flags.some((flag) => flag.title.includes("locked or burned")), true);
    assert.doesNotMatch(result.summary, /is safe/i);
    assert.doesNotMatch(bandCopy(90, false).summary, /is safe/i);
  });

  it("drops to the floor when several hard flags fire", () => {
    const result = buildHoneyScore(
      { liquidity: { usd: 1000 }, pairCreatedAt: Date.now() - 10 * 60 * 1000 },
      {
        mintAuthority: "MintAuthority111111111111111111111111111",
        freezeAuthority: "FreezeAuthority11111111111111111111111111",
        token: {
          mintAuthority: "MintAuthority111111111111111111111111111",
          freezeAuthority: "FreezeAuthority11111111111111111111111111",
        },
        markets: [{
          lp: { lpMint: "RealLpMint111111111111111111111111111111", lpTotalSupply: 100, lpLockedPct: 2, baseUSD: 500, quoteUSD: 500 },
        }],
        topHolders: [{ pct: 55 }, { pct: 10 }, { pct: 10 }],
        risks: [{ name: "Danger", description: "Bad", level: "danger" }],
        rugged: false,
      },
      {},
    );
    assert.equal(result.score, 0);
    assert.equal(result.band, "Many flags");
  });

  it("caps an incomplete score and still counts thin liquidity", () => {
    const healthy = buildHoneyScore(oldLiquidPair(), null, { reportError: "network" });
    assert.equal(healthy.incomplete, true);
    assert.equal(healthy.score, 55);
    const thin = buildHoneyScore(
      { liquidity: { usd: 100 }, pairCreatedAt: Date.now() - 60 * 1000 },
      null,
      { reportError: "rate" },
    );
    assert.ok(thin.score < 55);
    assert.equal(thin.flags[0].title, "RugCheck report did not load");
  });

  it("caps a rugged token", () => {
    const result = buildHoneyScore(oldLiquidPair(), { ...cleanReport(), rugged: true, risks: [] }, {});
    assert.ok(result.score <= 8);
    assert.equal(result.rugged, true);
  });
});

describe("hive backup", () => {
  it("round-trips storage and rejects hostile files", () => {
    const storage = memoryStorage();
    const hive = createHive(storage);
    const recent = createRecent(storage);
    hive.add(BONK, "Bonk", "Bonk");
    hive.setNote(BONK, "  watch the wick  ");
    recent.touch(BONK, "Bonk", "Bonk");
    const reloaded = createHive(memoryStorage({ [HIVE_KEY]: storage.getItem(HIVE_KEY) }));
    assert.equal(reloaded.list()[0].symbol, "Bonk");
    assert.equal(reloaded.list()[0].note, "watch the wick");
    const recentAgain = createRecent(memoryStorage({ [RECENT_KEY]: storage.getItem(RECENT_KEY) }));
    assert.equal(recentAgain.list()[0].ca, BONK);

    const backup = exportBackup(hive, recent);
    const parsed = parseHiveDocument(JSON.stringify(backup), "file");
    assert.equal(parsed.tokens[0].ca, BONK);
    assert.equal(parsed.recent[0].ca, BONK);

    const merged = createHive(memoryStorage());
    const mergedRecent = createRecent(memoryStorage());
    const result = applyImport(merged, mergedRecent, parsed, "merge");
    assert.equal(result.added, 1);
    applyImport(merged, mergedRecent, {
      ...parsed,
      tokens: [{ ca: BONK, note: "updated", addedAt: Date.now() }],
    }, "merge");
    assert.equal(merged.get(BONK).note, "updated");
  });

  it("rejects prototype pollution, bad addresses, duplicates, and extra fields", () => {
    assert.throws(
      () => parseHiveDocument('{"version":1,"app":"honeycharts","tokens":[],"__proto__":{"polluted":true}}', "file"),
      /field/,
    );
    JSON.parse('{"__proto__":{"polluted":true}}');
    assert.equal(({}).polluted, undefined);
    assert.throws(() => parseHiveDocument(JSON.stringify({
      version: 1,
      tokens: [{ ca: "not-a-ca", note: "", addedAt: 1 }],
    }), "file"), /ca/);
    assert.throws(() => parseHiveDocument(JSON.stringify({
      version: 1,
      tokens: [
        { ca: BONK, note: "", addedAt: 1 },
        { ca: BONK, note: "", addedAt: 1 },
      ],
    }), "file"), /duplicate/);
    assert.throws(() => parseHiveDocument(JSON.stringify({
      version: 1,
      tokens: [{ ca: BONK, note: "ok", addedAt: 1, name: "<img>" }],
    }), "file"), /token-field/);
    assert.throws(() => parseHiveDocument(JSON.stringify({
      version: 1,
      tokens: [{ ca: BONK, note: "line\nbreak", addedAt: 1 }],
    }), "file"), /note/);
    assert.throws(() => parseHiveDocument("{", "file"), /json/);
    const tooMany = Array.from({ length: 201 }, (_, index) => ({ ca: ca(index), note: "", addedAt: 1 }));
    assert.throws(() => parseHiveDocument(JSON.stringify({ version: 1, tokens: tooMany }), "file"), /too-many/);
  });
});

describe("jupiter swap link", () => {
  it("builds a SOL-to-token Jupiter URL and keeps the wallet inside the plugin", () => {
    assert.equal(jupiterSwapUrl(BONK), `https://jup.ag/swap/SOL-${BONK}`);
    assert.equal(jupiterSwapUrl("nope"), null);
    assert.equal(SOL_MINT, "So11111111111111111111111111111111111111112");
    const source = readFileSync(new URL("../js/swap.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /enableWalletPassthrough:\s*true/);
    assert.doesNotMatch(source, /window\.solana|signTransaction|signMessage|privateKey|seed phrase/);
  });

  it("charges 50 bps only when a public referral account is set", () => {
    assert.equal(JUPITER_REFERRAL_ACCOUNT, "6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU");
    assert.equal(FEE_BPS, 50);
    assert.equal(buildSwapForm(BONK).referralAccount, JUPITER_REFERRAL_ACCOUNT);
    assert.equal(buildSwapForm(BONK).referralFee, 50);
    assert.equal(feeDisclosure(), "Includes a 0.5% Honeycharts fee.");

    const on = resolveReferralFee(BONK, 50);
    assert.deepEqual(on, { account: BONK, bps: 50 });
    assert.equal(resolveReferralFee(BONK, 1000).bps, 255);
    assert.equal(resolveReferralFee(BONK, 1).bps, 50);
    assert.equal(resolveReferralFee("", 50), null);
    assert.equal(resolveReferralFee("1".repeat(88), 50), null);
    assert.equal(resolveReferralFee("  " + BONK + " ", 50).account, BONK);
  });
});

describe("page source", () => {
  it("keeps scripts, styles, and wallet access out of the static page", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const files = readdirSync(new URL("../js/", import.meta.url)).filter((name) => name.endsWith(".js"));
    const js = files.map((name) => readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8")).join("\n");
    const withoutWallet = files
      .filter((name) => name !== "wallet.js")
      .map((name) => readFileSync(new URL(`../js/${name}`, import.meta.url), "utf8"))
      .join("\n");
    assert.match(html, /script-src 'self' https:\/\/plugin\.jup\.ag/);
    assert.match(html, /https:\/\/api\.dexscreener\.com/);
    assert.match(html, /https:\/\/api\.rugcheck\.xyz/);
    assert.match(html, /https:\/\/api\.devnet\.solana\.com/);
    assert.match(html, /https:\/\/solana-rpc\.publicnode\.com/);
    assert.match(html, /frame-src https:\/\/dexscreener\.com/);
    assert.match(html, /style-src-elem[^;]*'unsafe-inline'/);
    assert.doesNotMatch(html, /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(html, /unsafe-eval/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
    assert.doesNotMatch(html, /\son\w+=/i);
    assert.match(html, /Honeycharts will never ask for your seed phrase or private key\. Swaps are handled by Jupiter in your own wallet; always check the transaction before approving\./);
    assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function|wallet-adapter|window\.solana|signMessage/);
    assert.doesNotMatch(withoutWallet, /signTransaction/);
    assert.doesNotMatch(js, /seed phrase|privateKey|secretKey\s*=/);
    assert.doesNotMatch(html + js, /style="/);
  });
});

function oldLiquidPair() {
  return {
    liquidity: { usd: 300000 },
    fdv: 269000000,
    marketCap: 269000000,
    volume: { h24: 150000 },
    priceUsd: "0.000003",
    pairCreatedAt: Date.now() - 400 * 24 * 60 * 60 * 1000,
    dexId: "orca",
    baseToken: { address: BONK, name: "Bonk", symbol: "Bonk" },
    quoteToken: { symbol: "SOL" },
  };
}

function cleanReport() {
  return {
    mint: BONK,
    mintAuthority: null,
    freezeAuthority: null,
    token: { mintAuthority: null, freezeAuthority: null },
    markets: [{
      lp: {
        lpMint: "RealLpMint111111111111111111111111111111",
        lpTotalSupply: 1000,
        lpLockedPct: 100,
        baseUSD: 80000,
        quoteUSD: 2500,
      },
    }],
    topHolders: [{ pct: 8.8 }, { pct: 6.7 }, { pct: 3.8 }],
    totalHolders: 1000,
    risks: [{ name: "Mutable metadata", description: "Token metadata can be changed by the owner", level: "warn" }],
    score_normalised: 7,
    rugged: false,
    transferFee: { pct: 0 },
  };
}
