import { el } from "./dom.js";
import { clipText } from "./sanitize.js";
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
import {
  chartValues,
  displayImage,
  formatLaunchAge,
  formatSolAmount,
  launchSparkValues,
  sparkFromWindows,
  sparklinePath,
} from "./launch-feed.js";
import { cleanImageSlot, nextImageUrl, proxyImageUrl } from "./token-image.js";

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
    patchLive(prev, model, actions);
    tickLaunchAges(prev);
    return;
  }
  const scrolls = readScrolls(root);
  while (root.firstChild) root.removeChild(root.firstChild);
  root.append(buildHome(model, actions, signature));
  writeScrolls(root, scrolls);
  patchLive(root, model, actions);
  bindLive(root, actions);
  tickLaunchAges(root);
}

function buildHome(model, actions, signature) {
  const page = el("div", { className: "home-board", attrs: { "data-board-root": "true", "data-sig": signature } });
  page.append(renderTapeShell());
  if (model.welcome) page.append(renderOnboard(actions));
  else page.append(renderIntroReplay(actions));
  if (!model.persistent) {
    page.append(el("p", {
      className: "banner slim-banner",
      text: "This browser is not saving the Hive. It will clear when you reload.",
    }));
  }
  page.append(renderKingShell());
  page.append(renderChips(model));
  page.append(renderToolbar(model, actions));
  if (model.error && !model.rows.length) page.append(el("p", { className: "banner", text: model.error }));
  page.append(renderTabs(model, actions));
  page.append(renderLiveStage());
  const grid = el("div", { className: "board-grid board-grid-lower" });
  grid.append(renderTableColumn(model, actions));
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
  const side = el("div", { className: "onboard-actions" });
  side.append(introWatchButton(actions));
  side.append(el("button", {
    className: "ghost onboard-dismiss",
    text: "Dismiss",
    attrs: { type: "button", "aria-label": "Dismiss introduction" },
    on: { click: () => actions.dismissWelcome() },
  }));
  box.append(side);
  return box;
}

function renderIntroReplay(actions) {
  return el("p", { className: "intro-replay" }, [introWatchButton(actions)]);
}

