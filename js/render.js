import { el, clear, externalLink } from "./dom.js";
import { markerLabel } from "./search.js";
import { safeImageUrl, safeHttpUrl, safeLinkLabel, clipText, isValidCA } from "./sanitize.js";
import {
  formatCompactUsd,
  formatPrice,
  formatPct,
  formatCount,
  formatAge,
  formatAgo,
  shortCa,
  dexLabel,
  pctClass,
  asFinite,
} from "./format.js";
import { bandKey, meterStep } from "./score.js";
import { jupiterSwapUrl } from "./swap.js";
import { feeDisclosure } from "./config.js";

const LEVEL_LABEL = { danger: "Risk", warn: "Watch", info: "Note" };

export function renderSearchResults(root, model) {
  clear(root);
  const open = Boolean(model && model.open);
  if (!open) {
    root.setAttribute("hidden", "");
    return;
  }
  root.removeAttribute("hidden");
  if (model.status) {
    root.append(el("p", { className: "search-status muted", text: model.status }));
  }
  const results = Array.isArray(model.results) ? model.results : [];
  results.forEach((row, index) => {
    const active = index === model.active;
    const button = el("button", {
      className: active ? "search-hit is-active" : "search-hit",
      attrs: {
        type: "button",
        role: "option",
        id: `search-opt-${index}`,
        "aria-selected": active ? "true" : "false",
      },
      on: { click: () => model.onPick(row.ca) },
    });
    button.append(tokenAvatar(row.image, row.symbol || row.name));
    const copy = el("span", { className: "search-copy" });
    const title = el("span", { className: "search-title" });
    title.append(el("span", { className: "search-name", text: row.name || row.symbol || "Unknown token" }));
    title.append(el("span", { className: "symbol", text: row.symbol || shortCa(row.ca) }));
    const mark = markerLabel(row);
    if (mark) {
      title.append(el("span", { className: "search-mark", text: mark }));
    }
    title.append(el("span", { className: "search-price", text: formatPrice(row.priceUsd) }));
    copy.append(title);
    const meta = searchMeta(row);
    if (meta) copy.append(el("span", { className: "search-meta", text: meta }));
    button.append(copy);
    root.append(button);
  });
  if (results.length) {
    root.append(el("p", {
      className: "fine search-note",
      text: "Sorted by liquidity times 24h volume. The Honey Score is on the token page.",
    }));
  }
}

function searchMeta(row) {
  const parts = [];
  if (row.marketCap != null) parts.push(`MCap ${formatCompactUsd(row.marketCap)}`);
  else if (row.liquidityUsd != null) parts.push(`Liq ${formatCompactUsd(row.liquidityUsd)}`);
  if (row.volumeH24 != null) parts.push(`Vol ${formatCompactUsd(row.volumeH24)}`);
  return parts.join(" · ");
}

export function renderHome(root, model, actions) {
  clear(root);
  const page = el("div", { className: "stack" });
  page.append(el("section", { className: "hero" }, [
    el("h1", { text: "Chart a Solana token without leaving the hive" }),
    el("p", {
      text: "Paste a contract address. The chart stays on Honeycharts, with price, liquidity, and a plain-language Honey Score.",
    }),
    el("div", { className: "hero-actions" }, [
      el("a", { className: "button", attrs: { href: model.exampleHref }, text: "Try BONK" }),
      el("button", {
        className: "ghost",
        text: "Refresh lists",
        attrs: { type: "button" },
        on: { click: () => actions.refreshHome() },
      }),
    ]),
  ]));

  if (!model.persistent) {
    page.append(el("p", {
      className: "banner",
      text: "This browser is not saving the Hive. It will clear when you reload.",
    }));
  }
  if (model.error) page.append(el("p", { className: "banner", text: model.error }));
  if (model.recent.length) {
    page.append(renderRecent("home", model.recent, model.stats, model.tokenHref, actions));
  }
  page.append(renderFeed(
    "Boosted on DexScreener",
    "Paid DexScreener promotions. Not a Honeycharts ranking, and not an endorsement.",
    model.boosts,
    model.stats,
    model.tokenHref,
    model.loading,
  ));
  page.append(renderFeed(
    "Latest profiles",
    "Recently updated DexScreener profiles on Solana. A profile is not a review.",
    model.profiles,
    model.stats,
    model.tokenHref,
    model.loading,
  ));
  root.append(page);
}

