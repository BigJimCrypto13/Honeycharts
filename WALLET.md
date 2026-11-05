# Wallet setup for James

Honey Charts can give every account a Solana wallet, like a small Phantom inside the site. The wallet is off until you paste two public ids. You do not create a secret for this repo, and you do not paste a private key, a seed phrase, or a Supabase service role key anywhere in the code.

The provider is **Privy** (Horkos, Inc.). Privy holds the key in pieces inside secure hardware (a trusted execution environment). Honey Charts never sees the key. The visitor approves each send in Privy's own window. They can export the wallet from that same window, so they are not locked in.

Checked against Privy's site on 5 November 2026:

- Docs: https://docs.privy.io/recipes/authentication/using-supabase-for-custom-auth
- Vanilla SDK (we do not ship this one; the confirm window lives in the React SDK, which this repo bundles): https://docs.privy.io/recipes/core-js
- Pricing: https://www.privy.io/pricing
- Export: https://docs.privy.io/wallets/wallets/export
- Allowed origins: https://docs.privy.io/recipes/dashboard/allowed-domains
- JWT setup: https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup

## What is free

On the **Developer** plan, from https://www.privy.io/pricing:

- **0–499 monthly active users: $0.** A monthly active user is a Privy-signed-in person with a session in the last 30 days.
- **50,000 signatures a month and $1,000,000 of transaction volume: $0.** A signature is any embedded-wallet sign or send (including `signTransaction` and `signAndSendTransaction`).
- The next self-serve step on that page is **Core: 500–2,499 MAU at $299 per month**, then **Scale: 2,500–9,999 MAU at $499 per month**.
- If a month goes past **10,000 MAU or 50,000 signatures**, the same page says pay-as-you-go starts: a **$2,000** base, **$0.05** per MAU above 10,000, and **$0.01** per signature above 50,000.

You do not enter a card to create the app. You will need one only if you outgrow the free band.

## Why not the others

