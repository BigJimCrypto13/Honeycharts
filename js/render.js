import { el, clear, externalLink } from "./dom.js";
import { renderTradeWallets } from "./wallet-connect-ui.js";
import { markerLabel } from "./search.js";
import { safeImageUrl, safeHttpUrl, safeLinkLabel, clipText, isValidCA } from "./sanitize.js";
import { HEURISTIC_SUMMARY } from "./creator.js";
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
import { BUY_SOL_AMOUNTS, BUY_USD_PRESETS, lamportsFromUsd } from "./swap.js";
import { feeDisclosure } from "./config.js";
import { tradeWindows, holderBarStep } from "./activity.js";
import { BOARD_WINDOWS, splitStep, xSearchUrl } from "./board.js";

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

export function renderToken(root, model, actions) {
  clear(root);
  const article = el("article", {
    className: model.railOpen === false ? "token-layout rail-collapsed" : "token-layout",
  });
  article.append(renderTrendRail(model, actions));
  const mainCol = el("div", { className: "token-main" });
  mainCol.append(renderTokenHead(model, actions));
  mainCol.append(renderStatPills(model));
  mainCol.append(renderChart(model.ca));
  mainCol.append(renderDexNotice(model));
  mainCol.append(renderTokenPanels(model, actions));
  const rail = el("div", { className: "token-rail" });
  rail.append(renderSwap(model.ca, model, actions));
  rail.append(renderAbout(model, actions));
  rail.append(renderStats(model));
  article.append(mainCol);
  article.append(rail);
  article.append(renderTradeDock(actions, model));
  article.append(el("button", {
    className: "trade-backdrop",
    attrs: { type: "button", "aria-label": "Close trade panel" },
    on: { click: () => actions.closeTrade() },
  }));
  root.append(article);
}

export function patchTokenMarket(root, model, actions) {
  const head = root.querySelector("[data-region='head']");
  const pills = root.querySelector("[data-region='pills']");
  const stats = root.querySelector("[data-region='stats']");
  const trades = root.querySelector("[data-region='trades']");
  const notice = root.querySelector("[data-region='notice']");
  if (!head || !pills || !stats || !trades || !notice) {
    renderToken(root, model, actions);
    return;
  }
  head.replaceWith(renderTokenHead(model, actions));
  pills.replaceWith(renderStatPills(model));
  stats.replaceWith(renderStats(model));
  trades.replaceWith(renderTrades(model));
  notice.replaceWith(renderDexNotice(model));
}

export function patchTokenAbout(root, model, actions) {
  const node = root.querySelector("[data-region='about']");
  if (!node) return;
  node.replaceWith(renderAbout(model, actions));
}

export function patchTrendRail(root, model, actions) {
  const node = root.querySelector("[data-region='trend-rail']");
  if (!node) return;
  const open = model.railOpen !== false;
  const article = node.closest(".token-layout");
  if (article) article.classList.toggle("rail-collapsed", !open);
  node.replaceWith(renderTrendRail(model, actions));
}

export function patchTokenHolders(root, model) {
  const node = root.querySelector("[data-region='holders']");
  if (!node) return;
  node.replaceWith(renderHolders(model));
}

