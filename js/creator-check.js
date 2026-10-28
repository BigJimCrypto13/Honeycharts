import { isValidCA, clipText } from "./sanitize.js";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const LIQUIDITY_FLOOR_USD = 500;
export const DROP_LIMIT = -90;
export const MIN_PAIR_AGE_MS = 2 * 60 * 60 * 1000;
export const SERIAL_MIN_LOSSES = 2;
export const CREATOR_SCORE_PENALTY = 30;

const SOURCE_LABEL = {
  rugcheck: "RugCheck creator field",
  "mint-authority": "mint authority",
  "first-signer": "first signer of the earliest transaction read",
};

export function sourceLabel(source) {
  return SOURCE_LABEL[source] || "public record";
}

export function creatorFromReport(report, mint) {
  const creator = report && typeof report.creator === "string" ? report.creator.trim() : "";
  if (!isValidCA(creator) || creator === mint) return null;
  return { wallet: creator, source: "rugcheck" };
}

export function mintFromCreateTransaction(tx, wallet) {
  if (!tx || !tx.transaction || !tx.transaction.message) return null;
  const keys = tx.transaction.message.accountKeys || [];
  const pubs = keys.map((key) => (typeof key === "string" ? key : key && key.pubkey));
  if (!pubs.includes(PUMP_PROGRAM)) return null;
  const logs = (tx.meta && tx.meta.logMessages) || [];
  const created = logs.some((line) => typeof line === "string" && line.includes("Instruction: Create"));
  if (!created) return null;
  const signers = keys
    .filter((key) => key && key.signer && typeof key.pubkey === "string")
    .map((key) => key.pubkey);
  const mint = signers.find((key) => key !== wallet && isValidCA(key));
  return mint || null;
}

export function classifyCoin(input) {
  const change24 = num(input && input.change24);
  const change6 = num(input && input.change6);
  const liquidity = num(input && input.liquidityUsd);
  const age = num(input && input.pairAgeMs);
  const rugged = input && input.rugged === true ? true : input && input.rugged === false ? false : null;
  const enough = change24 != null || change6 != null || liquidity != null || rugged != null;
  if (!enough) return { enough: false, loss: false, reasons: [] };
  const reasons = [];
  if (rugged === true) reasons.push("RugCheck marked this coin rugged");
  if (change24 != null && change24 <= DROP_LIMIT) reasons.push("Price fell more than 90% in 24 hours");
  if (change6 != null && change6 <= DROP_LIMIT) reasons.push("Price fell more than 90% in 6 hours");
  if (liquidity != null && liquidity < LIQUIDITY_FLOOR_USD && age != null && age >= MIN_PAIR_AGE_MS) {
    reasons.push("Liquidity is under $500 after the pair was at least 2 hours old");
  }
  return { enough: true, loss: reasons.length > 0, reasons };
}

export function coinFromPair(mint, pair, rugged) {
  const name = clipText(pair && pair.baseToken && pair.baseToken.name, 40) || "Unknown";
  const symbol = clipText(pair && pair.baseToken && pair.baseToken.symbol, 16) || "";
  const classified = classifyCoin({
    change24: pair && pair.priceChange && pair.priceChange.h24,
    change6: pair && pair.priceChange && pair.priceChange.h6,
    liquidityUsd: pair && pair.liquidity && pair.liquidity.usd,
    pairAgeMs: pairAge(pair),
    rugged,
  });
  return { mint, name, symbol, ...classified };
}

export function summarizeHistory(coins) {
  const list = Array.isArray(coins) ? coins : [];
  const checked = list.filter((coin) => coin && coin.enough);
  const losses = checked.filter((coin) => coin.loss);
  const serial = losses.length >= SERIAL_MIN_LOSSES;
  if (!checked.length) {
    return {
      status: "insufficient",
      serial: false,
      checked: 0,
      losses: 0,
      headline: "Not enough data to describe this wallet's launches.",
      coins: list,
    };
  }
  const headline = `${losses.length} of ${checked.length} coins from this wallet lost more than 90% in the last 6 or 24 hours, had liquidity under $500, or were marked rugged.`;
  const status = checked.length < SERIAL_MIN_LOSSES ? "insufficient" : "ready";
  const text = status === "insufficient"
    ? `${headline} Not enough data to describe a pattern.`
    : headline;
  return {
    status,
    serial,
    checked: checked.length,
    losses: losses.length,
    headline: text,
    coins: list,
  };
}

export function pairAge(pair) {
  const created = num(pair && pair.pairCreatedAt);
  if (created == null || created <= 0) return null;
  const age = Date.now() - created;
  if (age < -5 * 60 * 1000) return null;
  return Math.max(0, age);
}

function num(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