function introWatchButton(actions) {
  return el("button", {
    className: "intro-watch",
    text: "Watch intro",
    attrs: { type: "button" },
    on: { click: () => actions.watchIntro() },
  });
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
  link.append(tokenAvatar(row.image, row.symbol || row.name, 22, true));
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
  for (const [id, label] of [
    ["new", "New"],
    ["hot", "Graduate"],
    ["done", "Graduated"],
    ["trending", "Table"],
    ["trades", "Movers"],
  ]) {
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
  const limit = shownOf(model).table;
  const rows = selectTable(model.rows, { ...model, limit });
  if (!rows.length && model.loading) scroller.append(skeletonRows(8));
  else if (!rows.length) scroller.append(el("p", { className: "empty-note", text: emptyTable(model.filter) }));
  else scroller.append(renderTable(rows, model, actions));
  const hidden = Math.max(0, tableCount(model) - rows.length);
  if (hidden > 0) {
    scroller.append(el("button", {
      className: "show-more",
      text: `Show more tokens (${hidden})`,
      attrs: { type: "button" },
      on: { click: () => actions.loadMore("table") },
    }));
  }
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
  const spark = sparklinePath(sparkFromWindows(row.priceUsd, row.change), 64, 18);
  if (spark) names.append(sparkSvg(spark, change, 64, 18));
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
    if (node.closest("[data-live-root]")) return;
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
    shownOf(model).table,
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

function tokenAvatar(url, symbol, size, eager) {
  const fallback = generatedAvatar(symbol);
  const safe = cleanImageSlot(url);
  if (!safe) return fallback;
  return remoteAvatar(safe, symbol, size, eager);
}

function initials(symbol) {
  const text = clipText(typeof symbol === "string" ? symbol : "", 8);
  if (!text) return "•";
  return text.slice(0, 2).toUpperCase();
}

const LIVE_COLUMNS = [
  ["new", "fresh", "New pairs", "Every new Solana launch we can see, as it happens. A new launch is not a review."],
  ["hot", "hot", "About to graduate", "Bonding-curve progress. The bar is how close a pump.fun coin is to graduating."],
  ["done", "done", "Graduated", "Off the bonding curve, or already trading with real liquidity. Graduated or trending."],
];

function renderTapeShell() {
  const tape = el("div", {
    className: "live-tape",
    attrs: { "data-live-root": "tape", "aria-label": "Live launches" },
  });
  tape.append(el("span", { className: "live-pill", attrs: { "data-live-pill": "true" } }, [
    el("span", { className: "live-dot", attrs: { "aria-hidden": "true" } }),
    el("span", { attrs: { "data-live-label": "true" }, text: "LIVE" }),
  ]));
  const viewport = el("div", { className: "tape-viewport" });
  viewport.append(el("div", { className: "tape-track", attrs: { "data-tape": "true" } }));
  tape.append(viewport);
  return tape;
}

function renderKingShell() {
  return el("section", {
    className: "king-card",
    attrs: { "data-live-root": "king", "data-king": "true", "aria-label": "King of the hive" },
  });
}

function renderLiveStage() {
  const stage = el("div", { className: "live-stage", attrs: { "data-live-root": "stage" } });
  for (const [id, , title, blurb] of LIVE_COLUMNS) {
    const section = el("section", {
      className: "live-col",
      attrs: { "data-live-col": id, "aria-label": title },
    });
    const head = el("div", { className: "col-head live-head" });
    const titleRow = el("div", { className: "live-title" });
    titleRow.append(el("h2", { text: title }));
    titleRow.append(el("span", { className: "live-count", attrs: { "data-count": "true" }, text: "" }));
    titleRow.append(el("span", { className: "held-pill", attrs: { "data-held": "true", hidden: "hidden" }, text: "" }));
    head.append(titleRow);
    head.append(el("p", { text: blurb }));
    section.append(head);
    const scroller = el("div", { className: "board-scroll", attrs: { "data-scroller": `live-${id}` } });
    scroller.append(el("div", { className: "launch-list", attrs: { "data-list": "true" } }));
    scroller.append(el("button", {
      className: "show-more",
      attrs: { type: "button", "data-more": "true", hidden: "hidden" },
      text: "Show more",
    }));
    section.append(scroller);
    stage.append(section);
  }
  return stage;
}

function bindLive(root, actions) {
  root.querySelectorAll("[data-live-col]").forEach((section) => {
    const scroller = section.querySelector(".board-scroll");
    const more = section.querySelector("[data-more]");
    const id = section.getAttribute("data-live-col");
    if (more && !more.dataset.bound) {
      more.dataset.bound = "1";
      more.addEventListener("click", () => actions.loadMore(id));
    }
    if (!scroller || scroller.dataset.bound) return;
    scroller.dataset.bound = "1";
    let hover = false;
    let down = false;
    const sync = () => {
      const paused = hover || down;
      const was = scroller.dataset.paused === "1";
      scroller.dataset.paused = paused ? "1" : "0";
      if (was && !paused && actions.flushLive) actions.flushLive();
    };
    scroller.addEventListener("mouseenter", () => { hover = true; sync(); });
    scroller.addEventListener("mouseleave", () => { hover = false; sync(); });
    scroller.addEventListener("pointerdown", () => { down = true; sync(); });
    scroller.addEventListener("pointerup", () => { down = false; setTimeout(sync, 220); });
    scroller.addEventListener("pointercancel", () => { down = false; sync(); });
    const sentinel = more;
    if (sentinel && typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) actions.loadMore(id);
      }, { root: scroller, rootMargin: "160px" });
      observer.observe(sentinel);
    }
  });
}