export function renderToken(root, model, actions) {
  clear(root);
  const article = el("article", { className: "token-layout" });
  article.append(renderTokenHead(model, actions));
  article.append(renderChart(model.ca));
  article.append(renderStats(model));
  article.append(renderSwap(model.ca, actions));
  article.append(renderScore(model));
  root.append(article);
}

export function patchTokenMarket(root, model, actions) {
  const head = root.querySelector("[data-region='head']");
  const stats = root.querySelector("[data-region='stats']");
  if (!head || !stats) {
    renderToken(root, model, actions);
    return;
  }
  head.replaceWith(renderTokenHead(model, actions));
  stats.replaceWith(renderStats(model));
}

export function patchTokenScore(root, model) {
  const score = root.querySelector("[data-region='score']");
  if (!score) return;
  score.replaceWith(renderScore(model));
}

export function setHivePressed(root, inHive) {
  const button = root.querySelector("[data-action='hive-toggle']");
  if (!button) return;
  button.setAttribute("aria-pressed", inHive ? "true" : "false");
  button.textContent = inHive ? "In Hive" : "Add to Hive";
}

export function renderHive(root, model, actions) {
  clear(root);
  const page = el("div", { className: "stack" });
  page.append(el("section", { className: "section-head" }, [
    el("div", {}, [
      el("h1", { text: "Hive" }),
      el("p", {
        className: "muted",
        text: "A watchlist saved in this browser only. It is not uploaded, and it is not a portfolio.",
      }),
    ]),
  ]));

  if (!model.persistent) {
    page.append(el("p", {
      className: "banner",
      text: "This browser is not saving the Hive. It will clear when you reload.",
    }));
  }

  page.append(renderHiveTools(model, actions));

  if (!model.tokens.length) {
    page.append(el("section", { className: "empty panel" }, [
      el("h2", { text: "Your Hive is empty" }),
      el("p", {
        text: "Open a token and use Add to Hive. The list stays on this device. Export a JSON backup if you want to move it to another browser.",
      }),
      el("p", {}, [
        el("a", { className: "button", attrs: { href: model.homeHref }, text: "Browse tokens" }),
      ]),
    ]));
  } else {
    page.append(renderHiveTable(model, actions));
  }

  page.append(renderRecent("hive", model.recent, model.stats, model.tokenHref, actions));
  root.append(page);
  if (model.restoreSortFocus) {
    const button = root.querySelector(`[data-sort='${model.sort.key}']`);
    if (button) button.focus();
  }
}

export function updateQuotedStats(root, stats) {
  root.querySelectorAll("[data-ca]").forEach((node) => {
    const ca = node.getAttribute("data-ca");
    if (!isValidCA(ca)) return;
    const entry = stats.get(ca);
    const price = node.querySelector("[data-stat='price']");
    if (price) price.textContent = priceText(entry);
    const changeNode = node.querySelector("[data-stat='change']");
    if (changeNode) {
      const change = changeValue(entry);
      changeNode.textContent = entry ? formatPct(change) : "…";
      changeNode.classList.remove("up", "down", "flat");
      changeNode.classList.add(pctClass(change));
    }
    const liq = node.querySelector("[data-stat='liq']");
    if (liq) liq.textContent = entry ? money(entry, "liquidity") : "…";
    const mcap = node.querySelector("[data-stat='mcap']");
    if (mcap) mcap.textContent = mcapText(entry);
  });
}