- **Phantom Connect** has a vanilla JavaScript SDK and is free, but the docs say the Phantom Portal is not taking new apps: https://docs.phantom.com/recipes/quickstarts/vanilla-js
- **Dynamic** has a JavaScript SDK. Live mode starts at **$249 per month**. The sandbox is free for building only. https://www.dynamic.xyz/pricing
- **Turnkey** includes **25 free signatures a month**, then **$0.10** each. That is too small for a public launch. https://www.turnkey.com/pricing
- **MetaMask Embedded Wallets (Web3Auth)** includes **1,000 free monthly active wallets**, but third-party JWT login (the link to Supabase) is on the **Growth** plan at **$69 per month**. https://www.web3auth.io/pricing.html and https://docs.metamask.io/embedded-wallets/sdk/js/advanced/custom-authentication/
- **Para** is free up to **1,200 MAU** (https://www.getpara.com/pricing). Privy is the one with a written Supabase recipe and a confirm window we can ship from a static page without a server secret.

## What you click

Do these in order. The live site is https://bigjimcrypto13.github.io/Honeycharts/

### 1. Create the Privy app

1. Open https://dashboard.privy.io/ and sign up.
2. Create an app. Name it **Honey Charts**.
3. When it asks for a chain, choose **Solana**.
4. Open **Configuration → App settings → Domains**.
5. Under allowed origins, add each of these on its own. No path, no trailing slash:

   - `https://bigjimcrypto13.github.io`
   - `http://127.0.0.1:8765`
   - `http://localhost:8765`

   The local ones are only for trying the site on your computer. Remove them later if you want the live app id locked to GitHub Pages.

6. Copy the **App ID**. It is public. It is not a secret.
7. If you see **Clients** (Configuration → App settings → Clients), add a web client, allow the same origins, and copy the **Client ID**. That id is public too. If the page does not ask for a client, leave the client id blank in the repo.

Do **not** copy the app secret. This site never uses it. Leave it in the Privy dashboard.

### 2. Let Privy trust Supabase sign-in

People already sign in with email or Solana on Honey Charts. Privy should use that same sign-in, not ask for a second password.

1. In Supabase, open the project https://supabase.com/dashboard/project/hqqmarbovsgvyfjzxqjj
2. Find **JWT signing keys** (Project Settings → JWT Keys, or Authentication, depending on the sidebar).
3. This project's public key list already answers at `https://hqqmarbovsgvyfjzxqjj.supabase.co/auth/v1/.well-known/jwks.json` and it includes an **ES256** key. That is the right kind of key. Privy can check it without a secret.
4. On that page, the key marked **in use** must be the asymmetric key (ES256 or RS256), not the old shared JWT secret. If the legacy secret is still the one in use, click **Migrate JWT secret** if you see it, then **Rotate keys**. Do not copy the JWT secret into Privy or into this repo. Rotating does not sign people out of existing sessions immediately. Supabase's own note is here: https://supabase.com/docs/guides/auth/signing-keys
5. In Privy, open **User management → Authentication → JWT integration** (the docs also call this JWT-based auth). If you only see **Request access** under **Integrations → Built-in**, click that first and wait until Privy turns custom authentication on. There is no secret to paste while you wait.
6. Choose **client-side** (the browser talks to Privy). Do not choose server-side only. This site has no server.
7. Verification: **JWKS endpoint**. Paste exactly:

   `https://hqqmarbovsgvyfjzxqjj.supabase.co/auth/v1/.well-known/jwks.json`

8. JWT ID claim: `sub`
9. Save.

Privy reads the public key from that address. You never paste the Supabase JWT secret.

### 3. Solana wallet, confirm window, and card buying

1. In Privy, set embedded wallets to **Solana**.
2. Turn **wallet confirmation modals** on. In the dashboard that switch is under Configuration → Authentication → Advanced, labeled so that confirmation modals are **not** disabled. The site also asks for the confirm window on every send. Leave it on. That window is how the visitor approves a transaction. Honey Charts cannot skip it.
3. Card buying is optional. Privy's funding screen can offer a card or Apple Pay through **MoonPay** or **Stripe**. Those companies show their own fee before anyone pays. Honey Charts does not add a fee on top. Enabling it is a toggle in the Privy dashboard (**Funding** / card onramps). If Privy asks for a MoonPay or Coinbase secret, that secret stays in the Privy dashboard. Do not put it in this repo. If you skip the toggle, **Buy with card** tells the visitor to send SOL or USDC instead, which already works.
4. Do not turn on delegated signers or server wallets. The visitor must approve each transaction.

### 4. Paste the public ids and ship

1. In this repo, open `js/auth-config.js`.
2. Set `WALLET_ENABLED` to `true`.
3. Paste the App ID into `PRIVY_APP_ID`.
4. Paste the Client ID into `PRIVY_CLIENT_ID`, or leave it `""` if Privy did not give you one.
5. Leave `HELIUS_API_KEY` empty unless you want a different Solana reader. See below.
6. Deploy the site the way you already do (push to the GitHub Pages branch).

Until step 4, the Wallet page says **Wallet coming online**. Deposit still shows that message. Nothing asks for a key.

## What a visitor can do after this

- Join the hive the same way as today (email, password, and the 6-digit code, or Sign in with Solana). The Solana address is created with the account. There is no seed-phrase screen.
- **Deposit** in the header or on the wallet page shows a QR code, a Copy button, Share on a phone, and the line **Send SOL or USDC on the Solana network**. Tabs walk through Robinhood, Coinbase, Phantom, and any other wallet.
- The page watches the address. When coins arrive it says **Deposit received** and shows the new balance.
- Holdings show SOL, USDC, and other Solana tokens, with a dollar estimate and a picture when a public market has one.
- Buy and Sell on a token page use this wallet. Jupiter still builds the swap and still charges the 0.5% fee to `6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU`. The visitor approves in Privy. If SOL is too low, the button says **Add funds**.
- **Use Phantom, Solflare, or Backpack instead** leaves Jupiter's own connect button in place.
- **Withdraw** takes an address (paste or scan), an amount, Max, a fee estimate, and a confirm screen, then Privy's window.
- **Hive** on the wallet page is where they park coins. **Take offline** sends parked coins to a hardware-wallet address they saved on this browser. To trade again they send those coins back to the Honey Charts address, on Solana.
- **Export wallet** opens Privy's export. Honey Charts never reads it.

The cold-wallet address is saved in this browser only (`localStorage`). It is a public address, not a key. No Supabase table stores a key.

## Optional Helius key

Balances and the deposit watch use `https://solana-rpc.publicnode.com` from `js/config.js`. That address needs no key. If it rate-limits, you can create a free Helius key and paste it into `HELIUS_API_KEY` in `js/auth-config.js`.

That key is public. Anyone can read it from the site and use your free quota. It is not a secret, and it cannot move coins. Do not paste a key you cannot rotate. The content security policy already allows `https://mainnet.helius-rpc.com`.

## If something does not open

- **Wallet coming online** means `WALLET_ENABLED` is still false or the app id is empty.
- **Could not link this sign-in** means Privy rejected the Supabase token. Check the JWKS url, the claim `sub`, client-side JWT access, and that the in-use Supabase key is ES256 or RS256.
- **invalid_origin** means the site origin is missing from Privy's allowed origins. GitHub Pages origin is `https://bigjimcrypto13.github.io` with no path.
- A blank Privy window after a send usually means the confirm switch was turned off, or the browser blocked `https://auth.privy.io`. The content security policy in `index.html` already allows that host.

The bundled file is `vendor/privy-bridge.js`. The page loads it only after the wallet is switched on. Rebuild it with `npm install` and `npm run build:wallet` if you bump the Privy version. GitHub Pages does not run that command.