function patchLive(root, model, actions) {
  const live = model.live || {};
  const columns = live.columns || {};
  paintLiveStatus(root, live.status);
  paintTape(root, live.tape || [], model);
  paintKing(root, live.king, model, actions);
  const shown = shownOf(model);
  for (const [id, key] of [["new", "fresh"], ["hot", "hot"], ["done", "done"]]) {
    const section = root.querySelector(`[data-live-col='${id}']`);
    if (!section) continue;
    section.classList.toggle("is-active", model.mobileTab === id);
    const all = Array.isArray(columns[key]) ? columns[key] : [];
    const items = all.slice(0, shown[id] || all.length);
    syncLaunchList(section, items, all.length, model, actions, live.status);
  }
}

function paintLiveStatus(root, status) {
  const pill = root.querySelector("[data-live-pill]");
  const label = root.querySelector("[data-live-label]");
  if (!pill || !label) return;
  const mode = status === "live" ? "live" : status === "polling" ? "polling" : "connecting";
  pill.classList.toggle("is-live", mode === "live");
  pill.classList.toggle("is-polling", mode === "polling");
  label.textContent = mode === "live" ? "LIVE" : mode === "polling" ? "POLLING" : "CONNECTING";
}

function paintTape(root, tape, model) {
  const track = root.querySelector("[data-tape]");
  const viewport = track && track.parentElement;
  if (!track) return;
  const items = Array.isArray(tape) ? tape : [];
  const sig = items.map((item) => `${item.kind}:${item.ca}:${item.symbol}:${item.image || ""}`).join(",");
  if (track.dataset.sig === sig) return;
  track.dataset.sig = sig;
  track.classList.remove("is-loop");
  track.classList.toggle("is-waiting", items.length === 0);
  track.replaceChildren();
  if (!items.length) {
    track.append(el("span", { className: "tape-wait", text: "Waiting for the next launch…" }));
    return;
  }
  const group = tapeGroup(items, model, false);
  track.append(group);
  const wide = viewport && group.scrollWidth > viewport.clientWidth + 24 && items.length >= 8;
  if (wide) {
    track.append(tapeGroup(items, model, true));
    track.classList.add("is-loop");
  }
}

function tapeGroup(items, model, clone) {
  const group = el("div", { className: "tape-group", attrs: clone ? { "aria-hidden": "true" } : {} });
  for (const item of items) {
    if (!item || !item.ca) continue;
    const raw = item.symbol || shortCa(item.ca) || "new";
    const label = raw.replace(/^\$+/, "") || "new";
    const text = item.kind === "migration"
      ? `GRAD $${label}`
      : `NEW $${label}${item.devBuySol != null ? ` · ${formatSolAmount(item.devBuySol)}` : ""}`;
    const link = el("a", {
      className: item.kind === "migration" ? "tape-item is-grad" : "tape-item",
      attrs: { href: model.tokenHref(item.ca) },
    });
    link.append(tokenAvatar(item.image, label, 18, false));
    link.append(el("span", { text }));
    if (clone) link.tabIndex = -1;
    group.append(link);
  }
  return group;
}

function paintKing(root, king, model, actions) {
  const card = root.querySelector("[data-king]");
  if (!card) return;
  if (!king) {
    if (card.dataset.ca) {
      card.dataset.ca = "";
      card.replaceChildren();
    }
    if (!card.firstChild) {
      card.append(el("p", { className: "king-wait", text: "The hive is picking a leader…" }));
    }
    return;
  }
  const role = king.kingRole || "curve";
  if (card.dataset.ca !== king.ca || card.dataset.role !== role) {
    card.dataset.ca = king.ca;
    card.dataset.role = role;
    card.replaceChildren(renderKing(king, model, actions));
    return;
  }
  updateKing(card, king, model);
}

