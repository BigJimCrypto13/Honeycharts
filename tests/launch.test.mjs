import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { launchFeeConfig, LAUNCH_FEE_SOL, LAUNCH_FEE_WALLET } from "../js/config.js";
import { describeLaunch, metadataDocument, validateLaunch } from "../js/launch-form.js";
import { formatLamports, solToLamports } from "../js/launch-tx.js";

const META = "https://example.com/honeycharts/metadata.json";

function fields(extra = {}) {
  return {
    name: "Honey Test",
    symbol: "htest",
    decimals: "6",
    supply: "1000",
    imageUrl: "",
    description: "A devnet test token",
    website: "",
    twitter: "",
    telegram: "",
    metadataUri: META,
    ...extra,
  };
}

describe("launch form", () => {
  it("accepts a strict token form and builds metadata json", () => {
    const parsed = validateLaunch(fields({
      website: "https://honeycharts.example/",
      twitter: "https://x.com/honeycharts",
    }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.symbol, "HTEST");
    assert.equal(parsed.value.decimals, 6);
    const doc = metadataDocument(parsed.value);
    assert.equal(doc.name, "Honey Test");
    assert.equal(doc.external_url, "https://honeycharts.example/");
    assert.equal(doc.extensions.twitter, "https://x.com/honeycharts");
    assert.equal(doc.image, undefined);
  });

  it("rejects control characters, bad links, and an oversized supply", () => {
    const parsed = validateLaunch(fields({
      name: "Bad\nName",
      metadataUri: "http://example.com/meta.json",
      supply: "999999999999999999",
      decimals: "9",
    }));
    assert.equal(parsed.ok, false);
    assert.ok(parsed.errors.some((error) => error.includes("Name")));
    assert.ok(parsed.errors.some((error) => error.includes("Metadata")));
  });

  it("describes revoke defaults and leaves the launch fee off", () => {
    assert.equal(LAUNCH_FEE_SOL, 0);
    assert.equal(LAUNCH_FEE_WALLET, "");
    assert.equal(launchFeeConfig(), null);
    const lines = describeLaunch(validateLaunch(fields()).value, {
      revokeMint: true,
      revokeFreeze: true,
      fee: null,
    });
    assert.ok(lines.some((line) => line.includes("Revoke mint authority")));
    assert.ok(lines.some((line) => line.includes("Revoke freeze authority")));
    assert.ok(lines.some((line) => line.includes("liquidity pool")));
    assert.equal(solToLamports("0.5"), 500000000n);
    assert.equal(formatLamports(1500000000n), "1.5");
  });
});
