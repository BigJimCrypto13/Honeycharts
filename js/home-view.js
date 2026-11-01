import { el } from "./dom.js";
import { safeImageUrl, clipText } from "./sanitize.js";
import {
  formatCompactUsd,
  formatPrice,
  formatPct,
  formatCount,
  formatAge,
  pctClass,
} from "./format.js";
import {
  BOARD_WINDOWS,
  GRADUATED_LIQUIDITY,
  effectiveSort,
  selectTable,
  topMovers,
} from "./board.js";

const FILTERS = [
  ["trending", "Trending", "Coins in the public trending order."],
  ["held", "Most held", "Sorted by holder count from Jupiter's public token list."],
  ["new", "New", "Newest Solana pools from the public feeds."],
  ["graduated", "Graduated", `High liquidity: at least ${formatCompactUsd(GRADUATED_LIQUIDITY)} in the pool. Public feeds do not include a graduation flag.`],
  ["hive", "Watchlist", "Coins saved in the Hive on this browser."],
];

const SORTS = [
  ["mcap", "MCap"],
  ["change", "Change"],
  ["volume", "Volume"],
  ["liq", "Liq"],
  ["age", "Age"],
];

export function renderHome(root, model, actions) {
  const signature = boardSignature(model);
  const prev = root.querySelector("[data-board-root]");
  if (prev && prev.getAttribute("data-sig") === signature) {
    patchFigures(prev, model);
    return;
  }
  const scrolls = readScrolls(root);
  while (root.firstChild) root.removeChild(root.firstChild);
  root.append(buildHome(model, actions, signature));
  writeScrolls(root, scrolls);
}

function buildHome(model, actions, signature) {
  const page = el("div", { className: "home-board", attrs: { "data-board-root": "true", "data-sig": signature } });
  if (model.welcome) page.append(renderOnboard(actions));
  if (!model.persistent) {
    page.append(el("p", {
      className: "banner slim-banner",
      text: "This browser is not saving the Hive. It will clear when you reload.",
    }));
  }
  page.append(renderChips(model));
  page.append(renderToolbar(model, actions));
  if (model.error && !model.rows.length) page.append(el("p", { className: "banner", text: model.error }));
  page.append(renderTabs(model, actions));
  const grid = el("div", { className: "board-grid" });
  grid.append(renderTableColumn(model, actions));
  grid.append(renderListColumn(model, "new", "New pairs", "Newest Solana pools. A new pool is not a review."));
  grid.append(renderMovers(model));
  page.append(grid);
  page.append(renderBoosts(model));
  return page;
}

function renderOnboard(actions) {
  const box = el("section", { className: "onboard", attrs: { "data-onboard": "true", "aria-label": "How Honey Charts works" } });
  const copy = el("div", { className: "onboard-copy" });
  copy.append(el("p", {
    className: "onboard-tag",
    text: "Honey Charts. Where the buzz starts. Join the hive.",
  }));
  const steps = el("ol", { className: "onboard-steps" });
  for (const step of [
    "Search or pick a trending coin",
    "Check its Honey Score and rug flags",
    "Connect your own wallet and trade (we never see your keys)",
  ]) {
    steps.append(el("li", { text: step }));
  }
  copy.append(steps);
  copy.append(el("p", {
    className: "onboard-hint",
    text: "Add coins to your Hive to watch them on this browser.",
  }));
  box.append(copy);
  box.append(el("button", {
    className: "ghost onboard-dismiss",
    text: "Dismiss",
    attrs: { type: "button", "aria-label": "Dismiss introduction" },
    on: { click: () => actions.dismissWelcome() },
  }));
  return box;
}

function renderChips(model) {
  const rows = selectTable(model.rows, {
    filter: "trending",
    windowId: model.windowId,
    sortKey: "default",
    hiveOrder: model.hiveOrder,
    limit: 16,
  });
  const strip = el("div", { className: "chip-strip", attrs: { "aria-label": "Trending coins" } });
  if (!rows.length && model.loading) {
    for (let index = 0; index < 8; index += 1) {
      strip.append(el("span", { className: "chip chip-skel", attrs: { "aria-hidden": "true" } }, [
        el("span", { className: "skeleton sk-chip" }),
      ]));
    }
    strip.append(el("span", { className: "visually-hidden", text: "Loading trending coins" }));
    return strip;
  }
  for (const row of rows) strip.append(renderChip(row, model));
  if (!rows.length) {
    strip.append(el("p", { className: "fine", text: "Trending coins will show here when the public list loads." }));
  }
  return strip;
}