function renderKing(token, model, actions) {
  const wrap = el("div", { className: "king-grid" });
  const link = el("a", { className: "king-id", attrs: { href: model.tokenHref(token.ca) } });
  const slot = el("span", { className: "avatar-slot" });
  slot.append(tokenAvatar(displayImage(token), token.symbol || token.name, 76, true));
  link.append(slot);
  const titles = el("span", { className: "king-titles" });
  const kicker = el("span", { className: "king-kicker" });
  kicker.append(el("img", {
    className: "king-mark",
    attrs: { src: "assets/coin.webp", alt: "", width: "16", height: "16" },
  }));
  kicker.append(el("span", { text: "King of the hive" }));
  if (token.kingRole === "graduated") {
    kicker.append(el("span", { className: "king-role", attrs: { "data-king-role": "true" }, text: "Graduated" }));
  }
  titles.append(kicker);
  const nameRow = el("span", { className: "king-name-row" });
  nameRow.append(el("span", { className: "king-sym", attrs: { "data-king-sym": "true" }, text: token.symbol || shortCa(token.ca) }));
  nameRow.append(el("span", { className: "king-name", attrs: { "data-king-name": "true" }, text: token.name || "" }));
  nameRow.append(el("span", {
    className: "king-age",
    attrs: { "data-age": "true", "data-born": token.createdAt ? String(token.createdAt) : "" },
    text: token.createdAt ? formatLaunchAge(Date.now() - token.createdAt) : "—",
  }));
  titles.append(nameRow);
  const stats = el("span", { className: "king-stats" });
  stats.append(el("span", { className: "king-mcap", attrs: { "data-king-mcap": "true" }, text: money(token.marketCapUsd) }));
  stats.append(changeChip(token, "m5", "5m"));
  stats.append(changeChip(token, "h1", "1h"));
  const extra = kingExtra(token);
  if (extra) stats.append(el("span", { className: "king-extra", attrs: { "data-king-extra": "true" }, text: extra }));
  titles.append(stats);
  if (token.kingRole === "graduated") {
    titles.append(el("span", { className: "king-grad", text: "Graduated" }));
  } else {
    titles.append(progressBlock(token, true));
  }
  link.append(titles);
  wrap.append(link);
  const chart = el("span", { className: "king-chart", attrs: { "data-king-chart": "true" } });
  appendKingChart(chart, token.chart);
  wrap.append(chart);
  const actionsRow = el("div", { className: "king-actions" });
  actionsRow.append(starButton(token, model.inHive(token.ca), actions));
  actionsRow.append(el("a", {
    className: "row-buy king-buy",
    attrs: { href: model.tradeHref(token.ca), "data-king-buy": "true" },
    text: "Buy",
  }));
  wrap.append(actionsRow);
  return wrap;
}

function changeChip(token, id, label) {
  const value = token.change && token.change[id];
  return el("span", {
    className: `king-chg ${pctClass(value)}`,
    attrs: { [`data-king-${id}`]: "true" },
    text: `${label} ${formatPct(value)}`,
  });
}

function kingExtra(token) {
  if (typeof token.holders === "number") return `${formatCount(token.holders)} holders`;
  const volume = token.volume && (token.volume.h1 != null ? token.volume.h1 : token.volume.m5);
  if (typeof volume === "number" && volume > 0) return `${money(volume)} vol`;
  return "";
}

function appendKingChart(host, values) {
  host.replaceChildren();
  const points = chartValues(values);
  if (points.length < 8) return;
  const path = sparklinePath(points, 128, 52);
  if (!path) return;
  host.append(sparkSvg(path, points[points.length - 1] - points[0], 128, 52));
}

