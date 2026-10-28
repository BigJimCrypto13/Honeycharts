# Honeycharts

Honeycharts is a static Solana token scanner. Paste a contract address and the chart stays on this site, with price, liquidity, a plain-language Honey Score, and a watchlist saved only in your browser.

The live site is [bigjimcrypto13.github.io/Honeycharts](https://bigjimcrypto13.github.io/Honeycharts/).

## What you can do

- Paste a Solana contract address and open a chart without leaving Honeycharts. The chart is a DexScreener embed. The header, stats, and score are Honeycharts.
- Read price, 5m / 1h / 6h / 24h change, liquidity, FDV, market cap, 24h volume, buys and sells, pair age, and DEX from the deepest Solana pair.
- Save tokens in the Hive. The list lives in `localStorage` on this browser. You can sort it, add a short note, remove a token, and export or import a JSON backup.
- See tokens you opened under Recently viewed.
- Read a Honey Score from 0 to 100. It restates public RugCheck and DexScreener flags. It is not a safety rating and it is not financial advice.
- Browse Solana tokens from DexScreener's boosted list and latest profiles. Boosted rows are labeled as paid promotion.
- Share a token with `?ca=` (older `#ca` links still open). Copy the address, copy the link, or open an X post draft.
- Open a Jupiter swap for the token you are viewing. It stays collapsed until you press Swap. The form is Jupiter's official plugin, prefilled from SOL into that token, with a 0.5% Honeycharts fee (`referralAccount` and `referralFee` of 50 bps).
- Launch a standard SPL token from the Launch tab. It defaults to Devnet. Mainnet asks for an extra confirmation. Mint and freeze authority are revoked unless you uncheck them. No liquidity pool is created.

## Security promise

Honeycharts will never ask for your seed phrase or private key. Swaps are handled by Jupiter in your own wallet; always check the transaction before approving.

- Honeycharts never connects a wallet, reads a public key, or asks you to sign. The Swap button only loads Jupiter's plugin. Connecting and approving stay inside that plugin and your wallet extension.
- The referral fee uses the public referral account in `js/config.js`. The launch fee wallet is still empty. Do not commit a private key, seed phrase, or secret-key file.
- The Launch tab talks to Phantom or Solflare only after you click Connect wallet to launch. Signing happens in that wallet. Honeycharts does not see wallet secrets. A one-time mint account signature is generated in the browser for that transaction and then discarded.
- The Hive is local. Nothing in the watchlist is uploaded by this site.
- Contract addresses must be base58 and 32–44 characters.
- Text from DexScreener and RugCheck is written as text, not HTML.
- External links must be `http` or `https`, and they open with `rel="noopener noreferrer"`.
- Imported Hive files are rejected unless they match the version 1 backup shape.
- A Content-Security-Policy meta tag limits scripts to this site and `plugin.jup.ag`. Network and frame access stay on DexScreener, RugCheck, Jupiter, and the Solana RPC hosts `api.mainnet-beta.solana.com` and `api.devnet.solana.com`. The plugin fetches its font stylesheet from Google Fonts and injects its own style elements, so those are allowed too. Inline scripts and `eval` are not.
- There are no third-party trackers.

## Run it locally

The site is plain HTML, CSS, and JavaScript. There is no build step. Modules and the APIs will not work if you open the file directly.

```bash
python3 -m http.server 8765
```

Then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

GitHub Pages serves this repository as a project site. Asset paths are relative, so the same files work at the repo root locally and under `/Honeycharts/` on GitHub Pages.

Checks that do not need a browser:

```bash
node --test
```

## Data the page calls

- `https://api.dexscreener.com/latest/dex/tokens/<CA>`
- `https://api.dexscreener.com/tokens/v1/solana/<addresses>` (up to 30 at a time)
- `https://api.dexscreener.com/token-boosts/top/v1`
- `https://api.dexscreener.com/token-profiles/latest/v1`
- `https://api.rugcheck.xyz/v1/tokens/<CA>/report`
- Chart frame: `https://dexscreener.com/solana/<CA>?embed=1&theme=dark`
- Swap panel, only after you press Swap: `https://plugin.jup.ag/plugin-v1.js` (Jupiter then loads its own app bundle from that host)

The swap form is Jupiter's. Honeycharts does not build, sign, or send the transaction. If the plugin does not load, the panel links to `https://jup.ag/swap/SOL-<CA>`.

## Launch a token

The Launch tab creates a standard SPL token (the original Token Program, not Token-2022) and a Metaplex metadata account. The libraries are the vendored bundle in `vendor/solana-bundle.js` (`@solana/web3.js@1.98.4` and `@solana/spl-token@0.4.15`). See `vendor/VERSIONS.txt` for the pin.

This site cannot host images or JSON. Download `metadata.json` (and the image file, if you chose one), put them on any host you control, then paste the https link to `metadata.json`. That link has to be 200 characters or fewer because that is what the metadata program stores. No API key is required.

The form defaults to Devnet (test). Mainnet spends real SOL and requires the extra confirmation checkbox. Revoke mint authority and revoke freeze authority start checked. Leaving them checked means the creator cannot mint more tokens or freeze holders, which is what the Honey Score looks for. Uncheck them only if you mean to keep those powers.

No pool is created. After launch, the page links to the Honeycharts chart and to Raydium and Meteora for liquidity.

`LAUNCH_FEE_SOL` defaults to `0` and `LAUNCH_FEE_WALLET` is empty, so no fee is added. To charge one, set both in `js/config.js`. The wallet value must be a public address. The amount is capped at 5 SOL. The review screen lists the transfer before anyone signs.

```js
export const LAUNCH_FEE_SOL = 0.05;
export const LAUNCH_FEE_WALLET = "YourPublicFeeAddress";
```

A harness in `tests/devnet-launch.test.mjs` creates a token with a keypair that exists only in that process. The public devnet faucet currently returns HTTP 410, so that test skips unless `SOLANA_RPC` points at a validator that can fund the wallet. It was run against a local validator with the devnet Metaplex metadata program cloned in. Do not commit a wallet secret.

## Jupiter referral fee

`js/config.js` sets `JUPITER_REFERRAL_ACCOUNT` to `6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU` and `FEE_BPS` to `50` (0.5%). That account is the public Referral Key for Jupiter Ultra project `DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc`. The plugin receives it as `formProps.referralAccount` and `formProps.referralFee` (50 basis points, which Jupiter reports as `feeBps`). The swap panel says "Includes a 0.5% Honeycharts fee."

Jupiter keeps 20% of this integrator fee. Fees are only collected when the matching fee token account exists. On [referral.jup.ag](https://referral.jup.ag/), create referral token accounts for SOL and USDC. Jupiter chooses the fee mint. If that token account is missing, the swap still goes through and your fee is skipped.

Do not put a private key, a seed phrase, or `id.json` in this repo. An invalid account string is ignored and the swap runs with no Honeycharts fee.

Figures are cached in memory for a short time, and refresh buttons wait two seconds between forced reloads. RugCheck reports can be large and the API can rate-limit. If that call fails, the Honey Score stays incomplete and says so.

## Old prototype

`honey-meme-scanner.html` is an earlier single-file page. The current app is `index.html`.

## Next

See [ROADMAP.md](ROADMAP.md). Anything that takes a fee, issues a token, or sells a placement needs a lawyer before it is built.