export function patchTokenCreator(root, model, actions) {
  const head = root.querySelector("[data-region='head']");
  if (head) head.replaceWith(renderTokenHead(model, actions));
  const creator = root.querySelector("[data-region='creator']");
  if (creator) creator.replaceWith(renderCreator(model));
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
        text: model.lead || "A watchlist saved in this browser only. It is not uploaded, and it is not a portfolio.",
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

function renderTokenHead(model, actions) {
  const { ca, pair, inHive } = model;
  const symbol = pairSymbol(pair, model.fallback);
  const name = pairName(pair, model.fallback);
  const known = Boolean(symbol || name);
  const loading = !pair && model.dexStatus === "loading";
  const summary = model.creator && model.creator.summary;
  const head = el("section", {
    className: "token-head",
    attrs: { "data-region": "head", "aria-busy": !pair && loading ? "true" : "false" },
  });
  const identity = el("div", { className: "token-identity" });
  if (!known && loading) {
    identity.append(el("span", { className: "skeleton sk-avatar", attrs: { "aria-hidden": "true" } }));
  } else {
    identity.append(tokenAvatar(imageFrom(pair), symbol || name || ca, 56));
  }
  const titles = el("div", { className: "token-titles" });
  const tickerRow = el("div", { className: "ticker-row" });
  if (!known && loading) {
    tickerRow.append(el("span", { className: "skeleton sk-ticker", attrs: { "aria-hidden": "true" } }));
    tickerRow.append(el("span", { className: "visually-hidden", text: "Loading token" }));
  } else {
    tickerRow.append(el("h1", { className: "name", text: symbol || name || shortCa(ca) }));
    if (summary && summary.serial) {
      tickerRow.append(el("p", {
        className: "badge badge-rugger",
        attrs: { "data-badge": "serial-rugger" },
        text: "Serial Rugger",
      }));
    }
  }
  tickerRow.append(el("button", {
    className: inHive ? "ghost hive-on" : "ghost",
    text: inHive ? "In Hive" : "Add to Hive",
    attrs: {
      type: "button",
      "data-action": "hive-toggle",
      "aria-pressed": inHive ? "true" : "false",
    },
    on: { click: () => actions.toggleHive() },
  }));
  tickerRow.append(el("button", {
    className: "ghost",
    text: "Copy",
    attrs: { type: "button", "aria-label": "Copy contract address" },
    on: { click: () => actions.copyCa() },
  }));
  titles.append(tickerRow);
  const sub = el("div", { className: "token-sub" });
  if (!known && loading) {
    sub.append(el("span", { className: "skeleton sk-name", attrs: { "aria-hidden": "true" } }));
  } else {
    if (name && name !== symbol) sub.append(el("span", { className: "token-name", text: name }));
    sub.append(el("span", { className: "token-ca", attrs: { translate: "no" }, text: shortCa(ca) }));
  }
  titles.append(sub);
  identity.append(titles);
  head.append(identity);
  return head;
}

function marketCapValue(pair) {
  if (!pair) return null;
  return asFinite(pair.marketCap != null ? pair.marketCap : pair.fdv);
}

function renderStatPills(model) {
  const row = el("div", {
    className: "stat-pills",
    attrs: { "data-region": "pills", "aria-label": "Market stats" },
  });
  const pair = model.pair;
  const loading = !pair && model.dexStatus === "loading";
  const change = pair ? asFinite(pair.priceChange && pair.priceChange.h24) : null;
  row.append(statPill("Market cap", loading ? null : formatCompactUsd(marketCapValue(pair)), loading));
  row.append(statPill("Price", loading ? null : formatPrice(asFinite(pair && pair.priceUsd)), loading));
  const changePill = statPill("24h", loading ? null : formatPct(change), loading);
  if (!loading) {
    const strong = changePill.querySelector("strong");
    if (strong) strong.classList.add(pctClass(change));
  }
  row.append(changePill);
  row.append(statPill("24h volume", loading ? null : formatCompactUsd(asFinite(pair && pair.volume && pair.volume.h24)), loading));
  row.append(statPill("Liquidity", loading ? null : formatCompactUsd(asFinite(pair && pair.liquidity && pair.liquidity.usd)), loading));
  return row;
}

function statPill(label, value, loading) {
  const pill = el("p", { className: "stat-pill" });
  pill.append(el("span", { text: label }));
  if (loading) pill.append(el("span", { className: "skeleton sk-pill", attrs: { "aria-hidden": "true" } }));
  else pill.append(el("strong", { text: value || "—" }));
  return pill;
}

function renderTrendRail(model, actions) {
  const open = model.railOpen !== false;
  const rail = el("aside", {
    className: open ? "trend-rail" : "trend-rail is-collapsed",
    attrs: { "data-region": "trend-rail", "aria-label": "Trending coins" },
  });
  const head = el("div", { className: "trend-rail-head" });
  head.append(el("h2", { text: open ? "Trending" : "" }));
  head.append(el("button", {
    className: "ghost trend-toggle",
    text: open ? "Hide" : "Trending",
    attrs: {
      type: "button",
      "aria-expanded": open ? "true" : "false",
      "aria-label": open ? "Hide trending coins" : "Show trending coins",
    },
    on: { click: () => actions.toggleTrendRail() },
  }));
  rail.append(head);
  if (!open) return rail;
  const rows = Array.isArray(model.trending) ? model.trending : [];
  if (!rows.length) {
    rail.append(el("p", { className: "fine", text: "Loading trending coins…" }));
    return rail;
  }
  const list = el("div", { className: "trend-list" });
  for (const row of rows) {
    const change = row.change && row.change.h24;
    const current = row.ca === model.ca;
    const link = el("a", {
      className: current ? "trend-link is-current" : "trend-link",
      attrs: {
        href: model.tokenHref(row.ca),
        "aria-current": current ? "page" : false,
      },
    });
    link.append(tokenAvatar(row.image, row.symbol || row.name, 28));
    const copy = el("span", { className: "trend-copy" });
    copy.append(el("span", { className: "coin-sym", text: row.symbol || shortCa(row.ca) }));
    copy.append(el("span", { className: "trend-price", text: formatPrice(row.priceUsd) }));
    link.append(copy);
    const meta = el("span", { className: "trend-meta" });
    meta.append(el("span", { text: formatCompactUsd(row.marketCap) }));
    meta.append(el("span", { className: pctClass(change), text: formatPct(change) }));
    link.append(meta);
    list.append(link);
  }
  rail.append(list);
  return rail;
}

function renderAbout(model, actions) {
  const symbol = pairSymbol(model.pair, model.fallback) || "token";
  const section = el("section", {
    className: "panel about-card",
    attrs: { "data-region": "about", "aria-labelledby": "about-heading" },
  });
  section.append(el("h2", { attrs: { id: "about-heading" }, text: `About ${symbol}` }));
  const about = model.about;
  if (!about) {
    section.append(el("p", { className: "fine", text: "Loading the public token profile…" }));
    return section;
  }
  section.append(el("p", {
    className: "about-copy",
    text: about.description || "No description in the public token profile.",
  }));
  const windowId = model.aboutWindow || "h24";
  const chips = el("div", { className: "about-windows", attrs: { role: "group", "aria-label": "Change windows" } });
  for (const item of BOARD_WINDOWS) {
    const change = about.windows && about.windows[item.id] ? about.windows[item.id].change : null;
    chips.append(el("button", {
      className: `about-win ${pctClass(change)}`,
      attrs: {
        type: "button",
        "aria-pressed": windowId === item.id ? "true" : "false",
        title: item.title,
      },
      on: { click: () => actions.setAboutWindow(item.id) },
    }, [
      el("span", { text: item.label }),
      el("strong", { text: formatPct(change) }),
    ]));
  }
  section.append(chips);
  section.append(el("p", {
    className: "fine",
    text: "6h is the closest published window. These feeds do not include 4h or 12h.",
  }));
  const bucket = about.windows && about.windows[windowId] ? about.windows[windowId] : {};
  section.append(el("h3", { text: "Buys vs sells" }));
  section.append(splitBlock(bucket.buys, bucket.sells, "buys", "sells", formatCount));
  section.append(el("h3", { text: "Buy vs sell volume" }));
  section.append(el("p", { className: "fine", text: "Dollar volume reported by Jupiter for this window." }));
  section.append(splitBlock(bucket.buyVolume, bucket.sellVolume, "buy", "sell", formatCompactUsd));
  section.append(el("h3", { text: "Buyers vs sellers" }));
  section.append(el("p", { className: "fine", text: "Unique wallets on the deepest GeckoTerminal pool." }));
  section.append(splitBlock(bucket.buyers, bucket.sellers, "buyers", "sellers", formatCount));
  const links = el("div", { className: "about-links" });
  for (const link of about.links || []) {
    links.append(externalLink(link.href, link.label, "ghost"));
  }
  links.append(externalLink(xSearchUrl(symbol, model.ca), "Search on X", "ghost"));
  section.append(links);
  return section;
}

function splitBlock(part, other, partLabel, otherLabel, format) {
  const step = splitStep(part, other);
  if (step == null) return el("p", { className: "fine", text: "Not in the public feed." });
  const wrap = el("div", { className: "split-block" });
  wrap.append(el("p", {
    className: "split-caption",
    text: `${format(part)} ${partLabel} · ${format(other)} ${otherLabel}`,
  }));
  const bar = el("span", { className: "split-bar", attrs: { "aria-hidden": "true" } });
  bar.append(el("span", { className: `holder-fill p-${step}` }));
  wrap.append(bar);
  return wrap;
}

function shownBuyAmount(model) {
  if (!model) return "0.1";
  if (typeof model.swapSol === "number") return String(model.swapSol);
  if (typeof model.swapLamports === "string" && /^\d+$/.test(model.swapLamports)) {
    const sol = Number(model.swapLamports) / 1e9;
    if (Number.isFinite(sol) && sol > 0) {
      return sol.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    }
  }
  return "0.1";
}

function renderDexNotice(model) {
  const notice = el("p", {
    className: "banner",
    attrs: { "data-region": "notice" },
    text: model.dexMessage || "",
  });
  if (!model.dexMessage) notice.setAttribute("hidden", "");
  return notice;
}

function renderTokenPanels(model, actions) {
  const section = el("section", { className: "panel token-panels" });
  const tab = activeTab(model);
  const list = el("div", { className: "detail-tabs", attrs: { role: "tablist", "aria-label": "Token details" } });
  list.append(detailTab("trades", "Trades", tab, actions));
  list.append(detailTab("holders", "Holders", tab, actions));
  list.append(detailTab("info", "Info", tab, actions));
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const order = ["trades", "holders", "info"];
    const buttons = [...list.querySelectorAll("[role='tab']")];
    const current = buttons.findIndex((button) => button.getAttribute("aria-selected") === "true");
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "ArrowRight"
      ? (current + 1) % order.length
      : (current - 1 + order.length) % order.length;
    actions.setTokenTab(order[next]);
    buttons[next].focus();
  });
  section.append(list);
  section.append(renderTrades(model));
  section.append(renderHolders(model));
  const info = el("div", {
    className: "detail-panel",
    attrs: {
      "data-panel": "info",
      id: "token-panel-info",
      role: "tabpanel",
      "aria-labelledby": "token-tab-info",
      hidden: tab === "info" ? false : "",
    },
  });
  info.append(renderScore(model));
  info.append(renderCreator(model));
  info.append(renderTokenMeta(model, actions));
  section.append(info);
  return section;
}

