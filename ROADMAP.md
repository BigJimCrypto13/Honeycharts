# Roadmap

This is a static site on GitHub Pages. The notes below are the work that shipped and the work that should wait until it can be done without overselling it.

## Shipped

- On-site token view: paste a contract address, see a DexScreener chart plus Honeycharts' own header and stats.
- Hive watchlist in `localStorage`, with sort, notes, remove, JSON export/import, and a recently viewed list.
- Honey Score from the public RugCheck report and DexScreener pair data, with plain-language flags and a fixed "not financial advice, DYOR" line.
- Home lists for DexScreener boosts and latest Solana profiles. Boosts are labeled as paid promotion.
- Share links via `?ca=`, with older `#ca` links still recognized. Copy address, copy link, and an X intent link.
- Open Graph and Twitter card tags for the site. They describe Honeycharts, not each token. Per-token preview cards need a server.
- Content Security Policy, address checks, text rendering that does not use raw HTML, and strict Hive import checks.
- Jupiter swap on the token page, collapsed until you press Swap. It uses Jupiter's official plugin, prefilled SOL to the token on screen, with no referral fee. Honeycharts does not connect a wallet or sign anything. Connecting and approving stay inside Jupiter and the visitor's own wallet extension.

## Limits of this version

- The chart is still DexScreener's embed. If their embed or API is down, the page cannot invent a chart.
- RugCheck responses for large tokens can be a few megabytes, and their public API rate-limits. A failed report caps the Honey Score and marks it incomplete.
- LP lock detection only uses standard LP fields RugCheck returns. Concentrated-liquidity pools often have no LP token, so the panel says the lock status is unclear instead of inventing one.
- Holder percentages can include pools and exchanges. The copy says that.
- The Honey Score is a fixed heuristic. A high number is not a claim that a token is safe.
- Home "boosted" tokens paid DexScreener. Honeycharts does not rank them and is not paid for that list.
- The Hive disappears if the browser clears site data. Export is the backup.
- Open Graph tags cannot change per token on a purely static host.

## Next, when there is a real reason

These are not scheduled. Each one needs the dependency named here.

- **Price alerts.** Useful, and a reasonable paid feature later. A static page cannot notify anyone after the tab closes. This needs a small backend, a way to pay, and a clear limit on how alerts are delivered. Do not fake it with a browser-only timer.
- **Jupiter referral fee.** The swap is already on the token page and charges no fee. A referral account or platform fee stays off until a lawyer reviews the terms, the disclosure, and confirms the site would not be holding customer funds. The plugin config has a disabled placeholder for that and nothing else.
- **Sponsored spots.** Only as slots that are visibly marked sponsored, separate from DexScreener's own boost labels. Pricing and disclosure need a lawyer. Do not mix paid rows into the Honey Score.
- **Read-only public-address view.** A later option, not part of the scanner. If it is built, it may look up a public address the visitor types or pastes. It must not connect a wallet, request a signature, or ask for a seed phrase.
- **PWA.** A manifest and service worker so the shell opens offline. The Hive is already local. Live prices still need the network. Worth doing after the current pages stay stable.
- **Share cards and an X bot.** Image cards need something that can render per token, which GitHub Pages does not do. An X bot that posts charts is a separate account, with its own rate limits and ban risk. Treat both as growth experiments after the product is trustworthy, not as a launch tactic.

Any token, referral program, or paid placement only after a lawyer reviews it.