function updateKing(card, token, model) {
  setText(card, "[data-king-sym]", token.symbol || shortCa(token.ca));
  setText(card, "[data-king-name]", token.name || "");
  setText(card, "[data-king-mcap]", money(token.marketCapUsd));
  setChangeChip(card, "m5", "5m", token.change && token.change.m5);
  setChangeChip(card, "h1", "1h", token.change && token.change.h1);
  const extra = card.querySelector("[data-king-extra]");
  const extraText = kingExtra(token);
  if (extra) {
    extra.hidden = !extraText;
    extra.textContent = extraText;
  }
  const age = card.querySelector("[data-age]");
  if (age && token.createdAt) age.setAttribute("data-born", String(token.createdAt));
  const buy = card.querySelector("[data-king-buy]");
  if (buy) buy.setAttribute("href", model.tradeHref(token.ca));
  if (token.kingRole !== "graduated") syncProgress(card, token);
  const chart = card.querySelector("[data-king-chart]");
  if (chart) appendKingChart(chart, token.chart);
  syncStar(card, token, model);
  const slot = card.querySelector(".avatar-slot");
  if (slot) syncAvatar(slot, displayImage(token), token.symbol || token.name, 76, true);
}

function setChangeChip(root, id, label, value) {
  const node = root.querySelector(`[data-king-${id}]`);
  if (!node) return;
  node.textContent = `${label} ${formatPct(value)}`;
  node.classList.remove("up", "down", "flat");
  node.classList.add(pctClass(value));
}

function syncLaunchList(section, items, total, model, actions, status) {
  const scroller = section.querySelector(".board-scroll");
  const list = section.querySelector("[data-list]");
  const count = section.querySelector("[data-count]");
  const held = section.querySelector("[data-held]");
  const more = section.querySelector("[data-more]");
  if (!list || !scroller) return;
  if (count) count.textContent = total ? String(total) : "";
  const paused = scroller.dataset.paused === "1";
  const existing = new Map();
  list.querySelectorAll("[data-launch-card]").forEach((node) => {
    existing.set(node.getAttribute("data-ca"), node);
  });
  if (paused) {
    for (const token of items) {
      const node = existing.get(token.ca);
      if (node) updateLaunchCard(node, token, model);
    }
    const waiting = items.filter((token) => !existing.has(token.ca)).length;
    if (held) {
      held.hidden = waiting <= 0;
      held.textContent = waiting ? `${waiting} new · paused` : "";
    }
  } else {
    if (held) held.hidden = true;
    const frag = document.createDocumentFragment();
    if (!items.length) {
      const note = status === "live"
        ? "No matching launches in this list yet."
        : "Connecting to live launches. Public lists fill this column as they answer.";
      frag.append(el("p", { className: "empty-note", text: note }));
    } else {
      items.forEach((token, index) => {
        let node = existing.get(token.ca);
        if (!node) node = renderLaunchCard(token, model, actions, index < 8);
        else updateLaunchCard(node, token, model);
        frag.append(node);
      });
    }
    list.replaceChildren(frag);
  }
  const hidden = Math.max(0, total - items.length);
  if (more) {
    more.hidden = hidden <= 0;
    more.textContent = hidden > 0 ? `Show more (${hidden})` : "Show more";
  }
}

function renderLaunchCard(token, model, actions, eager) {
  const born = typeof token.createdAt === "number" ? Date.now() - token.createdAt : 999999;
  const card = el("article", {
    className: born < 8000 ? "launch-card is-new" : "launch-card",
    attrs: { "data-launch-card": "true", "data-ca": token.ca },
  });
  const link = el("a", { className: "launch-main", attrs: { href: model.tokenHref(token.ca) } });
  const slot = el("span", { className: "avatar-slot" });
  slot.append(tokenAvatar(displayImage(token), token.symbol || token.name, 46, eager));
  link.append(slot);
  const copy = el("span", { className: "launch-copy" });
  copy.append(el("span", { className: "launch-sym", attrs: { "data-sym": "true" }, text: token.symbol || shortCa(token.ca) }));
  copy.append(el("span", { className: "launch-name", attrs: { "data-name": "true" }, text: token.name || "" }));
  copy.append(el("span", {
    className: "launch-age",
    attrs: { "data-age": "true", "data-born": token.createdAt ? String(token.createdAt) : "" },
    text: token.createdAt ? formatLaunchAge(Date.now() - token.createdAt) : "—",
  }));
  link.append(copy);
  card.append(link);
  const fig = el("div", { className: "launch-fig" });
  fig.append(el("span", { className: "launch-mcap", attrs: { "data-mcap": "true" }, text: money(token.marketCapUsd) }));
  fig.append(el("span", { className: "launch-dev", attrs: { "data-dev": "true" }, text: devText(token) }));
  const series = launchSparkValues(token);
  const spark = sparklinePath(series, 64, 18);
  if (spark) fig.append(sparkSvg(spark, series[series.length - 1] - series[0], 64, 18));
  card.append(fig);
  card.append(progressBlock(token, false));
  const row = el("div", { className: "launch-actions" });
  row.append(starButton(token, model.inHive(token.ca), actions));
  row.append(el("a", {
    className: "row-buy",
    attrs: { href: model.tradeHref(token.ca), "data-buy": "true" },
    text: "Buy",
  }));
  card.append(row);
  return card;
}