function detailTab(id, label, current, actions) {
  return el("button", {
    className: "detail-tab",
    text: label,
    attrs: {
      type: "button",
      role: "tab",
      id: `token-tab-${id}`,
      "data-tab": id,
      "aria-selected": current === id ? "true" : "false",
      "aria-controls": `token-panel-${id}`,
    },
    on: { click: () => actions.setTokenTab(id) },
  });
}

function activeTab(model) {
  if (model.tokenTab === "holders" || model.tokenTab === "info") return model.tokenTab;
  return "trades";
}

function renderTrades(model) {
  const tab = activeTab(model);
  const panel = el("div", {
    className: "detail-panel",
    attrs: {
      "data-panel": "trades",
      "data-region": "trades",
      id: "token-panel-trades",
      role: "tabpanel",
      "aria-labelledby": "token-tab-trades",
      hidden: tab === "trades" ? false : "",
    },
  });
  const pair = model.pair;
  panel.append(el("p", {
    className: "fine",
    text: "Buy and sell counts from the deepest Solana pair. This is not a list of individual fills.",
  }));
  if (!pair && model.dexStatus === "loading") {
    panel.append(tradeSkeleton());
    return panel;
  }
  if (!pair) {
    panel.append(el("p", { text: model.dexMessage || "No trade counts yet. The chart may still load." }));
    return panel;
  }
  const table = el("div", { className: "trade-grid", attrs: { role: "table", "aria-label": "Trade counts" } });
  table.append(tradeHead());
  for (const row of tradeWindows(pair)) table.append(tradeRow(row));
  panel.append(table);
  return panel;
}

