import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAUNCH_ENABLED, brandLabel, copyrightNotice, launchFeeConfig, LAUNCH_FEE_SOL, LAUNCH_FEE_WALLET } from "../js/config.js";
import { describeLaunch, pumpMetadata, validateLaunch } from "../js/launch-form.js";
import { formatLamports, hostedFileUrl, solToLamports } from "../js/launch-tx.js";

function fields(extra = {}) {
  return {
    name: "Honey Test",
    symbol: "htest",
    description: "A mainnet bonding-curve token",
    website: "",
    twitter: "",
    telegram: "",
    initialBuy: "0",
    ...extra,
  };
}

const image = { type: "image/png", size: 128, name: "honey.png" };

describe("launch form", () => {
  it("accepts a bonding-curve form and builds pump metadata", () => {
    const parsed = validateLaunch(fields({
      website: "https://honeycharts.example/",
      twitter: "https://x.com/honeycharts",
      initialBuy: "0.1",
    }), image);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.symbol, "HTEST");
    assert.equal(parsed.value.initialBuySol, 0.1);
    const doc = pumpMetadata(parsed.value, "https://gateway.pinata.cloud/ipfs/abc");
    assert.equal(doc.name, "Honey Test");
    assert.equal(doc.website, "https://honeycharts.example/");
    assert.equal(doc.twitter, "https://x.com/honeycharts");
    assert.equal(doc.image, "https://gateway.pinata.cloud/ipfs/abc");
  });

  it("rejects control characters, a bad link, and a missing image", () => {
    const parsed = validateLaunch(fields({
      name: "Bad\nName",
      website: "http://example.com",
      initialBuy: "11",
    }), null);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.errors.some((error) => error.includes("Name")));
    assert.ok(parsed.errors.some((error) => error.includes("Website")));
    assert.ok(parsed.errors.some((error) => error.includes("Image")));
    assert.ok(parsed.errors.some((error) => error.includes("Initial buy")));
  });

  it("discloses the 0.02 SOL launch fee", () => {
    assert.equal(LAUNCH_FEE_SOL, 0.02);
    assert.equal(LAUNCH_FEE_WALLET, "7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6");
    const fee = launchFeeConfig();
    assert.equal(fee.sol, 0.02);
    assert.equal(fee.wallet, LAUNCH_FEE_WALLET);
    const lines = describeLaunch(validateLaunch(fields(), image).value, fee);
    assert.ok(lines.some((line) => line === "Includes 0.02 SOL Honeycharts launch fee"));
    assert.ok(lines.some((line) => line.includes("bonding-curve")));
    assert.equal(solToLamports(0.02), 20000000n);
    assert.equal(formatLamports(20000000n), "0.02");
  });

  it("accepts a pasted metadata link without an image and names the copyright owner once", () => {
    const parsed = validateLaunch(fields({
      metadataUri: "https://example.com/honeycharts/metadata.json",
    }), null);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.metadataUri, "https://example.com/honeycharts/metadata.json");
    assert.equal(parsed.value.image, null);
    assert.equal(validateLaunch(fields({ metadataUri: "http://example.com/m.json" }), null).ok, false);
    assert.equal(hostedFileUrl("https://litter.catbox.moe/abc123.json"), "https://litter.catbox.moe/abc123.json");
    assert.equal(hostedFileUrl("https://evil.example/abc123.json"), "");
    assert.equal(LAUNCH_ENABLED, false);
    assert.equal(brandLabel(), "Honey Charts™");
    assert.equal(copyrightNotice(), "© 2026 Honey Charts™. All rights reserved.");
  });
});