function renderFeed(title, subtitle, feed, stats, tokenHref, loading) {
  const section = el("section", { className: "stack" });
  section.append(el("div", { className: "section-head" }, [
    el("h2", { text: title }),
    el("p", { className: "muted", text: subtitle }),
  ]));
  if (feed.error) section.append(el("p", { className: "banner", text: feed.error }));
  if (feed.error && !feed.items.length) return section;
  if (!feed.items.length && loading) {
    section.append(el("p", { className: "muted", text: "Loading this list…" }));
    return section;
  }
  if (!feed.items.length) {
    section.append(el("p", { className: "muted", text: "DexScreener returned no Solana tokens for this list." }));
    return section;
  }
  const grid = el("div", { className: "cards" });
  for (const item of feed.items) grid.append(tokenCard(item, stats.get(item.ca), tokenHref));
  section.append(grid);
  if (feed.total > feed.items.length) {
    section.append(el("p", {
      className: "fine",
      text: `Showing ${feed.items.length} of ${feed.total} Solana tokens from this DexScreener feed.`,
    }));
  }
  return section;
}

function tokenCard(item, entry, tokenHref) {
  const pair = entry && entry.pair;
  const symbol = pairSymbol(pair, null);
  const name = pairName(pair, null);
  const link = el("a", {
    className: "token-card",
    attrs: { href: tokenHref(item.ca), "data-ca": item.ca },
  });
  link.append(tokenAvatar(imageFrom(pair) || item.icon, symbol || item.ca));
  const body = el("span", { className: "card-body" });
  body.append(el("span", { className: "card-title" }, [
    el("span", { className: "name", text: name || symbol || "Unknown token" }),
    el("span", {
      className: item.boosted ? "badge badge-paid" : "badge",
      text: item.boosted ? "Boosted · paid" : "Profile",
    }),
  ]));
  body.append(el("span", { className: "symbol", text: symbol || shortCa(item.ca) }));
  body.append(el("span", {
    className: "card-price",
    attrs: { "data-stat": "price" },
    text: priceText(entry),
  }));
  const change = changeValue(entry);
  body.append(el("span", {
    className: `stat-change ${pctClass(change)}`,
    attrs: { "data-stat": "change" },
    text: entry ? formatPct(change) : "…",
  }));
  body.append(el("span", { className: "card-meta" }, [
    "Liq ",
    el("span", { attrs: { "data-stat": "liq" }, text: entry ? money(entry, "liquidity") : "…" }),
    " · MCap ",
    el("span", { attrs: { "data-stat": "mcap" }, text: mcapText(entry) }),
  ]));
  if (item.boosted && item.amount != null) {
    body.append(el("span", { className: "fine", text: `DexScreener boost total: ${formatCount(item.amount)}` }));
  }
  if (item.description) body.append(el("span", { className: "fine", text: item.description }));
  link.append(body);
  return link;
}