function renderChip(row, model) {
  const change = row.change[model.windowId];
  const link = el("a", {
    className: "chip",
    attrs: { href: model.tokenHref(row.ca), "data-ca": row.ca },
  });
  link.append(tokenAvatar(row.image, row.symbol || row.name, 22));
  link.append(el("span", { className: "chip-ticker", text: row.symbol || shortLabel(row) }));
  link.append(el("span", { className: "chip-mcap", attrs: { "data-field": "mcap" }, text: money(row.marketCap) }));
  link.append(el("span", {
    className: `chip-change ${pctClass(change)}`,
    attrs: { "data-field": "change" },
    text: formatPct(change),
  }));
  return link;
}

function renderToolbar(model, actions) {
  const bar = el("div", { className: "board-toolbar" });
  const filters = el("div", { className: "filter-row", attrs: { "data-board-filters": "true", role: "toolbar", "aria-label": "Coin lists" } });
  for (const [id, label, title] of FILTERS) {
    filters.append(el("button", {
      className: model.filter === id ? "chip-btn is-on" : "chip-btn",
      text: label,
      attrs: { type: "button", "aria-pressed": model.filter === id ? "true" : "false", title },
      on: { click: () => actions.setBoardFilter(id) },
    }));
  }
  bar.append(filters);
  const windows = el("div", { className: "window-row", attrs: { role: "group", "aria-label": "Change window" } });
  for (const item of BOARD_WINDOWS) {
    windows.append(el("button", {
      className: model.windowId === item.id ? "win-btn is-on" : "win-btn",
      text: item.label,
      attrs: { type: "button", "aria-pressed": model.windowId === item.id ? "true" : "false", title: item.title },
      on: { click: () => actions.setBoardWindow(item.id) },
    }));
  }
  bar.append(windows);
  const buy = el("label", { className: "quick-buy" });
  buy.append(el("span", { text: "Quick buy" }));
  const select = el("select", { attrs: { "aria-label": "Quick buy amount in SOL" } });
  for (const sol of [0.1, 0.5, 1]) {
    select.append(el("option", {
      text: `${sol} SOL`,
      attrs: { value: String(sol), selected: model.quickBuy === sol ? "selected" : false },
    }));
  }
  select.addEventListener("change", () => actions.setQuickBuy(Number(select.value)));
  buy.append(select);
  buy.append(el("span", { className: "fine", text: "Opens the coin with that amount in Jupiter. Nothing is signed here." }));
  bar.append(buy);
  return bar;
}

function renderTabs(model, actions) {
  const tabs = el("div", { className: "board-tabs", attrs: { role: "tablist", "aria-label": "Home columns" } });
  for (const [id, label] of [["trending", "Trending"], ["new", "New"], ["trades", "Trades"]]) {
    tabs.append(el("button", {
      className: "board-tab",
      text: label,
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": model.mobileTab === id ? "true" : "false",
      },
      on: { click: () => actions.setMobileTab(id) },
    }));
  }
  return tabs;
}

function renderTableColumn(model, actions) {
  const section = el("section", {
    className: columnClass("trending", model.mobileTab),
    attrs: { "aria-label": "Token table" },
  });
  section.append(columnHead("Tokens", tableBlurb(model.filter)));
  const scroller = el("div", { className: "board-scroll", attrs: { "data-scroller": "table" } });
  const rows = selectTable(model.rows, model);
  if (!rows.length && model.loading) scroller.append(skeletonRows(8));
  else if (!rows.length) scroller.append(el("p", { className: "empty-note", text: emptyTable(model.filter) }));
  else scroller.append(renderTable(rows, model, actions));
  section.append(scroller);
  return section;
}