function updateLaunchCard(card, token, model) {
  setText(card, "[data-sym]", token.symbol || shortCa(token.ca));
  setText(card, "[data-name]", token.name || "");
  setText(card, "[data-mcap]", money(token.marketCapUsd));
  setText(card, "[data-dev]", devText(token));
  const age = card.querySelector("[data-age]");
  if (age && token.createdAt) age.setAttribute("data-born", String(token.createdAt));
  const buy = card.querySelector("[data-buy]");
  if (buy) buy.setAttribute("href", model.tradeHref(token.ca));
  const slot = card.querySelector(".avatar-slot");
  if (slot) syncAvatar(slot, displayImage(token), token.symbol || token.name, 46, false);
  syncProgress(card, token);
  syncSpark(card, launchSparkValues(token), 64, 18);
  syncStar(card, token, model);
}

function progressBlock(token, labeled) {
  const progress = typeof token.progress === "number" ? token.progress : null;
  const block = el("div", { className: "curve-block", attrs: { "data-curve-block": "true" } });
  if (progress == null) {
    block.hidden = true;
    return block;
  }
  const label = token.graduated ? "Graduated" : `${Math.round(progress)}%`;
  if (labeled) block.append(el("span", { className: "curve-label", attrs: { "data-curve-label": "true" }, text: label }));
  const bar = el("span", { className: "curve", attrs: { "aria-hidden": "true" } });
  bar.append(el("span", {
    className: "curve-fill",
    attrs: { "data-curve": "true" },
  }));
  block.append(bar);
  if (!labeled) block.append(el("span", { className: "curve-label", attrs: { "data-curve-label": "true" }, text: label }));
  const fill = block.querySelector("[data-curve]");
  if (fill) fill.style.width = `${clampProgress(progress).toFixed(1)}%`;
  return block;
}

function syncProgress(root, token) {
  const block = root.querySelector("[data-curve-block]");
  if (!block) return;
  const progress = typeof token.progress === "number" ? token.progress : null;
  block.hidden = progress == null;
  const fill = block.querySelector("[data-curve]");
  if (fill && progress != null) fill.style.width = `${clampProgress(progress).toFixed(1)}%`;
  const label = block.querySelector("[data-curve-label]");
  if (label && progress != null) label.textContent = token.graduated ? "Graduated" : `${Math.round(progress)}%`;
}

function syncSpark(root, values, width, height) {
  const path = sparklinePath(values, width, height);
  let svg = root.querySelector("svg.spark");
  if (!path) {
    if (svg) svg.remove();
    return;
  }
  if (!svg) {
    const host = root.querySelector(".launch-fig") || root.querySelector(".king-copy") || root;
    host.append(sparkSvg(path, values[values.length - 1] - values[0], width, height));
    return;
  }
  const shape = svg.querySelector("path");
  if (shape) shape.setAttribute("d", path);
  svg.setAttribute("class", `spark ${sparkTone(values[values.length - 1] - values[0])}`);
}