function renderTokenHead(model, actions) {
  const { ca, pair, inHive } = model;
  const symbol = pairSymbol(pair, model.fallback) || "Token";
  const name = pairName(pair, model.fallback);
  const head = el("section", { className: "panel token-head", attrs: { "data-region": "head" } });
  const top = el("div", { className: "token-top" });
  top.append(tokenAvatar(imageFrom(pair), symbol));
  const titles = el("div", { className: "token-titles" }, [
    el("h1", { className: "name", text: name || (model.dexStatus === "loading" ? "Loading token" : "Unknown token") }),
    el("p", { className: "symbol", text: symbol === "Token" ? shortCa(ca) : symbol }),
  ]);
  top.append(titles);
  top.append(el("button", {
    className: inHive ? "ghost hive-on" : "ghost",
    text: inHive ? "In Hive" : "Add to Hive",
    attrs: {
      type: "button",
      "data-action": "hive-toggle",
      "aria-pressed": inHive ? "true" : "false",
    },
    on: { click: () => actions.toggleHive() },
  }));
  head.append(top);

  const price = asFinite(pair && pair.priceUsd);
  head.append(el("p", { className: "price", text: pair ? formatPrice(price) : (model.dexStatus === "loading" ? "…" : "Price unavailable") }));
  head.append(renderChanges(pair));

  const caRow = el("div", { className: "ca-row" }, [
    el("code", { className: "ca", attrs: { translate: "no" }, text: ca }),
  ]);
  caRow.append(el("button", {
    className: "ghost",
    text: "Copy CA",
    attrs: { type: "button" },
    on: { click: () => actions.copyCa() },
  }));
  caRow.append(el("button", {
    className: "ghost",
    text: "Copy link",
    attrs: { type: "button" },
    on: { click: () => actions.copyLink() },
  }));
  const share = safeHttpUrl(model.shareHref);
  if (share) {
    caRow.append(externalLink(share, "Share on X", "ghost share-link"));
  }
  caRow.append(el("button", {
    className: "ghost",
    text: "Refresh figures",
    attrs: { type: "button" },
    on: { click: () => actions.refreshToken() },
  }));
  head.append(caRow);

  if (model.dexMessage) head.append(el("p", { className: "banner", text: model.dexMessage }));

  const explorers = el("ul", { className: "link-row" });
  for (const [label, href] of explorerLinks(ca)) {
    const item = el("li");
    item.append(externalLink(href, label, "text-link"));
    explorers.append(item);
  }
  head.append(el("div", {}, [
    el("p", { className: "fine", text: "Outside links, if you want them." }),
    explorers,
  ]));

  const listed = listedLinks(pair);
  if (listed.length) {
    const list = el("ul", { className: "link-row" });
    for (const link of listed) {
      const item = el("li");
      item.append(externalLink(link.href, link.label, "text-link"));
      list.append(item);
    }
    head.append(el("div", {}, [
      el("p", { className: "fine", text: "Links listed by DexScreener. The hostname is shown so you can check it. Honeycharts does not verify them." }),
      list,
    ]));
  }
  return head;
}

function renderChanges(pair) {
  const list = el("ul", { className: "changes", attrs: { "aria-label": "Price changes" } });
  const windows = [["5m", "m5"], ["1h", "h1"], ["6h", "h6"], ["24h", "h24"]];
  for (const [label, key] of windows) {
    const value = asFinite(pair && pair.priceChange && pair.priceChange[key]);
    const item = el("li", {}, [
      el("span", { text: label }),
      el("strong", { className: pctClass(value), text: formatPct(value) }),
    ]);
    list.append(item);
  }
  return list;
}

function renderStats(model) {
  const section = el("section", {
    className: "panel token-stats",
    attrs: { "data-region": "stats", "aria-labelledby": "stats-heading" },
  });
  section.append(el("h2", { attrs: { id: "stats-heading" }, text: "Market" }));
  const pair = model.pair;
  if (model.dexStatus === "loading" && !pair) {
    section.append(el("p", { className: "muted", text: "Loading market data…" }));
    return section;
  }
  if (!pair) {
    section.append(el("p", {
      text: model.dexMessage || "DexScreener has no Solana pair where this address is the base token.",
    }));
    return section;
  }
  const base = pairSymbol(pair, null) || "Token";
  const quote = clipText(pair.quoteToken && pair.quoteToken.symbol, 16) || "quote";
  section.append(el("p", {
    className: "fine",
    text: `Figures are from the deepest Solana pair: ${base} / ${quote} on ${dexLabel(pair.dexId)}. The chart is DexScreener's token view.`,
  }));
  const tx = pair.txns && pair.txns.h24;
  const buys = asFinite(tx && tx.buys);
  const sells = asFinite(tx && tx.sells);
  const trades = buys == null && sells == null
    ? "—"
    : `${formatCount(buys == null ? NaN : buys)} buys · ${formatCount(sells == null ? NaN : sells)} sells`;
  const created = asFinite(pair.pairCreatedAt);
  const age = created == null ? null : Date.now() - created;
  const list = el("dl", { className: "stats" });
  list.append(stat("Liquidity", formatCompactUsd(asFinite(pair.liquidity && pair.liquidity.usd))));
  list.append(stat("FDV", formatCompactUsd(asFinite(pair.fdv))));
  list.append(stat("Market cap", formatCompactUsd(asFinite(pair.marketCap))));
  list.append(stat("24h volume", formatCompactUsd(asFinite(pair.volume && pair.volume.h24))));
  list.append(stat("24h trades", trades));
  list.append(stat("Pair age", formatAge(age != null && age < 0 ? null : age)));
  list.append(stat("DEX", dexLabel(pair.dexId)));
  section.append(list);
  return section;
}