function tradeSkeleton() {
  const table = el("div", { className: "trade-grid", attrs: { "aria-hidden": "true" } });
  table.append(tradeHead());
  for (let index = 0; index < 4; index += 1) {
    const row = el("div", { className: "trade-row" });
    for (let cell = 0; cell < 4; cell += 1) row.append(el("span", { className: "skeleton sk-cell" }));
    table.append(row);
  }
  return table;
}

function tradeHead() {
  const line = el("div", { className: "trade-row trade-head", attrs: { role: "row" } });
  for (const label of ["Window", "Buys", "Sells", "Volume"]) {
    line.append(el("span", { attrs: { role: "columnheader" }, text: label }));
  }
  return line;
}

function tradeRow(row) {
  const line = el("div", { className: "trade-row", attrs: { role: "row" } });
  line.append(el("span", { attrs: { role: "rowheader" }, text: row.label }));
  line.append(el("span", { className: "up", attrs: { role: "cell" }, text: `${formatCount(row.buys == null ? NaN : row.buys)} buys` }));
  line.append(el("span", { className: "down", attrs: { role: "cell" }, text: `${formatCount(row.sells == null ? NaN : row.sells)} sells` }));
  line.append(el("span", { attrs: { role: "cell" }, text: formatCompactUsd(row.volume) }));
  return line;
}

function renderHolders(model) {
  const tab = activeTab(model);
  const panel = el("div", {
    className: "detail-panel",
    attrs: {
      "data-panel": "holders",
      "data-region": "holders",
      id: "token-panel-holders",
      role: "tabpanel",
      "aria-labelledby": "token-tab-holders",
      hidden: tab === "holders" ? false : "",
    },
  });
  const holders = model.holders || { status: "loading", total: null, rows: [] };
  if (holders.status === "loading") {
    panel.append(el("p", { className: "fine", text: "Top holders from the public RugCheck report." }));
    panel.append(el("p", { className: "visually-hidden", text: "Loading holders" }));
    panel.append(holderSkeleton());
    return panel;
  }
  const countNote = holders.total != null ? `${formatCount(holders.total)} holders reported by RugCheck. ` : "";
  panel.append(el("p", {
    className: "fine",
    text: `${countNote}Top holders from the public RugCheck report. Pools and exchanges can appear in this list.`,
  }));
  if (!holders.rows.length) {
    panel.append(el("p", { text: "RugCheck did not return a holder list we could read." }));
    return panel;
  }
  const list = el("ol", { className: "holder-list" });
  holders.rows.forEach((row, index) => list.append(holderRow(row, index)));
  panel.append(list);
  return panel;
}

function holderSkeleton() {
  const list = el("ol", { className: "holder-list", attrs: { "aria-hidden": "true" } });
  for (let index = 0; index < 8; index += 1) {
    const item = el("li", { className: "holder-row" });
    item.append(el("span", { className: "skeleton sk-rank" }));
    item.append(el("span", { className: "skeleton sk-holder" }));
    item.append(el("span", { className: "skeleton sk-cell" }));
    list.append(item);
  }
  return list;
}

