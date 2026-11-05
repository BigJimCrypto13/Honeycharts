import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_SIGNATURE_FEE,
  RENT_EXEMPT_MIN,
  SAMPLE_ADDRESS,
  SAMPLE_COLD,
  TOKEN_ACCOUNT_RENT,
  USDC_DECIMALS,
  USDC_MINT,
  amountUsd,
  canCoverFee,
  decodeBase58,
  depositToastText,
  encodeBase58,
  feeParts,
  formatTokenAmount,
  incomingDeltas,
  isSolanaAddress,
  maxSolAfterFee,
  needsMoreSol,
  normalizeAddress,
  offlineTransfers,
  parseActivityRows,
  parseTokenAmount,
  readRpcUrl,
  stablePrice,
  togglePark,
  withdrawAddressError,
} from "../js/wallet-logic.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const REFERRAL = "6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU";

describe("solana addresses", () => {
  it("accepts 32-byte base58 and rejects lookalikes", () => {
    assert.equal(isSolanaAddress(USDC_MINT), true);
    assert.equal(isSolanaAddress(BONK), true);
    assert.equal(isSolanaAddress(REFERRAL), true);
    assert.equal(isSolanaAddress(SAMPLE_ADDRESS), true);
    assert.equal(isSolanaAddress(SAMPLE_COLD), true);
    assert.equal(decodeBase58(USDC_MINT).length, 32);
    assert.equal(encodeBase58(decodeBase58(BONK)), BONK);
    assert.equal(isSolanaAddress(`  ${USDC_MINT}  `), true);
    assert.equal(isSolanaAddress(USDC_MINT.slice(0, 20)), false);
    assert.equal(isSolanaAddress(`O${"1".repeat(40)}`), false);
    assert.equal(isSolanaAddress(`0${"1".repeat(40)}`), false);
    assert.equal(isSolanaAddress("1".repeat(32)), true);
    assert.equal(isSolanaAddress(""), false);
    assert.equal(isSolanaAddress(null), false);
  });

  it("explains a bad withdraw address and blocks sending to yourself", () => {
    assert.equal(withdrawAddressError("", SAMPLE_ADDRESS), "Paste a Solana address.");
    assert.match(withdrawAddressError("not-an-address", SAMPLE_ADDRESS), /not a Solana address/);
    assert.equal(withdrawAddressError(SAMPLE_ADDRESS, SAMPLE_ADDRESS), "That is this wallet. Paste a different address.");
    assert.equal(withdrawAddressError(` ${SAMPLE_COLD} `, SAMPLE_ADDRESS), "");
    assert.equal(normalizeAddress(SAMPLE_COLD), SAMPLE_COLD);
  });
});

describe("token amounts", () => {
  it("parses decimals without rounding up and rejects extra places", () => {
    assert.equal(parseTokenAmount("1", 9), 1000000000n);
    assert.equal(parseTokenAmount("0.5", 9), 500000000n);
    assert.equal(parseTokenAmount("0.000001", USDC_DECIMALS), 1n);
    assert.equal(parseTokenAmount("1.234567", USDC_DECIMALS), 1234567n);
    assert.equal(parseTokenAmount("1.2345678", USDC_DECIMALS), null);
    assert.equal(parseTokenAmount("0", 9), null);
    assert.equal(parseTokenAmount("-1", 9), null);
    assert.equal(parseTokenAmount("1e2", 9), null);
    assert.equal(parseTokenAmount(" 2.5 ", USDC_DECIMALS), 2500000n);
    assert.equal(formatTokenAmount(2500000n, USDC_DECIMALS), "2.5");
    assert.equal(formatTokenAmount(1000000000n, 9), "1");
    assert.equal(formatTokenAmount(1n, 9), "0.000000001");
    assert.equal(parseTokenAmount(formatTokenAmount(123456789n, 9), 9), 123456789n);
  });

  it("leaves the network fee and rent reserve when Max is pressed", () => {
    const balance = 1000000000n;
    const parts = feeParts();
    const max = maxSolAfterFee(balance, parts.signature, parts.reserve);
    assert.equal(parts.signature, BASE_SIGNATURE_FEE);
    assert.equal(parts.reserve, RENT_EXEMPT_MIN);
    assert.equal(max, balance - BASE_SIGNATURE_FEE - RENT_EXEMPT_MIN);
    assert.equal(max + parts.signature + parts.reserve, balance);
    assert.equal(maxSolAfterFee(parts.signature + parts.reserve, parts.signature, parts.reserve), 0n);
    assert.equal(maxSolAfterFee(1000n, parts.signature, parts.reserve), 0n);
    assert.equal(formatTokenAmount(max, 9), parseDisplay(max));
  });

  it("adds a token-account rent hold only when the recipient needs one", () => {
    const plain = feeParts({ tokenTransfer: true, destinationNeedsAccount: false });
    const created = feeParts({ tokenTransfer: true, destinationNeedsAccount: true });
    assert.equal(plain.accountRent, 0n);
    assert.equal(created.accountRent, TOKEN_ACCOUNT_RENT);
    assert.equal(canCoverFee(BASE_SIGNATURE_FEE + RENT_EXEMPT_MIN, plain), true);
    assert.equal(canCoverFee(BASE_SIGNATURE_FEE + RENT_EXEMPT_MIN, created), false);
    const enough = BASE_SIGNATURE_FEE + TOKEN_ACCOUNT_RENT + RENT_EXEMPT_MIN;
    assert.equal(canCoverFee(enough, created), true);
  });

  it("asks for funds when SOL is empty or short of the buy", () => {
    assert.equal(needsMoreSol(0n, 100000000n), true);
    assert.equal(needsMoreSol(0n, 0n), true);
    assert.equal(needsMoreSol(50000000n, 100000000n), true);
    assert.equal(needsMoreSol(100000000n, 100000000n), false);
    assert.equal(needsMoreSol(100000000n, null), false);
    assert.equal(amountUsd(1500000000n, 9, 150), 225);
    assert.equal(amountUsd(25000000n, USDC_DECIMALS, 1), 25);
    assert.equal(stablePrice(USDC_MINT, null), 1);
  });
});