function stat(label, value) {
  return el("div", {}, [
    el("dt", { text: label }),
    el("dd", { text: value }),
  ]);
}

function renderSwap(ca, actions) {
  const section = el("section", {
    className: "panel token-swap",
    attrs: { "data-region": "swap", "aria-labelledby": "swap-heading" },
  });
  section.append(el("div", { className: "section-head" }, [
    el("div", {}, [
      el("h2", { attrs: { id: "swap-heading" }, text: "Swap" }),
      el("p", { className: "fine", text: "Optional. SOL into this token, inside Jupiter." }),
    ]),
    el("button", {
      className: "primary",
      text: "Swap",
      attrs: {
        type: "button",
        "data-action": "swap-toggle",
        "aria-expanded": "false",
        "aria-controls": "swap-body",
      },
      on: { click: () => actions.toggleSwap() },
    }),
  ]));
  const body = el("div", { attrs: { id: "swap-body", "data-swap-body": "true", hidden: "hidden" } });
  body.append(el("p", {
    className: "disclaimer",
    text: "Swaps are executed by Jupiter. Honeycharts is not a broker or custodian. Meme coins are high risk. Not financial advice, DYOR.",
  }));
  const feeText = feeDisclosure();
  if (feeText) body.append(el("p", { className: "fee-note", text: feeText }));
  body.append(el("p", {
    className: "fine",
    text: "Connecting a wallet and approving a transaction happens inside Jupiter, in your own wallet extension. Honeycharts never sees your keys.",
  }));
  body.append(el("p", { className: "muted", attrs: { "data-swap-status": "true" } }));
  body.append(el("div", { attrs: { id: "swap-mount" } }));
  const href = jupiterSwapUrl(ca);
  if (href) body.append(externalLink(href, "Swap on Jupiter", "text-link"));
  section.append(body);
  return section;
}

function renderScore(model) {
  const section = el("section", {
    className: "panel token-score",
    attrs: { "data-region": "score", "aria-labelledby": "score-heading" },
  });
  section.append(el("h2", { attrs: { id: "score-heading" }, text: "Honey Score" }));
  section.append(el("p", {
    className: "disclaimer",
    text: "Not financial advice, DYOR. This score only restates public data. It can be missing, stale, or wrong. A higher number does not mean a token is safe.",
  }));
  if (model.scoreStatus !== "ready" || !model.score) {
    section.append(el("p", { className: "muted", text: "Checking the public RugCheck report…" }));
    return section;
  }
  const score = model.score;
  const band = bandKey(score.score, score.incomplete);
  const wrap = el("div", { className: `score-readout band-${band}` });
  wrap.append(el("p", { className: "score-num" }, [
    String(score.score),
    el("span", { className: "visually-hidden", text: " out of 100" }),
  ]));
  wrap.append(el("p", { className: "band", text: score.band }));
  wrap.append(el("div", {
    className: `meter band-${band} s-${meterStep(score.score)}`,
    attrs: { "aria-hidden": "true" },
  }, [el("span")]));
  wrap.append(el("p", { text: score.summary }));
  section.append(wrap);

  const flags = el("ul", { className: "flags" });
  for (const flag of score.flags) {
    const item = el("li", { className: `flag ${flag.level}` });
    item.append(el("span", { className: "flag-level", text: LEVEL_LABEL[flag.level] || "Note" }));
    item.append(el("span", { className: "flag-title", text: flag.title }));
    if (flag.detail) item.append(el("span", { className: "flag-detail", text: flag.detail }));
    if (flag.points < 0) item.append(el("span", { className: "flag-points", text: `−${Math.abs(flag.points)}` }));
    flags.append(item);
  }
  section.append(flags);

  if (score.rugcheckIndex != null) {
    section.append(el("p", {
      className: "fine",
      text: `RugCheck's own risk index is ${score.rugcheckIndex} out of 100 on their scale, where a higher number means they reported more risk. It is separate from the Honey Score.`,
    }));
  }
  section.append(el("details", {}, [
    el("summary", { text: "How this number is built" }),
    el("p", {
      text: "When a RugCheck report loads, the score starts at 100. It subtracts points for an active mint authority (−25), an active freeze authority (−20), LP that does not look locked or burned (−20, partial −10, unclear −8), concentrated holders (up to −25), a transfer fee, thin liquidity (−20 under $5,000, −10 under $25,000), a new pair (−15 under an hour, −10 under a day, −5 under a week), and RugCheck danger flags (−8, up to 3) and warnings (−4, up to 3). The total is clamped from 0 to 100. If RugCheck marked the token rugged, the total is capped. If RugCheck did not load, the total starts at 55 and only liquidity and pair age apply.",
    }),
  ]));
  return section;
}