function holderRow(row, index) {
  const id = row.owner || row.address;
  const item = el("li", { className: "holder-row" });
  item.append(el("span", { className: "holder-rank", text: String(index + 1) }));
  const who = el("span", { className: "holder-who" });
  if (id) who.append(externalLink(`https://solscan.io/account/${encodeURIComponent(id)}`, shortCa(id), "text-link"));
  else who.append(el("span", { text: "Holder" }));
  if (row.insider) who.append(el("span", { className: "fine", text: "Insider" }));
  if (row.uiAmount != null) who.append(el("span", { className: "fine", text: formatCount(row.uiAmount) }));
  item.append(who);
  const bar = el("span", { className: "holder-bar", attrs: { "aria-hidden": "true" } });
  bar.append(el("span", { className: `holder-fill p-${holderBarStep(row.pct)}` }));
  item.append(bar);
  item.append(el("span", { className: "holder-pct", text: pctPlain(row.pct) }));
  return item;
}

function pctPlain(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function renderTokenMeta(model, actions) {
  const section = el("div", { className: "token-meta" });
  section.append(el("h2", { text: "Contract" }));
  const caRow = el("div", { className: "ca-row" }, [
    el("code", { className: "ca", attrs: { translate: "no" }, text: model.ca }),
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
  if (share) caRow.append(externalLink(share, "Share on X", "ghost share-link"));
  caRow.append(el("button", {
    className: "ghost",
    text: "Refresh figures",
    attrs: { type: "button" },
    on: { click: () => actions.refreshToken() },
  }));
  section.append(caRow);
  const explorers = el("ul", { className: "link-row" });
  for (const [label, href] of explorerLinks(model.ca)) {
    const item = el("li");
    item.append(externalLink(href, label, "text-link"));
    explorers.append(item);
  }
  section.append(el("div", {}, [
    el("p", { className: "fine", text: "Outside links, if you want them." }),
    explorers,
  ]));
  const listed = listedLinks(model.pair);
  if (listed.length) {
    const list = el("ul", { className: "link-row" });
    for (const link of listed) {
      const item = el("li");
      item.append(externalLink(link.href, link.label, "text-link"));
      list.append(item);
    }
    section.append(el("div", {}, [
      el("p", { className: "fine", text: "Links listed by DexScreener. The hostname is shown so you can check it. Honeycharts does not verify them." }),
      list,
    ]));
  }
  return section;
}

function renderTradeDock(actions, model) {
  const needs = Boolean(model && model.needsFunds);
  const dock = el("div", { className: "trade-dock", attrs: { "data-region": "trade-dock" } });
  dock.append(el("button", {
    className: "dock-buy",
    text: needs ? "Add funds" : "Buy",
    attrs: { type: "button", "aria-controls": "trade-panel", "aria-expanded": "false" },
    on: { click: () => (needs ? actions.addFunds() : actions.openTrade("buy")) },
  }));
  dock.append(el("button", {
    className: "dock-sell",
    text: "Sell",
    attrs: { type: "button", "aria-controls": "trade-panel", "aria-expanded": "false" },
    on: { click: () => actions.openTrade("sell") },
  }));
  return dock;
}

function renderStats(model) {
  const section = el("section", {
    className: "panel token-stats",
    attrs: { "data-region": "stats", "aria-labelledby": "stats-heading" },
  });
  section.append(el("h2", { attrs: { id: "stats-heading" }, text: "Market" }));
  const pair = model.pair;
  if (model.dexStatus === "loading" && !pair) {
    section.append(el("p", { className: "fine", text: "Figures are from the deepest Solana pair." }));
    section.append(el("p", { className: "visually-hidden", text: "Loading market data" }));
    const list = el("dl", { className: "stats" });
    for (const label of ["Liquidity", "FDV", "Market cap", "24h volume", "24h trades", "Pair age", "DEX"]) {
      list.append(el("div", {}, [
        el("dt", { text: label }),
        el("dd", {}, [el("span", { className: "skeleton sk-stat", attrs: { "aria-hidden": "true" } })]),
      ]));
    }
    section.append(list);
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

export function renderWallet(root, model, actions) {
  clear(root);
  const page = el("div", { className: "stack", attrs: { "data-wallet-lookup": "true" } });
  page.append(el("p", {}, [
    el("a", { attrs: { href: "./?view=wallet" }, text: "My wallet" }),
  ]));
  page.append(el("section", { className: "hero" }, [
    el("h1", { text: "Check a wallet" }),
    el("p", {
      text: "Paste any Solana wallet. Honey Charts lists mints that wallet initialized and counts how many later died or lost more than 90%, using only figures that loaded.",
    }),
  ]));
  page.append(el("section", { className: "panel" }, [
    renderWalletForm(actions, model.wallet || ""),
  ]));
  if (model.routeError) page.append(el("p", { className: "banner", text: model.routeError }));
  if (model.wallet) page.append(renderCreator(model));
  root.append(page);
}

function renderWalletForm(actions, value) {
  const form = el("form", {
    className: "search wallet-form",
    attrs: { method: "get" },
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    actions.lookupWallet(input ? input.value : "");
  });
  form.append(el("label", { attrs: { for: "wallet-input" }, text: "Solana wallet address" }));
  const row = el("div", { className: "search-row" });
  row.append(el("input", {
    attrs: {
      id: "wallet-input",
      name: "wallet",
      type: "text",
      maxlength: "200",
      placeholder: "Paste a wallet address",
      autocomplete: "off",
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
      enterkeyhint: "go",
      value: value || "",
    },
  }));
  row.append(el("button", {
    className: "primary",
    text: "Check wallet",
    attrs: { type: "submit" },
  }));
  form.append(row);
  return form;
}

function renderCreator(model) {
  const creator = model.creator || {
    status: "loading",
    wallet: "",
    source: "",
    summary: null,
    notice: "",
    progress: "",
    error: "",
  };
  const section = el("section", {
    className: "panel token-creator",
    attrs: { "data-region": "creator", "aria-labelledby": "creator-heading" },
  });
  section.append(el("h2", { attrs: { id: "creator-heading" }, text: model.creatorHeading || "Deployer" }));
  if (creator.status === "missing") {
    section.append(el("p", {
      text: "No deployer wallet was listed on the RugCheck report, and the mint's first signer was not in the transactions the public RPC returned.",
    }));
    section.append(el("p", { className: "fine", text: "not enough data" }));
    return section;
  }
  if (creator.wallet) {
    section.append(el("code", { className: "ca", attrs: { translate: "no" }, text: creator.wallet }));
    const source = sourceLabel(creator.source);
    if (source) section.append(el("p", { className: "fine", text: source }));
    section.append(externalLink(
      `https://solscan.io/account/${encodeURIComponent(creator.wallet)}`,
      "View wallet on Solscan",
      "text-link",
    ));
    if (model.walletHref && creator.wallet) {
      section.append(el("p", {}, [
        el("a", { attrs: { href: model.walletHref(creator.wallet) }, text: "Check this wallet" }),
      ]));
    }
  } else if (creator.status === "loading") {
    section.append(el("p", { className: "muted", text: "Checking RugCheck for the deployer, then the mint's first transaction if that field is empty." }));
  }
  if (creator.error) section.append(el("p", { className: "banner", text: creator.error }));
  const summary = creator.summary;
  if (summary && summary.serial) {
    section.append(el("p", {
      className: "badge badge-rugger",
      attrs: { "data-badge": "serial-rugger" },
      text: "Serial Rugger",
    }));
  }
  if (summary) {
    section.append(el("p", {
      className: summary.serial ? "rugger-line" : "creator-line",
      attrs: { "data-headline": "creator" },
      text: summary.headline,
    }));
    if (summary.unknownLine) section.append(el("p", { className: "fine", text: summary.unknownLine }));
    if (summary.rows && summary.rows.length) {
      section.append(el("p", { className: "fine", text: countLine(summary) }));
    }
    if (summary.serial) {
      section.append(el("p", {
        className: "fine",
        text: "The badge repeats that count. It does not add a claim beyond those figures.",
      }));
    }
  }
  if (creator.notice) section.append(el("p", { className: "banner", text: creator.notice }));
  if (creator.status === "loading") {
    section.append(el("p", {
      className: "muted",
      attrs: { "data-creator-progress": "true" },
      text: creator.progress || "Reading public Solana transactions…",
    }));
  }
  if (summary && summary.rows && summary.rows.length) {
    const details = el("details", { attrs: model.creatorListOpen ? { open: "" } : {} });
    details.append(el("summary", { text: "Show the launches" }));
    details.append(renderLaunchList(summary.rows, model.tokenHref));
    section.append(details);
  }
  const how = el("details");
  how.append(el("summary", { text: "How a loss is counted" }));
  how.append(el("p", { text: HEURISTIC_SUMMARY }));
  how.append(el("p", {
    text: "A mint is listed when this wallet is the first signer on a transaction that initializes it. On a token page, that token is also included when RugCheck names this wallet as its creator. The read uses a public Solana RPC. Pump.fun's website API is not used. Prices are from DexScreener. This lookup does not connect a wallet or ask you to approve a transaction.",
  }));
  section.append(how);
  return section;
}

function renderLaunchList(rows, tokenHref) {
  const shown = rows.slice(0, 40);
  const list = el("ul", { className: "launch-list" });
  for (const row of shown) {
    const label = row.symbol || shortCa(row.mint);
    const reason = row.reasons && row.reasons[0] && row.reasons[0].text
      ? row.reasons[0].text
      : "not enough data";
    const item = el("li", { className: "launch-row", attrs: { "data-outcome": row.outcome || "unknown" } });
    if (tokenHref && isValidCA(row.mint)) {
      item.append(el("a", { attrs: { href: tokenHref(row.mint) }, text: label }));
    } else {
      item.append(el("span", { className: "name", text: label }));
    }
    if (row.symbol && isValidCA(row.mint)) {
      item.append(el("span", { className: "fine", text: shortCa(row.mint) }));
    }
    item.append(el("span", { className: `outcome outcome-${row.outcome || "unknown"}`, text: outcomeLabel(row.outcome) }));
    item.append(el("span", { className: "fine", text: reason }));
    list.append(item);
  }
  if (rows.length > shown.length) {
    list.append(el("li", { className: "fine", text: `${rows.length - shown.length} more launches were counted and are not listed here.` }));
  }
  return list;
}

function sourceLabel(source) {
  if (source === "rugcheck") return "RugCheck's creator field.";
  if (source === "first-signer") return "First signer on the mint's oldest loaded transaction.";
  if (source === "history") return "Mints this wallet initialized as the first signer, from its recent transactions.";
  return "";
}

function countLine(summary) {
  return `${summary.losses} lost · ${summary.alive} with no loss signal · ${summary.unknown} not enough data`;
}

function outcomeLabel(outcome) {
  if (outcome === "loss") return "Loss";
  if (outcome === "alive") return "No loss signal";
  return "not enough data";
}

export function renderSwapPanel(ca, model, actions) {
  return renderSwap(ca, model, actions);
}

function renderSwap(ca, model, actions) {
  const side = model && model.swapSide === "sell" ? "sell" : "buy";
  const solAmount = model ? model.swapSol : null;
  const symbol = pairSymbol(model && model.pair, model && model.fallback) || "token";
  const section = el("section", {
    className: "panel token-swap",
    attrs: { id: "trade-panel", "data-region": "swap", "aria-labelledby": "swap-heading" },
  });
  const sheetBar = el("div", { className: "sheet-bar" });
  sheetBar.append(el("span", { className: "sheet-grab", attrs: { "aria-hidden": "true" } }));
  sheetBar.append(el("button", {
    className: "ghost sheet-close",
    text: "Close",
    attrs: { type: "button" },
    on: { click: () => actions.closeTrade() },
  }));
  section.append(sheetBar);
  section.append(el("h2", { attrs: { id: "swap-heading" }, text: "Trade" }));
  const tabs = el("div", { className: "trade-tabs", attrs: { role: "tablist", "aria-label": "Buy or sell" } });
  tabs.append(tradeTab("buy", "Buy", side, actions));
  tabs.append(tradeTab("sell", "Sell", side, actions));
  section.append(tabs);
  if (side === "buy") {
    const field = el("label", { className: "swap-amount" });
    field.append(el("span", { text: "You pay" }));
    field.append(el("input", {
      attrs: {
        type: "text",
        inputmode: "decimal",
        maxlength: "16",
        autocomplete: "off",
        spellcheck: "false",
        "data-swap-amount": "true",
        "aria-label": "Buy amount in SOL",
        value: shownBuyAmount(model),
      },
    }));
    field.append(el("span", { className: "swap-unit", text: "SOL" }));
    section.append(field);
    const amounts = el("div", { className: "amount-row" });
    for (const sol of BUY_SOL_AMOUNTS) {
      amounts.append(el("button", {
        className: "ghost amount-btn",
        text: `${sol}`,
        attrs: {
          type: "button",
          "aria-pressed": solAmount === sol ? "true" : "false",
          "aria-label": `${sol} SOL`,
        },
        on: { click: () => actions.setSwapSol(sol) },
      }));
    }
    for (const usd of BUY_USD_PRESETS) {
      const lamports = lamportsFromUsd(usd, model && model.solPrice);
      const pressed = Boolean(lamports && model && model.swapLamports === lamports);
      amounts.append(el("button", {
        className: "ghost amount-btn",
        text: `$${usd}`,
        attrs: {
          type: "button",
          "aria-pressed": pressed ? "true" : "false",
          "aria-label": `About $${usd} of SOL`,
        },
        on: { click: () => actions.setSwapUsd(usd) },
      }));
    }
    section.append(amounts);
  } else {
    section.append(el("p", {
      className: "fine",
      text: model && model.usingHoneyWallet
        ? "The sell uses your Honey Charts wallet. Enter the amount in Jupiter, then approve it in Privy's window."
        : "Enter the sell amount in the Jupiter form. This page does not read an external wallet, so it cannot fill a percent of that balance.",
    }));
  }
  if (model && model.needsFunds && side === "buy") {
    section.append(el("button", {
      className: "primary swap-go",
      text: "Add funds",
      attrs: { type: "button" },
      on: { click: () => actions.addFunds() },
    }));
    section.append(el("p", { className: "fine", text: "This wallet does not have enough SOL for that buy." }));
  }
  section.append(el("button", {
    className: model && model.needsFunds && side === "buy"
      ? "ghost swap-go"
      : side === "sell" ? "swap-go swap-go-sell" : "primary swap-go",
    text: side === "buy" ? `Buy ${symbol} in Jupiter` : `Sell ${symbol} in Jupiter`,
    attrs: { type: "button" },
    on: { click: () => actions.applySwapAmount() },
  }));
  section.append(el("p", {
    className: "fine",
    text: model && model.usingHoneyWallet
      ? "The button fills Jupiter and pays from your Honey Charts wallet. You still approve the swap in Privy's window. Honey Charts never sees your keys."
      : "The button only fills Jupiter. You connect and approve in your own wallet. Honey Charts never sees your keys.",
  }));
  if (model && model.honeyAvailable) {
    section.append(el("button", {
      className: "ghost",
      text: model.usingHoneyWallet
        ? "Use Phantom, Solflare, or Backpack instead"
        : "Use my Honey Charts wallet",
      attrs: { type: "button" },
      on: { click: () => actions.useExternalWallet(!model.usingHoneyWallet) },
    }));
  }
  section.append(renderTradeWallets({
    onEmail: () => actions.openSignIn && actions.openSignIn("create"),
    onInstalled: () => {
      const mount = section.querySelector("#swap-mount");
      if (mount && typeof mount.scrollIntoView === "function") mount.scrollIntoView({ block: "nearest" });
    },
  }));
  const feeText = feeDisclosure();
  if (feeText) section.append(el("p", { className: "fee-note", text: feeText }));
  section.append(el("p", { className: "muted", attrs: { "data-swap-status": "true" } }));
  section.append(el("div", { attrs: { id: "swap-mount" } }, [
    el("div", { className: "swap-skeleton", attrs: { "aria-hidden": "true" } }, [
      el("span", { className: "skeleton sk-swap" }),
      el("span", { className: "skeleton sk-swap" }),
      el("span", { className: "skeleton sk-swap short" }),
    ]),
  ]));
  section.append(el("div", { attrs: { "data-swap-fallback": "true" } }));
  section.append(el("p", {
    className: "disclaimer",
    text: "Swaps are executed by Jupiter. Honeycharts is not a broker or custodian. Meme coins are high risk. Not financial advice, DYOR.",
  }));
  section.append(el("p", {
    className: "fine",
    text: model && model.usingHoneyWallet
      ? "Phantom, Solflare, and Backpack still work if you switch to them. The swap keeps the 0.5% Honeycharts fee."
      : "Connect Phantom, Solflare, or Backpack in Jupiter's picker. Approval stays in that wallet. Honeycharts never sees your keys.",
  }));
  return section;
}

function tradeTab(side, label, current, actions) {
  return el("button", {
    className: "trade-tab",
    text: label,
    attrs: {
      type: "button",
      role: "tab",
      "data-side": side,
      "aria-selected": current === side ? "true" : "false",
      id: `trade-${side}`,
    },
    on: { click: () => actions.setSwapSide(side) },
  });
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
    section.append(el("p", { className: "visually-hidden", text: "Checking the public RugCheck report…" }));
    section.append(el("div", { className: "score-skeleton", attrs: { "aria-hidden": "true" } }, [
      el("span", { className: "skeleton sk-score" }),
      el("span", { className: "skeleton sk-line" }),
      el("span", { className: "skeleton sk-line short" }),
    ]));
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
      text: "When a RugCheck report loads, the score starts at 100. It subtracts points for an active mint authority (−25), an active freeze authority (−20), LP that does not look locked or burned (−20, partial −10, unclear −8), concentrated holders (up to −25), a transfer fee, thin liquidity (−20 under $5,000, −10 under $25,000), a new pair (−15 under an hour, −10 under a day, −5 under a week), and RugCheck danger flags (−8, up to 3) and warnings (−4, up to 3). The total is clamped from 0 to 100. If RugCheck marked the token rugged, the total is capped. If RugCheck did not load, the total starts at 55 and only liquidity and pair age apply. Repeat deployer losses are applied after those caps. That penalty needs at least two coins counted as losses, and only where price, liquidity, or trading figures exist. It is 12 points, plus 4 points for each loss after the second, plus 10 points times the share of checked coins that were losses, and it stops at 30.",
    }),
  ]));
  return section;
}

function renderChart(ca) {
  const section = el("section", { className: "chart-card", attrs: { "aria-label": "Chart" } });
  section.append(el("h2", { className: "visually-hidden", text: "Chart" }));
  section.append(el("div", { className: "chart-skeleton skeleton", attrs: { "aria-hidden": "true" } }));
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
