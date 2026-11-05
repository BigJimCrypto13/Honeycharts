// Wallet Standard, Phantom, and Solflare. Launch signing stays behind
// Connect wallet to launch. Login discovery only forwards a sign-in
// message to the wallet. This file never reads a secret key.

const standardWallets = [];
const loginStandardWallets = [];
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
          if (!wallet) return;
          rememberLoginWallet(wallet);
          if (!allowedName(wallet.name)) return;
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

function unsignedBytes(transaction) {
  if (transaction && typeof transaction.version === "number") return transaction.serialize();
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

function signedBytes(transaction) {
  return transaction.serialize();
}

export function listStandardLoginWallets() {
  listenForWallets();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("wallet-standard:app-ready"));
  }
  return loginStandardWallets.map((wallet) => ({ name: String(wallet.name), wallet }));
}

// Adapts a Wallet Standard wallet to the shape Supabase sign-in expects.
// It signs a login message only. It does not sign a transaction.
export function standardLoginProvider(wallet) {
  if (!wallet || !wallet.features) return null;
  const signInFeature = wallet.features["solana:signIn"];
  if (signInFeature && typeof signInFeature.signIn === "function") {
    return {
      async connect() {
        const connect = wallet.features["standard:connect"];
        if (connect && typeof connect.connect === "function") await connect.connect();
      },
      signIn(input) {
        return signInFeature.signIn(input);
      },
    };
  }
  const signMessageFeature = wallet.features["solana:signMessage"];
  if (!signMessageFeature || typeof signMessageFeature.signMessage !== "function") return null;
  let account = null;
  const provider = {
    publicKey: {
      toBase58() {
        return account && typeof account.address === "string" ? account.address : "";
      },
    },
    async connect() {
      const connect = wallet.features["standard:connect"];
      const result = connect && typeof connect.connect === "function" ? await connect.connect() : null;
      const listed = result && Array.isArray(result.accounts) ? result.accounts : wallet.accounts;
      const accounts = Array.isArray(listed) ? listed : [];
      account = accounts.find((item) => Array.isArray(item.chains) && item.chains.some((chain) => String(chain).startsWith("solana:"))) || accounts[0] || null;
      if (!account || typeof account.address !== "string") throw new Error("The wallet did not share a public address.");
      return { publicKey: provider.publicKey };
    },
    async signMessage(message) {
      if (!account) await provider.connect();
      const outputs = await signMessageFeature.signMessage({ account, message });
      const signature = outputs && outputs[0] && outputs[0].signature;
      if (!(signature instanceof Uint8Array)) throw new Error("The wallet did not sign the login message.");
      return signature;
    },
  };
  return provider;
}

// Jupiter reads this object when the Honey Charts wallet pays for a swap.
// The approve functions are supplied by the embedded wallet. This file does
// not build a transaction and does not read a key.
export function jupiterWalletState({ publicKey, approveOne, approveMany, sendRaw }) {
  if (!publicKey || typeof approveOne !== "function" || typeof sendRaw !== "function") return null;
  return {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey,
    connected: true,
    connecting: false,
    disconnecting: false,
    select() {},
    async connect() {},
    async disconnect() {},
    sendTransaction: sendRaw,
    signTransaction: approveOne,
    signAllTransactions: typeof approveMany === "function" ? approveMany : async (txs) => {
      const signed = [];
      for (const tx of txs || []) signed.push(await approveOne(tx));
      return signed;
    },
  };
}

function rememberLoginWallet(wallet) {
  if (!wallet.features) return;
  const chains = Array.isArray(wallet.chains) ? wallet.chains : [];
  if (!chains.some((chain) => String(chain).startsWith("solana:"))) return;
  if (!wallet.features["solana:signIn"] && !wallet.features["solana:signMessage"]) return;
  const name = String(wallet.name || "");
  if (!name) return;
  if (loginStandardWallets.some((item) => item.name === name)) return;
  loginStandardWallets.push(wallet);
}