function renderChart(ca) {
  const section = el("section", { className: "chart-card", attrs: { "aria-label": "Chart" } });
  section.append(el("h2", { className: "visually-hidden", text: "Chart" }));
  section.append(el("iframe", {
    className: "chart-frame",
    attrs: {
      src: `https://dexscreener.com/solana/${encodeURIComponent(ca)}?embed=1&theme=dark&trades=0&info=0`,
      title: "DexScreener chart",
      loading: "eager",
      referrerpolicy: "no-referrer",
    },
  }));
  return section;
}

function renderHiveTools(model, actions) {
  const tools = el("div", { className: "toolbar panel" });
  tools.append(el("p", { className: "count", text: `${model.tokens.length} saved` }));
  tools.append(el("button", {
    className: "ghost",
    text: "Refresh",
    attrs: { type: "button" },
    on: { click: () => actions.refreshHive() },
  }));
  tools.append(el("button", {
    className: "ghost",
    text: "Export JSON",
    attrs: { type: "button" },
    on: { click: () => actions.exportHive() },
  }));
  const file = el("input", {
    className: "visually-hidden",
    attrs: { type: "file", accept: "application/json,.json", id: "hive-import" },
  });
  const replace = el("input", { attrs: { type: "checkbox", id: "hive-replace" } });
  file.addEventListener("change", () => {
    const picked = file.files && file.files[0];
    file.value = "";
    if (picked) actions.importHive(picked, replace.checked);
  });
  tools.append(file);
  tools.append(el("label", { className: "file-button", attrs: { for: "hive-import" }, text: "Import JSON" }));
  const replaceLabel = el("label", { className: "check", attrs: { for: "hive-replace" } });
  replaceLabel.append(replace);
  replaceLabel.append(document.createTextNode(" Replace entire Hive"));
  tools.append(replaceLabel);
  return tools;
}

