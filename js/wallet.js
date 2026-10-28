// Wallet Standard, Phantom, and Solflare only. Called from the Launch tab
// after the user clicks Connect. This file never reads a secret key.

const standardWallets = [];
let listening = false;

function listenForWallets() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const api = event.detail;
    if (typeof api !== "function") return;
    try {
      api({
        register(wallet) {
          if (!wallet || !allowedName(wallet.name)) return;
          if (standardWallets.some((item) => item.name === wallet.name)) return;
          standardWallets.push(wallet);
        },
      });
    } catch {
      // A wallet that fails to register is ignored.
    }
  });
}

function allowedName(name) {
  const value = String(name || "").toLowerCase();
  return value.includes("phantom") || value.includes("solflare");
}

export function listLaunchWallets() {
  listenForWallets();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("wallet-standard:app-ready"));
  }
  const choices = [];
  for (const wallet of standardWallets) {
    const chains = Array.isArray(wallet.chains) ? wallet.chains : [];
    if (!chains.some((chain) => String(chain).startsWith("solana:"))) continue;
    if (!wallet.features || !wallet.features["standard:connect"]) continue;
    if (!wallet.features["solana:signTransaction"] && !wallet.features["solana:signAndSendTransaction"]) continue;
    choices.push({ kind: "standard", name: String(wallet.name), wallet });
  }
  const phantom = injectedPhantom();
  if (phantom && !choices.some((item) => item.name.toLowerCase().includes("phantom"))) {
    choices.push({ kind: "injected", name: "Phantom", provider: phantom });
  }
  const solflare = injectedSolflare();
  if (solflare && !choices.some((item) => item.name.toLowerCase().includes("solflare"))) {
    choices.push({ kind: "injected", name: "Solflare", provider: solflare });
  }
  return choices;
}

function injectedPhantom() {
  const root = typeof window !== "undefined" ? window.phantom : null;
  const provider = root && root.solana;
  if (!provider || !provider.isPhantom) return null;
  return provider;
}

function injectedSolflare() {
  const provider = typeof window !== "undefined" ? window.solflare : null;
  if (!provider || !provider.isSolflare) return null;
  return provider;
}

export async function connectLaunchWallet(choice, cluster) {
  if (!choice) throw new Error("Choose Phantom or Solflare.");
  if (choice.kind === "injected") return connectInjected(choice);
  return connectStandard(choice, cluster);
}

async function connectInjected(choice) {
  const response = await choice.provider.connect();
  const key = choice.provider.publicKey || (response && response.publicKey);
  if (!key || typeof key.toBase58 !== "function") throw new Error("The wallet did not share a public address.");
  const address = key.toBase58();
  return {
    name: choice.name,
    address,
    provider: choice.provider,
    async sign(transaction) {
      const signed = await choice.provider.signTransaction(transaction);
      if (!signed || typeof signed.serialize !== "function") {
        throw new Error("The wallet did not return a signed transaction.");
      }
      return signedBytes(signed);
    },
  };
}

async function connectStandard(choice, cluster) {
  const connect = choice.wallet.features["standard:connect"];
  const result = await connect.connect();
  const accounts = result && Array.isArray(result.accounts) ? result.accounts : [];
  const account = accounts.find((item) => Array.isArray(item.chains) && item.chains.some((chain) => String(chain).startsWith("solana:")));
  if (!account || typeof account.address !== "string") throw new Error("The wallet did not share a public address.");
  const chain = cluster === "mainnet" ? "solana:mainnet" : "solana:devnet";
  return {
    name: choice.name,
    address: account.address,
    provider: standardIrysProvider(choice, account),
    async sign(transaction) {
      const bytes = unsignedBytes(transaction);
      const feature = choice.wallet.features["solana:signTransaction"];
      if (!feature) throw new Error("This wallet cannot sign a transaction for Honeycharts to send.");
      const outputs = await feature.signTransaction({ account, transaction: bytes, chain });
      const signed = outputs && outputs[0] && outputs[0].signedTransaction;
      if (!signed) throw new Error("The wallet did not return a signed transaction.");
      return signed;
    },
  };
}

function standardIrysProvider(choice, account) {
  const keyBytes = account.publicKey instanceof Uint8Array ? account.publicKey : new Uint8Array();
  return {
    publicKey: {
      toBuffer() {
        return keyBytes;
      },
    },
    async signMessage(message) {
      const feature = choice.wallet.features["solana:signMessage"];
      if (!feature) throw new Error("This wallet cannot sign the storage message.");
      const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
      const outputs = await feature.signMessage({ account, message: bytes });
      const signature = outputs && outputs[0] && outputs[0].signature;
      if (!(signature instanceof Uint8Array)) throw new Error("The wallet did not return a storage signature.");
      return signature;
    },
    async sendTransaction(transaction, connection, options) {
      const feature = choice.wallet.features["solana:signTransaction"];
      if (!feature) throw new Error("This wallet cannot pay for storage.");
      const outputs = await feature.signTransaction({
        account,
        transaction: unsignedBytes(transaction),
        chain: "solana:mainnet",
      });
      const signed = outputs && outputs[0] && outputs[0].signedTransaction;
      if (!signed) throw new Error("The wallet did not return a signed storage payment.");
      return connection.sendRawTransaction(signed, options || {});
    },
  };
}

function unsignedBytes(transaction) {
  if (transaction && typeof transaction.version === "number") return transaction.serialize();
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

function signedBytes(transaction) {
  return transaction.serialize();
}