function renderTable(rows, model, actions) {
  const sort = effectiveSort(model.filter, model.sortKey, model.sortDir);
  const table = el("table", { className: "board-table" });
  const head = el("tr");
  head.append(el("th", { attrs: { scope: "col" }, text: "" }));
  head.append(el("th", { attrs: { scope: "col" }, text: "Token" }));
  for (const [key, label] of SORTS) {
    const shown = key === "change" ? modelWindow(model).label : label;
    const on = sort.key === key;
    const th = el("th", { attrs: { scope: "col" } });
    if (on) th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending");
    th.append(el("button", {
      className: "sort-btn",
      text: on ? `${shown} ${sort.dir === "asc" ? "↑" : "↓"}` : shown,
      attrs: { type: "button", "aria-pressed": on ? "true" : "false" },
      on: { click: () => actions.setBoardSort(key) },
    }));
    head.append(th);
  }
  head.append(el("th", { attrs: { scope: "col" }, text: "Buy" }));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  for (const row of rows) body.append(renderTableRow(row, model, actions));
  table.append(body);
  return table;
}

function renderTableRow(row, model, actions) {
  const change = row.change[model.windowId];
  const inHive = model.inHive(row.ca);
  const tr = el("tr", { attrs: { "data-ca": row.ca } });
  const starCell = el("td");
  starCell.append(starButton(row, inHive, actions));
  tr.append(starCell);
  const who = el("td");
  const link = el("a", { className: "coin-id", attrs: { href: model.tokenHref(row.ca) } });
  link.append(tokenAvatar(row.image, row.symbol || row.name, 28));
  const names = el("span", { className: "coin-names" });
  names.append(el("span", { className: "coin-sym", text: row.symbol || shortLabel(row) }));
  names.append(el("span", { className: "coin-name", text: row.name || shortLabel(row) }));
  if (model.filter === "held" && row.holders != null) {
    names.append(el("span", { className: "fine", text: `${formatCount(row.holders)} holders` }));
  }
  link.append(names);
  who.append(link);
  tr.append(who);
  tr.append(el("td", { className: "num", attrs: { "data-field": "mcap" }, text: money(row.marketCap) }));
  tr.append(el("td", { className: `num ${pctClass(change)}`, attrs: { "data-field": "change" }, text: formatPct(change) }));
  tr.append(el("td", { className: "num", attrs: { "data-field": "volume" }, text: money(row.volume[model.windowId]) }));
  tr.append(el("td", { className: "num", attrs: { "data-field": "liq" }, text: money(row.liquidity) }));
  tr.append(el("td", { className: "num", attrs: { "data-field": "age" }, text: ageText(row.createdAt) }));
  const buy = el("td");
  buy.append(el("a", {
    className: "row-buy",
    attrs: { href: model.tradeHref(row.ca) },
    text: "Buy",
  }));
  tr.append(buy);
  return tr;
}

function renderListColumn(model, filter, title, blurb) {
  const section = el("section", {
    className: columnClass(filter === "new" ? "new" : filter, model.mobileTab),
    attrs: { "aria-label": title },
  });
  section.append(columnHead(title, blurb));
  const scroller = el("div", { className: "board-scroll", attrs: { "data-scroller": filter } });
  const rows = selectTable(model.rows, { ...model, filter, sortKey: "default", limit: 14 });
  if (!rows.length && model.loading) scroller.append(skeletonRows(8));
  else if (!rows.length) scroller.append(el("p", { className: "empty-note", text: "No Solana pools in this list yet." }));
  else {
    const list = el("div", { className: "coin-list" });
    for (const row of rows) list.append(renderCoinRow(row, model));
    scroller.append(list);
  }
  section.append(scroller);
  return section;
}

function renderMovers(model) {
  const section = el("section", {
    className: columnClass("trades", model.mobileTab),
    attrs: { "aria-label": "Top movers" },
  });
  section.append(columnHead(
    "Top movers",
    "Biggest price move in this window on the public lists. Not a live trade tape.",
  ));
  const scroller = el("div", { className: "board-scroll", attrs: { "data-scroller": "movers" } });
  const rows = topMovers(model.rows, model.windowId, 12);
  if (!rows.length && model.loading) scroller.append(skeletonRows(8));
  else if (!rows.length) scroller.append(el("p", { className: "empty-note", text: "Movers show up when prices load." }));
  else {
    const list = el("div", { className: "coin-list" });
    for (const row of rows) list.append(renderCoinRow(row, model));
    scroller.append(list);
  }
  scroller.append(el("aside", { className: "soon-card" }, [
    el("h3", { text: "Leaderboard & callouts coming soon" }),
    el("p", { text: "Trader callouts and a profit leaderboard need accounts. They are not on this page." }),
  ]));
  section.append(scroller);
  return section;
}