function renderHiveTable(model, actions) {
  const wrap = el("div", { className: "table-wrap panel" });
  wrap.append(el("p", {
    className: "fine swipe-hint",
    text: "Swipe sideways for notes and the rest of the columns.",
  }));
  const table = el("table", { className: "hive-table" });
  const columns = [
    ["symbol", "Token"],
    ["price", "Price"],
    ["change", "24h"],
    ["liq", "Liquidity"],
    ["mcap", "MCap"],
    ["added", "Added"],
  ];
  const head = el("tr");
  for (const [key, label] of columns) {
    const sorted = model.sort.key === key;
    const arrow = sorted ? (model.sort.dir === "asc" ? " ↑" : " ↓") : "";
    const th = el("th", { attrs: { scope: "col" } });
    if (sorted) th.setAttribute("aria-sort", model.sort.dir === "asc" ? "ascending" : "descending");
    th.append(el("button", {
      className: "sort-btn",
      text: `${label}${arrow}`,
      attrs: { type: "button", "data-sort": key, "aria-pressed": sorted ? "true" : "false" },
      on: { click: () => actions.sortHive(key) },
    }));
    head.append(th);
  }
  head.append(el("th", { attrs: { scope: "col" }, text: "Note" }));
  head.append(el("th", { attrs: { scope: "col" }, text: "Remove" }));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  for (const row of sortRows(model.tokens, model.stats, model.sort)) {
    body.append(renderHiveRow(row, model.tokenHref, actions));
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function renderHiveRow(row, tokenHref, actions) {
  const { token, entry } = row;
  const pair = entry && entry.pair;
  const symbol = pairSymbol(pair, token) || shortCa(token.ca);
  const name = pairName(pair, token);
  const tr = el("tr", { attrs: { "data-ca": token.ca } });
  const tokenCell = el("td");
  const link = el("a", { className: "token-link", attrs: { href: tokenHref(token.ca) } }, [
    tokenAvatar(imageFrom(pair), symbol),
    el("span", {}, [
      el("span", { className: "name", text: symbol }),
      el("span", { className: "fine", text: name || shortCa(token.ca) }),
    ]),
  ]);
  tokenCell.append(link);
  tr.append(tokenCell);
  tr.append(el("td", { className: "num", attrs: { "data-stat": "price" }, text: priceText(entry) }));
  const change = changeValue(entry);
  tr.append(el("td", {
    className: `num ${pctClass(change)}`,
    attrs: { "data-stat": "change" },
    text: entry ? formatPct(change) : "…",
  }));
  tr.append(el("td", { className: "num", attrs: { "data-stat": "liq" }, text: entry ? money(entry, "liquidity") : "…" }));
  tr.append(el("td", { className: "num", attrs: { "data-stat": "mcap" }, text: mcapText(entry) }));
  tr.append(el("td", { className: "num", text: formatAgo(Date.now() - token.addedAt) }));
  const noteCell = el("td");
  noteCell.append(el("input", {
    className: "note",
    attrs: {
      type: "text",
      maxlength: "280",
      value: token.note,
      "aria-label": `Note for ${symbol}`,
      placeholder: "Optional note",
    },
    on: { input: (event) => actions.setNote(token.ca, event.currentTarget.value) },
  }));
  tr.append(noteCell);
  const removeCell = el("td");
  removeCell.append(el("button", {
    className: "ghost",
    text: "Remove",
    attrs: { type: "button", "aria-label": `Remove ${symbol} from Hive` },
    on: { click: () => actions.removeHive(token.ca) },
  }));
  tr.append(removeCell);
  return tr;
}

function renderRecent(place, recent, stats, tokenHref, actions) {
  const section = el("section", { className: "panel stack" });
  const head = el("div", { className: "section-head" }, [
    el("h2", { text: "Recently viewed" }),
  ]);
  if (recent.length) {
    head.append(el("button", {
      className: "ghost",
      text: "Clear",
      attrs: { type: "button" },
      on: { click: () => actions.clearRecent() },
    }));
  }
  section.append(head);
  if (!recent.length) {
    section.append(el("p", {
      className: "muted",
      text: "Tokens you open show up here, even when they are not in the Hive.",
    }));
    return section;
  }
  const list = el("ul", { className: "recent-list" });
  for (const item of recent) {
    const entry = stats.get(item.ca);
    const pair = entry && entry.pair;
    const symbol = pairSymbol(pair, item) || shortCa(item.ca);
    const change = changeValue(entry);
    const link = el("a", { attrs: { href: tokenHref(item.ca) } }, [
      tokenAvatar(imageFrom(pair), symbol),
      el("span", { className: "name", text: symbol }),
      el("span", { attrs: { "data-stat": "price" }, text: priceText(entry) }),
      el("span", {
        className: pctClass(change),
        attrs: { "data-stat": "change" },
        text: entry ? formatPct(change) : "…",
      }),
      el("span", { className: "fine", text: formatAgo(Date.now() - item.viewedAt) }),
    ]);
    list.append(el("li", { attrs: { "data-ca": item.ca } }, [link]));
  }
  section.append(list);
  if (place === "hive") {
    section.append(el("p", {
      className: "fine",
      text: "Recent tokens are kept on this browser. Export includes them when you replace from a backup.",
    }));
  }
  return section;
}

function sortRows(tokens, stats, sort) {
  const rows = tokens.map((token) => ({ token, entry: stats.get(token.ca) }));
  const dir = sort.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    const aNil = av == null || av === "";
    const bNil = bv == null || bv === "";
    if (aNil && bNil) return 0;
    if (aNil) return 1;
    if (bNil) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return rows;
}

function sortValue(row, key) {
  const pair = row.entry && row.entry.pair;
  if (key === "added") return row.token.addedAt;
  if (key === "symbol") return (pairSymbol(pair, row.token) || row.token.ca).toLowerCase();
  if (key === "price") return asFinite(pair && pair.priceUsd);
  if (key === "change") return asFinite(pair && pair.priceChange && pair.priceChange.h24);
  if (key === "liq") return asFinite(pair && pair.liquidity && pair.liquidity.usd);
  if (key === "mcap") return asFinite(pair && (pair.marketCap != null ? pair.marketCap : pair.fdv));
  return null;
}

function explorerLinks(ca) {
  return [
    ["View on DexScreener", `https://dexscreener.com/solana/${encodeURIComponent(ca)}`],
    ["View on Solscan", `https://solscan.io/token/${encodeURIComponent(ca)}`],
    ["RugCheck report", `https://rugcheck.xyz/tokens/${encodeURIComponent(ca)}`],
  ];
}

function listedLinks(pair) {
  if (!pair || !pair.info || typeof pair.info !== "object") return [];
  const out = [];
  const seen = new Set();
  const websites = Array.isArray(pair.info.websites) ? pair.info.websites : [];
  for (const site of websites) pushLink(out, seen, safeLinkLabel("website", site && site.url));
  const socials = Array.isArray(pair.info.socials) ? pair.info.socials : [];
  for (const social of socials) {
    const kind = social && (social.type === "twitter" || social.type === "telegram" || social.type === "discord")
      ? social.type
      : "website";
    pushLink(out, seen, safeLinkLabel(kind, social && social.url));
  }
  return out.slice(0, 6);
}

function pushLink(out, seen, link) {
  if (!link || seen.has(link.href)) return;
  seen.add(link.href);
  out.push(link);
}

function tokenAvatar(url, symbol) {
  const fallback = el("span", {
    className: "avatar",
    attrs: { "aria-hidden": "true" },
    text: initials(symbol),
  });
  const safe = safeImageUrl(url);
  if (!safe) return fallback;
  const img = el("img", {
    className: "avatar",
    attrs: { alt: "", src: safe, width: "40", height: "40", decoding: "async" },
  });
  img.addEventListener("error", () => img.replaceWith(fallback));
  return img;
}

function initials(symbol) {
  const text = clipText(typeof symbol === "string" ? symbol : "", 8);
  if (!text) return "•";
  return text.slice(0, 2).toUpperCase();
}

function imageFrom(pair) {
  return safeImageUrl(pair && pair.info && pair.info.imageUrl);
}

function pairSymbol(pair, token) {
  return clipText((pair && pair.baseToken && pair.baseToken.symbol) || (token && token.symbol) || "", 16);
}

function pairName(pair, token) {
  return clipText((pair && pair.baseToken && pair.baseToken.name) || (token && token.name) || "", 64);
}

function priceText(entry) {
  if (!entry) return "…";
  if (entry.error && !entry.pair) return "Unavailable";
  const price = asFinite(entry.pair && entry.pair.priceUsd);
  if (price == null) return "No pair";
  return formatPrice(price);
}

function changeValue(entry) {
  if (!entry || !entry.pair) return null;
  return asFinite(entry.pair.priceChange && entry.pair.priceChange.h24);
}

function money(entry, field) {
  if (!entry || !entry.pair) return "—";
  if (field === "liquidity") return formatCompactUsd(asFinite(entry.pair.liquidity && entry.pair.liquidity.usd));
  return "—";
}

function mcapText(entry) {
  if (!entry) return "…";
  if (!entry.pair) return entry.error ? "Unavailable" : "—";
  const cap = asFinite(entry.pair.marketCap != null ? entry.pair.marketCap : entry.pair.fdv);
  return formatCompactUsd(cap);
}