function syncStar(root, token, model) {
  const button = root.querySelector("[data-field='star']");
  if (!button) return;
  const on = model.inHive(token.ca);
  button.classList.toggle("is-on", on);
  button.textContent = on ? "★" : "☆";
  button.setAttribute("aria-pressed", on ? "true" : "false");
  const label = token.symbol || "token";
  button.setAttribute("aria-label", on ? `Remove ${label} from Hive` : `Add ${label} to Hive`);
}

function syncAvatar(slot, url, symbol, size, eager) {
  const safe = cleanImageSlot(url);
  const current = slot.querySelector(".avatar");
  if (!safe) {
    if (!current || !current.classList.contains("avatar-gen")) {
      const next = generatedAvatar(symbol);
      if (current) current.replaceWith(next);
      else slot.append(next);
    }
    return;
  }
  if (current && current.tagName === "IMG" && current.getAttribute("src") === safe) return;
  const img = remoteAvatar(safe, symbol, size, eager);
  if (current) current.replaceWith(img);
  else slot.append(img);
}

function remoteAvatar(url, symbol, size, eager) {
  const img = el("img", {
    className: "avatar",
    attrs: {
      alt: "",
      src: url,
      width: String(size),
      height: String(size),
      decoding: "async",
      loading: eager ? "eager" : "lazy",
      referrerpolicy: "no-referrer",
    },
  });
  img.dataset.origin = url;
  img.dataset.symbol = initials(symbol);
  img.addEventListener("error", () => {
    const failed = img.getAttribute("src") || "";
    const gateway = nextImageUrl(failed);
    if (gateway && gateway !== failed) {
      img.setAttribute("src", gateway);
      return;
    }
    if (img.dataset.try !== "proxy") {
      const proxied = proxyImageUrl(img.dataset.origin || failed);
      if (proxied) {
        img.dataset.try = "proxy";
        img.setAttribute("src", proxied);
        return;
      }
    }
    img.replaceWith(generatedAvatar(img.dataset.symbol || symbol));
  });
  return img;
}

function generatedAvatar(symbol) {
  const node = el("span", {
    className: "avatar avatar-gen",
    attrs: { "aria-hidden": "true" },
  });
  node.style.setProperty("--ava", String(avatarHue(symbol)));
  node.append(el("span", { className: "avatar-letters", text: initials(symbol) }));
  return node;
}

function avatarHue(symbol) {
  const text = typeof symbol === "string" ? symbol : "";
  let hue = 0;
  for (let index = 0; index < text.length; index += 1) hue = (hue * 33 + text.charCodeAt(index)) >>> 0;
  return hue % 360;
}

function sparkSvg(d, tone, width, height) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `spark ${sparkTone(tone)}`);
  svg.setAttribute("viewBox", `0 0 ${width || 64} ${height || 20}`);
  svg.setAttribute("width", String(width || 64));
  svg.setAttribute("height", String(height || 20));
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function sparkTone(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "spark-flat";
  return value > 0 ? "spark-up" : "spark-down";
}

export function tickLaunchAges(root, now = Date.now()) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("[data-born]").forEach((node) => {
    const born = Number(node.getAttribute("data-born"));
    if (!Number.isFinite(born) || born <= 0) return;
    const label = formatLaunchAge(Math.max(0, now - born));
    if (node.textContent !== label) node.textContent = label;
  });
}

function shownOf(model) {
  const shown = model && model.shown ? model.shown : {};
  return {
    new: shown.new || 48,
    hot: shown.hot || 36,
    done: shown.done || 36,
    table: shown.table || 48,
  };
}

function tableCount(model) {
  return selectTable(model.rows, { ...model, limit: 500 }).length;
}

function devText(token) {
  if (!token || token.devBuySol == null) return "";
  return `Dev ${formatSolAmount(token.devBuySol)}`;
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, value));
}

function setText(root, selector, text) {
  const node = root.querySelector(selector);
  if (node && node.textContent !== text) node.textContent = text;
}