function renderCoinRow(row, model) {
  const change = row.change[model.windowId];
  const link = el("a", {
    className: "coin-row",
    attrs: { href: model.tokenHref(row.ca), "data-ca": row.ca },
  });
  link.append(tokenAvatar(row.image, row.symbol || row.name, 32));
  const names = el("span", { className: "coin-names" });
  names.append(el("span", { className: "coin-sym", text: row.symbol || shortLabel(row) }));
  names.append(el("span", { className: "coin-name", text: row.name || shortLabel(row) }));
  link.append(names);
  link.append(el("span", { className: "coin-price", attrs: { "data-field": "price" }, text: formatPrice(row.priceUsd) }));
  const meta = el("span", { className: "coin-meta" });
  meta.append(el("span", { attrs: { "data-field": "mcap" }, text: money(row.marketCap) }));
  meta.append(el("span", { className: pctClass(change), attrs: { "data-field": "change" }, text: formatPct(change) }));
  link.append(meta);
  return link;
}

function renderBoosts(model) {
  const feed = model.boosts || { items: [], error: "" };
  const section = el("section", { className: "paid-strip" });
  section.append(el("h2", { text: "Paid on DexScreener" }));
  section.append(el("p", {
    className: "fine",
    text: "Paid promotions. Not a Honey Charts ranking, and not an endorsement.",
  }));
  if (feed.error && !feed.items.length) {
    section.append(el("p", { className: "fine", text: feed.error }));
    return section;
  }
  if (!feed.items.length) return section;
  const row = el("div", { className: "paid-row" });
  for (const item of feed.items.slice(0, 8)) {
    const link = el("a", { className: "paid-card", attrs: { href: model.tokenHref(item.ca) } });
    link.append(el("span", { className: "badge badge-paid", text: "Boosted · paid" }));
    link.append(el("span", { className: "paid-ca", text: item.description || shortCa(item.ca) }));
    row.append(link);
  }
  section.append(row);
  return section;
}

function columnHead(title, blurb) {
  return el("div", { className: "col-head" }, [
    el("h2", { text: title }),
    el("p", { text: blurb }),
  ]);
}

function columnClass(id, mobileTab) {
  return mobileTab === id ? "board-col is-active" : "board-col";
}

function starButton(row, inHive, actions) {
  const label = row.symbol || "token";
  return el("button", {
    className: inHive ? "star is-on" : "star",
    text: inHive ? "★" : "☆",
    attrs: {
      type: "button",
      "aria-pressed": inHive ? "true" : "false",
      "aria-label": inHive ? `Remove ${label} from Hive` : `Add ${label} to Hive`,
      "data-field": "star",
    },
    on: { click: () => actions.toggleHiveCa(row.ca) },
  });
}

function skeletonRows(count) {
  const wrap = el("div", { className: "skel-list", attrs: { "aria-hidden": "true" } });
  for (let index = 0; index < count; index += 1) {
    wrap.append(el("div", { className: "skel-row" }, [
      el("span", { className: "skeleton sk-row-ava" }),
      el("span", { className: "skeleton sk-row-line" }),
    ]));
  }
  return wrap;
}

function patchFigures(root, model) {
  const byCa = new Map(model.rows.map((row) => [row.ca, row]));
  root.querySelectorAll("[data-ca]").forEach((node) => {
    const row = byCa.get(node.getAttribute("data-ca"));
    if (!row) return;
    const change = row.change[model.windowId];
    setField(node, "price", formatPrice(row.priceUsd));
    setField(node, "mcap", money(row.marketCap));
    setField(node, "volume", money(row.volume[model.windowId]));
    setField(node, "liq", money(row.liquidity));
    setField(node, "age", ageText(row.createdAt));
    const changeNode = node.querySelector("[data-field='change']") || (node.getAttribute("data-field") === "change" ? node : null);
    if (node.getAttribute("data-field") === "change") paintChange(node, change);
    node.querySelectorAll("[data-field='change']").forEach((child) => paintChange(child, change));
    if (changeNode && changeNode !== node) paintChange(changeNode, change);
  });
}

