// Finds Phantom or Solflare so Supabase can ask the wallet to sign a login message.
// This file never sends a transaction and never reads a wallet secret.

export const LOGIN_STATEMENT = "Sign in to Honey Charts. This signs a login message only. It does not send a transaction or move any tokens.";

export function listLoginWallets() {
  const found = [];
  pushWallet(found, phantomProvider(), "Phantom");
  pushWallet(found, solflareProvider(), "Solflare");
  return found;
}

export async function prepareLoginWallet(provider) {
  if (!provider || typeof provider.connect !== "function") return provider;
  if (provider.isConnected && provider.publicKey) return provider;
  await provider.connect();
  return provider;
}

function phantomProvider() {
  const root = typeof window !== "undefined" ? window.phantom : null;
  const nested = root && root.solana;
  if (nested && nested.isPhantom) return nested;
  const shared = typeof window !== "undefined" ? window.solana : null;
  if (shared && shared.isPhantom) return shared;
  return null;
}

function solflareProvider() {
  const provider = typeof window !== "undefined" ? window.solflare : null;
  if (provider && provider.isSolflare) return provider;
  const shared = typeof window !== "undefined" ? window.solana : null;
  if (shared && shared.isSolflare) return shared;
  return null;
}

function pushWallet(list, provider, name) {
  if (!provider) return;
  if (list.some((item) => item.provider === provider)) return;
  list.push({ name, provider });
}
