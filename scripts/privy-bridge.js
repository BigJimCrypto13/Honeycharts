// Browser bridge for Privy's Solana embedded wallet.
// Built into vendor/privy-bridge.js. The page loads that file only after
// WALLET_ENABLED is on. This file never receives a key or a recovery phrase.

import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, useSubscribeToJwtAuthWithFlag } from "@privy-io/react-auth";
import { useAddFunds } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useExportWallet,
  useSignAndSendTransaction,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const session = {
  token: "",
  authed: false,
  rpcUrl: "https://solana-rpc.publicnode.com",
  wsUrl: "wss://solana-rpc.publicnode.com",
  appId: "",
  clientId: "",
  listeners: new Set(),
};

const api = {
  ready: false,
  wallet: null,
  error: "",
  send: null,
  signBytes: null,
  exportWallet: null,
  buyWithCard: null,
  waiters: [],
};

function notify() {
  for (const listener of session.listeners) listener();
}

function publish() {
  const pending = api.waiters.splice(0);
  for (const resolve of pending) resolve(api);
}

function pickWallet(wallets) {
  const list = Array.isArray(wallets) ? wallets : [];
  const embedded = list.find((wallet) => {
    const standard = wallet && wallet.standardWallet;
    return Boolean(standard && (standard.isPrivyWallet || /privy/i.test(String(standard.name || ""))));
  });
  return embedded || list[0] || null;
}

function Bridge() {
  const { wallets, ready } = useWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const { addFunds } = useAddFunds();
  const creating = useRef(false);

  useSubscribeToJwtAuthWithFlag({
    enabled: true,
    isAuthenticated: session.authed,
    isLoading: false,
    getExternalJwt: async () => {
      try {
        return session.token || undefined;
      } catch {
        return undefined;
      }
    },
    onError(error) {
      api.error = error && error.message ? String(error.message) : "The wallet could not link this sign-in.";
      publish();
    },
  });

  useEffect(() => {
    const onSession = () => {
      if (!session.authed) {
        api.wallet = null;
        api.error = "";
      }
    };
    session.listeners.add(onSession);
    return () => session.listeners.delete(onSession);
  }, []);

  useEffect(() => {
    api.ready = ready;
    const wallet = pickWallet(wallets);
    api.wallet = wallet;
    if (wallet) api.error = "";
    api.send = async (bytes, note) => {
      const current = api.wallet;
      if (!current) throw new Error("Your wallet is still opening.");
      const result = await signAndSendTransaction({
        transaction: bytes,
        wallet: current,
        chain: "solana:mainnet",
        options: {
          uiOptions: {
            showWalletUIs: true,
            description: note || "Approve this Solana transaction.",
          },
        },
      });
      return result && result.signature;
    };
    api.signBytes = async (bytes, note) => {
      const current = api.wallet;
      if (!current) throw new Error("Your wallet is still opening.");
      const result = await signTransaction({
        transaction: bytes,
        wallet: current,
        chain: "solana:mainnet",
        options: {
          uiOptions: {
            showWalletUIs: true,
            description: note || "Approve this swap.",
          },
        },
      });
      return result && result.signedTransaction;
    };
    api.exportWallet = async () => {
      const current = api.wallet;
      if (!current) throw new Error("Your wallet is still opening.");
      await exportWallet({ address: current.address });
    };
    api.buyWithCard = async (address) => {
      await addFunds({
        destination: {
          address,
          chain: "solana:mainnet",
          asset: "SOL",
        },
        fiat: {
          preferredPaymentMethod: "CREDIT_DEBIT_CARD",
          defaultAmount: "25",
        },
      });
    };
    publish();
    if (!ready || wallet || !session.authed || creating.current) return undefined;
    creating.current = true;
    createWallet()
      .catch((error) => {
        const text = error && error.message ? String(error.message) : "";
        if (!/already/i.test(text)) api.error = text || "The wallet could not be created.";
      })
      .finally(() => {
        creating.current = false;
        publish();
      });
    return undefined;
  }, [ready, wallets, createWallet, exportWallet, signAndSendTransaction, signTransaction, addFunds]);

  return null;
}

function mount(options) {
  session.appId = options.appId;
  session.clientId = options.clientId || "";
  session.rpcUrl = options.rpcUrl;
  session.wsUrl = options.wsUrl || session.wsUrl;
  const host = document.createElement("div");
  host.id = "honey-privy-root";
  host.hidden = true;
  document.body.append(host);
  const providerProps = {
    appId: session.appId,
    config: {
      appearance: {
        theme: "dark",
        accentColor: "#E89A00",
        walletChainType: "solana-only",
      },
      embeddedWallets: {
        showWalletUIs: true,
        ethereum: { createOnLogin: "off" },
        solana: { createOnLogin: "all-users" },
      },
      externalWallets: {
        disableAllExternalWallets: true,
        walletConnect: { enabled: false },
      },
      solana: {
        rpcs: {
          "solana:mainnet": {
            rpc: createSolanaRpc(session.rpcUrl),
            rpcSubscriptions: createSolanaRpcSubscriptions(session.wsUrl),
            blockExplorerUrl: "https://solscan.io",
          },
        },
      },
    },
  };
  if (session.clientId) providerProps.clientId = session.clientId;
  createRoot(host).render(
    React.createElement(PrivyProvider, providerProps, React.createElement(Bridge)),
  );
}

export function startHoneyPrivy(options) {
  if (!api.mounted) {
    api.mounted = true;
    mount(options);
  }
  return new Promise((resolve) => {
    if (api.ready) resolve(api);
    else api.waiters.push(resolve);
  });
}

export function setHoneySession(token) {
  session.token = typeof token === "string" ? token : "";
  session.authed = Boolean(session.token);
  notify();
}

export function honeyWalletApi() {
  return api;
}
