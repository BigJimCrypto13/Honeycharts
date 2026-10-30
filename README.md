# Honeycharts

Honeycharts is a static Solana token scanner. Paste a contract address and the chart stays on this site, with price, liquidity, a plain-language Honey Score, and a watchlist saved only in your browser.

The live site is [bigjimcrypto13.github.io/Honeycharts](https://bigjimcrypto13.github.io/Honeycharts/).

## What you can do

- Paste a Solana contract address, or type a name or ticker such as `bonk` or `$WIF`. A short list of Solana matches appears under the header. Rows are sorted by liquidity times 24h volume, so a deep pool with almost no trading sinks below a market people are trading. Enter or the top row opens that token. A pasted address still opens that address directly. Jupiter can mark a row Verified or Strict list. The Honey Score on the token page is unchanged.
- Read price, 5m / 1h / 6h / 24h change, liquidity, FDV, market cap, 24h volume, buys and sells, pair age, and DEX from the deepest Solana pair.
- Save tokens in the Hive. The list lives in `localStorage` on this browser. You can sort it, add a short note, remove a token, and export or import a JSON backup.
- See tokens you opened under Recently viewed.
- Read a Honey Score from 0 to 100. It restates public RugCheck and DexScreener flags. It is not a safety rating and it is not financial advice.
- Browse Solana tokens from DexScreener's boosted list and latest profiles. Boosted rows are labeled as paid promotion.
- Share a token with `?ca=` (`?t=` is an alias, and older `#ca` links still open). Copy the address, copy the link, or open an X post draft.
- Buy or sell from the token page. On a wide screen the Jupiter form sits in a sticky column to the right of the chart, with Buy (SOL to the token) and Sell (token to SOL) tabs, then the pair stats. Buy has 0.1, 0.5, and 1 SOL shortcuts. Sell amount stays in Jupiter's form. On a phone, a Buy/Sell bar stays at the bottom and opens that same form as a sheet. Wallet connect and signing stay inside Jupiter. The form includes a 0.5% Honeycharts fee (`referralAccount` and `referralFee` of 50 bps). Under the chart, Trades, Holders, and Info tabs keep the pair counts, the RugCheck holder list, the Honey Score, and the Serial Rugger check.
- Launch a Pump.fun bonding-curve token from the Launch tab. It is mainnet only, tradable immediately, and asks for one signature after a confirmation checkbox. The review screen says `Includes 0.02 SOL Honeycharts launch fee`.

## Security promise

Honeycharts will never ask for your seed phrase or private key. Swaps are handled by Jupiter in your own wallet; always check the transaction before approving.

- The scanner and the Hive never connect a wallet. The Swap button only loads Jupiter's plugin. Connecting and approving stay inside that plugin and your wallet extension.
- The referral fee uses the public referral account in `js/config.js`. The launch fee uses the public address `7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6`. Do not commit a private key, seed phrase, or secret-key file. Image upload does not use an API key.
- The Launch tab talks to Phantom or Solflare only after you click Connect wallet to launch. Signing happens in that wallet. Honeycharts does not see wallet secrets. A one-time mint account signature is generated in the browser for that transaction and then discarded.
- The Hive is local. Nothing in the watchlist is uploaded by this site.
- Contract addresses must be base58 and 32–44 characters.
- Text from DexScreener and RugCheck is written as text, not HTML.
- External links must be `http` or `https`, and they open with `rel="noopener noreferrer"`.
- Imported Hive files are rejected unless they match the version 1 backup shape.
- A Content-Security-Policy meta tag limits scripts to this site and `plugin.jup.ag`. Network and frame access stay on DexScreener, RugCheck, Jupiter, PumpPortal, Pump.fun, Litterbox, and the Solana RPC hosts `api.mainnet-beta.solana.com`, `api.devnet.solana.com`, and `solana-rpc.publicnode.com`. The plugin fetches its font stylesheet from Google Fonts and injects its own style elements, so those are allowed too. Inline scripts and `eval` are not.
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

- `https://api.dexscreener.com/latest/dex/search?q=<name>` (header name and ticker search, Solana pairs only)
- `https://api.jup.ag/tokens/v2/search?query=<name>` (optional verified or strict-list marker, and a fallback when DexScreener has no Solana pair)
- `https://api.dexscreener.com/latest/dex/tokens/<CA>`
- `https://api.dexscreener.com/tokens/v1/solana/<addresses>` (up to 30 at a time)
- `https://api.dexscreener.com/token-boosts/top/v1`
- `https://api.dexscreener.com/token-profiles/latest/v1`
- `https://api.rugcheck.xyz/v1/tokens/<CA>/report`
- Read-only Solana JSON-RPC at `https://solana-rpc.publicnode.com` (`getSignaturesForAddress`, `getTransaction`). `api.mainnet-beta.solana.com` rejects browser origins, so deployer lookups use the public node. No API key. The calls do not sign or send transactions.
- Chart frame: `https://dexscreener.com/solana/<CA>?embed=1&theme=dark`
- Swap panel on each token page: `https://plugin.jup.ag/plugin-v1.js` (Jupiter then loads its own app bundle from that host)

The swap form is Jupiter's. Honeycharts does not build, sign, or send the transaction. Buy and Sell call `Jupiter.init` again with `initialInputMint` and `initialOutputMint` swapped. A buy shortcut sets `initialAmount` in lamports. If the plugin does not load, the panel links to `https://jup.ag/swap/SOL-<CA>`.

## Launch a token

`LAUNCH_ENABLED` is `false`, so the Launch nav item is hidden and `?view=launch` only says "Token launches are coming soon." The form and wallet code stay in the repo. Set the flag to `true` to show them again.

The Launch tab creates a Pump.fun bonding-curve token. Fill in the name, ticker, image, and description, confirm the mainnet spend, then sign once in Phantom or Solflare. The token is tradable on the bonding curve immediately. You do not create a liquidity pool or host the metadata yourself.

Pump.fun is mainnet only, so there is no devnet switch. Pump.fun sets the supply. An optional initial buy defaults to 0 SOL and is capped at 10 SOL.

Image and metadata upload does not need an API key. The page tries `https://pump.fun/api/ipfs` first. Pump.fun's own docs now say that endpoint is discontinued, and Cloudflare does not let a third-party site read a metadata link from it. When that happens, the image and the metadata JSON are uploaded to Litterbox, which keeps them for up to 72 hours. Paste your own https metadata link on the form if the image must last longer. No secret is stored in this repo.

The unsigned create transaction comes from `https://pumpportal.fun/api/trade-local`. Honeycharts never sends the mint secret to that API. The browser signs the new mint locally, then your wallet signs the fee payer. The Solana libraries are the vendored bundle in `vendor/solana-bundle.js` (`@solana/web3.js@1.98.4` and `@solana/spl-token@0.4.15`). See `vendor/VERSIONS.txt` for the pin.

`js/config.js` sets:

```js
export const LAUNCH_FEE_SOL = 0.02;
export const LAUNCH_FEE_WALLET = "7RCPmTbCbXM6MxUHy8fnriDVCZd9MfqY5X86FjU5gZc6";
```

That wallet is a public LLC address. The launch transaction includes a SOL transfer of 0.02 SOL to it. The confirmation screen says `Includes 0.02 SOL Honeycharts launch fee`. The amount is capped at 5 SOL in code.

Pump.fun pays ongoing creator rewards to the wallet that signs the launch, not to a platform fee address. Its create API has no partner account field, so this wallet is not a Pump.fun fee recipient. A share of trading fees would need a separate config account, such as a Meteora Dynamic Bonding Curve config whose `feeClaimer` is this same wallet. This launch does not create that account.

After launch, the page shows the mint, a Honeycharts chart link, Add to Hive, and a share-to-X draft.

`tests/devnet-launch.test.mjs` asks PumpPortal for an unsigned create transaction, appends the 0.02 SOL transfer, and checks that instruction. It does not send the transaction and does not spend SOL. Do not commit a wallet secret.

The header brand comes from `BRAND_NAME` in `js/config.js` and reads `Honey Charts™`. The footer comes from `COPYRIGHT_OWNER` and reads `© 2026 Honey Charts LLC. All rights reserved.`

## Deployer check

On a token page, Honey Charts shows the deployer wallet. It uses RugCheck's `creator` field when that value is a Solana address. If the field is empty, it walks the mint's signatures on the public RPC, up to three pages, and reads the first signer of the oldest transaction it actually reaches. If that transaction is not in those pages, the page says the deployer was not found.

Check a wallet (home, the Lookup nav item, or `?wallet=`) lists mints that address initialized. A mint counts when the wallet is the first signer on a transaction whose instructions include `initializeMint` or `initializeMint2`. The newest 160 transactions that mention the wallet are read. If the history is longer, the page says the scan is partial. Older launches are not counted as healthy or rugged. Pump.fun's website API is not used.

Each mint is then priced from DexScreener. A coin is a loss only when a figure exists:

- Price or market cap is down more than 90% from the start of a 5-minute, 1-hour, 6-hour, or 24-hour window DexScreener returned. A change of exactly -90% does not count. These windows are not an all-time peak.
- Liquidity is under $100 and a returned volume or trade count is above zero.
- The pair is older than 24 hours, every returned volume and trade count is zero, and liquidity is under $100 or the price is zero.
- RugCheck set `rugged: true` on a report that loaded. That flag is only applied to the token already open.

Missing prices, liquidity, and volume stay **not enough data**. They are not stored as zero and they are not losses. The ratio uses only coins that could be classified. Example: `4 of 5 coins from this wallet lost over 90%`. If some losses are liquidity or no-trading rather than a 90% drop, the line says `died or lost over 90%`. Unclassified coins are listed beside the ratio as `not enough data`.

Two or more counted losses show a red **Serial Rugger** badge with that sentence. The badge does not add a claim beyond the count. The list of mints is behind "Show the launches" on a token page and open on the wallet page.

The Honey Score drops after its other caps. The penalty is 12 points, plus 4 for each loss after the second, plus 10 times the share of classified coins that were losses, and it stops at 30. One loss, or a wallet with only `not enough data`, does not change the score.

Results are cached in `localStorage` under `honeycharts.creator.v1` (about six hours for a full scan, shorter when the RPC rate-limits or the history was cut off). Market rows refresh about every 30 minutes. A rate limit keeps the transactions already read and says so.

## Jupiter referral fee

`js/config.js` sets `JUPITER_REFERRAL_ACCOUNT` to `6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU` and `FEE_BPS` to `50` (0.5%). That account is the public Referral Key for Jupiter Ultra project `DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc`. The plugin receives it as `formProps.referralAccount` and `formProps.referralFee` (50 basis points, which Jupiter reports as `feeBps`). The swap panel says "Includes a 0.5% Honeycharts fee."

Jupiter keeps 20% of this integrator fee. Fees are only collected when the matching fee token account exists. On [referral.jup.ag](https://referral.jup.ag/), create referral token accounts for SOL and USDC. Jupiter chooses the fee mint. If that token account is missing, the swap still goes through and your fee is skipped.

Do not put a private key, a seed phrase, or `id.json` in this repo. An invalid account string is ignored and the swap runs with no Honeycharts fee.

Figures are cached in memory for a short time, and refresh buttons wait two seconds between forced reloads. RugCheck reports can be large and the API can rate-limit. If that call fails, the Honey Score stays incomplete and says so.

## Old prototype

`honey-meme-scanner.html` is an earlier single-file page. The current app is `index.html`.

## Next

See [ROADMAP.md](ROADMAP.md). Anything that takes a fee, issues a token, or sells a placement needs a lawyer before it is built.