describe("deposits, activity, and the hive vault", () => {
  it("notices SOL and USDC that arrived after the last snapshot", () => {
    const before = { sol: 1000n, tokens: [{ mint: USDC_MINT, amount: 1000000n, decimals: 6, symbol: "USDC" }] };
    const after = { sol: 500000000n + 1000n, tokens: [{ mint: USDC_MINT, amount: 26000000n, decimals: 6, symbol: "USDC" }] };
    const events = incomingDeltas(before, after);
    assert.equal(events.length, 2);
    assert.equal(depositToastText(events[0]), "Deposit received: +0.5 SOL");
    assert.equal(depositToastText(events[1]), "Deposit received: +25 USDC");
  });

  it("labels incoming and outgoing transfers and ignores a fee-only SOL dip", () => {
    const owner = SAMPLE_ADDRESS;
    const rows = parseActivityRows({
      blockTime: 1,
      transaction: { signatures: ["sig1"], message: { accountKeys: [owner] } },
      meta: {
        err: null,
        preBalances: [1000000000],
        postBalances: [999995000],
        preTokenBalances: [],
        postTokenBalances: [{
          owner,
          mint: USDC_MINT,
          uiTokenAmount: { amount: "5000000", decimals: 6 },
        }],
      },
    }, owner);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].direction, "in");
    assert.equal(rows[0].symbol, "Token");
    assert.equal(rows[0].amount, 5000000n);
    const sent = parseActivityRows({
      blockTime: 1,
      transaction: { signatures: ["sig2"], message: { accountKeys: [{ pubkey: owner }] } },
      meta: {
        err: null,
        preBalances: [2000000000],
        postBalances: [1000000000],
        preTokenBalances: [],
        postTokenBalances: [],
      },
    }, owner);
    assert.equal(sent[0].direction, "out");
    assert.equal(sent[0].symbol, "SOL");
    assert.equal(sent[0].amount, 1000000000n);
  });

  it("plans take-offline for parked coins only", () => {
    let vault = { coldAddress: "", parked: [] };
    vault = togglePark(vault, BONK);
    assert.deepEqual(vault.parked, [BONK]);
    assert.equal(offlineTransfers(vault, [{ mint: BONK, amount: 5n, decimals: 5, symbol: "BONK" }]).length, 0);
    vault = { ...vault, coldAddress: SAMPLE_COLD };
    const plan = offlineTransfers(vault, [
      { mint: BONK, amount: 5n, decimals: 5, symbol: "BONK", account: "ata", programId: "prog" },
      { mint: USDC_MINT, amount: 1n, decimals: 6, symbol: "USDC" },
    ]);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].mint, BONK);
    assert.equal(plan[0].amount, 5n);
  });

  it("uses the public RPC unless a public Helius key is set", () => {
    assert.equal(readRpcUrl("https://solana-rpc.publicnode.com", ""), "https://solana-rpc.publicnode.com");
    assert.equal(
      readRpcUrl("https://solana-rpc.publicnode.com", "abcd1234"),
      "https://mainnet.helius-rpc.com/?api-key=abcd1234",
    );
    assert.equal(readRpcUrl("https://solana-rpc.publicnode.com", "short"), "https://solana-rpc.publicnode.com");
  });
});

function parseDisplay(amount) {
  return formatTokenAmount(amount, 9);
}