function setField(root, field, text) {
  const nodes = [];
  if (root.getAttribute("data-field") === field) nodes.push(root);
  root.querySelectorAll(`[data-field='${field}']`).forEach((node) => nodes.push(node));
  for (const node of nodes) node.textContent = text;
}

function paintChange(node, change) {
  node.textContent = formatPct(change);
  node.classList.remove("up", "down", "flat");
  node.classList.add(pctClass(change));
}

function boardSignature(model) {
  const table = selectTable(model.rows, model).map((row) => row.ca).join(",");
  const fresh = selectTable(model.rows, { ...model, filter: "new", sortKey: "default", limit: 14 }).map((row) => row.ca).join(",");
  const movers = topMovers(model.rows, model.windowId, 12).map((row) => row.ca).join(",");
  const chips = selectTable(model.rows, { ...model, filter: "trending", sortKey: "default", limit: 16 }).map((row) => row.ca).join(",");
  const hive = (model.hiveOrder || []).join(",");
  const boosts = (model.boosts && model.boosts.items || []).map((item) => item.ca).join(",");
  return [
    model.welcome ? "1" : "0",
    model.loading ? "L" : "R",
    model.filter,
    model.windowId,
    model.sortKey,
    model.sortDir,
    model.quickBuy,
    model.mobileTab,
    model.error || "",
    table,
    fresh,
    movers,
    chips,
    hive,
    boosts,
  ].join("|");
}

function readScrolls(root) {
  const saved = new Map();
  root.querySelectorAll("[data-scroller]").forEach((node) => {
    saved.set(node.getAttribute("data-scroller"), node.scrollTop);
  });
  return saved;
}

function writeScrolls(root, saved) {
  root.querySelectorAll("[data-scroller]").forEach((node) => {
    const top = saved.get(node.getAttribute("data-scroller"));
    if (top) node.scrollTop = top;
  });
}

function modelWindow(model) {
  return BOARD_WINDOWS.find((item) => item.id === model.windowId) || BOARD_WINDOWS[3];
}

function tableBlurb(filter) {
  const found = FILTERS.find((item) => item[0] === filter);
  return found ? found[2] : "";
}

function emptyTable(filter) {
  if (filter === "hive") return "Your Hive is empty. Star a coin to keep it on this browser.";
  if (filter === "held") return "Holder counts have not loaded from Jupiter yet.";
  if (filter === "graduated") return `No pool in this refresh has at least ${formatCompactUsd(GRADUATED_LIQUIDITY)} liquidity.`;
  if (filter === "new") return "No new Solana pools in this refresh.";
  return "The trending list has not loaded.";
}

function money(value) {
  return formatCompactUsd(typeof value === "number" ? value : null);
}

function ageText(createdAt) {
  if (typeof createdAt !== "number") return "—";
  const age = Date.now() - createdAt;
  if (age < 0) return "—";
  return formatAge(age);
}

function shortLabel(row) {
  return row.symbol || row.name || shortCa(row.ca);
}

function shortCa(ca) {
  if (typeof ca !== "string" || ca.length < 10) return ca || "";
  return `${ca.slice(0, 4)}…${ca.slice(-4)}`;
}

function tokenAvatar(url, symbol, size) {
  const fallback = el("span", {
    className: "avatar",
    attrs: { "aria-hidden": "true" },
    text: initials(symbol),
  });
  const safe = safeImageUrl(url);
  if (!safe) return fallback;
  const img = el("img", {
    className: "avatar",
    attrs: { alt: "", src: safe, width: String(size), height: String(size), decoding: "async" },
  });
  img.addEventListener("error", () => img.replaceWith(fallback));
  return img;
}

function initials(symbol) {
  const text = clipText(typeof symbol === "string" ? symbol : "", 8);
  if (!text) return "•";
  return text.slice(0, 2).toUpperCase();
}
