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
- Open a Jupiter swap for the token you are viewing. It stays collapsed until you press Swap. The form is Jupiter's official plugin, prefilled from SOL into that token. There is no referral fee.

## Security promise

Honeycharts will never ask for your seed phrase or private key. Swaps are handled by Jupiter in your own wallet; always check the transaction before approving.

- Honeycharts never connects a wallet, reads a public key, or asks you to sign. The Swap button only loads Jupiter's plugin. Connecting and approving stay inside that plugin and your wallet extension.
- No referral fee or platform fee is configured. Adding one later requires a lawyer's review first.
- The Hive is local. Nothing in the watchlist is uploaded by this site.
- Contract addresses must be base58 and 32–44 characters.
- Text from DexScreener and RugCheck is written as text, not HTML.
- External links must be `http` or `https`, and they open with `rel="noopener noreferrer"`.
- Imported Hive files are rejected unless they match the version 1 backup shape.
- A Content-Security-Policy meta tag limits scripts to this site and `plugin.jup.ag`. Network and frame access stay on DexScreener, RugCheck, Jupiter, and `api.mainnet-beta.solana.com`. The plugin fetches its font stylesheet from Google Fonts and injects its own style elements, so those are allowed too. Inline scripts and `eval` are not.
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

Figures are cached in memory for a short time, and refresh buttons wait two seconds between forced reloads. RugCheck reports can be large and the API can rate-limit. If that call fails, the Honey Score stays incomplete and says so.

## Old prototype

`honey-meme-scanner.html` is an earlier single-file page. The current app is `index.html`.

## Next

See [ROADMAP.md](ROADMAP.md). Anything that takes a fee, issues a token, or sells a placement needs a lawyer before it is built.
