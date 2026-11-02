// Browser feed of new Solana launches.
// PumpPortal's free data socket (new tokens + migrations only; trade
// subscriptions are paid, so this client never sends them) plus public
// Jupiter, DexScreener, and GeckoTerminal polls when the socket is quiet.

import {
  fetchGeckoDexPools,
  fetchGeckoPools,
  fetchJson,
  fetchJupiterBoard,
  fetchLatestProfiles,
  geckoOhlcvUrl,
  geckoTokenPoolsUrl,
} from "./api.js";
import { parseGeckoPools } from "./board.js";
import {
  applyLaunchImage,
  bestPoolAddress,
  capLaunches,
  closesFromOhlcv,
  decorateLaunch,
  displayImage,
  emptyLiveSnapshot,
  fillTape,
  ingestLaunch,
  launchFromBoardRow,
  launchFromJupiterToken,
  markMetadataFailed,
  normalizePumpMessage,
  pickKing,
  pushTape,
  selectGraduated,
  selectGraduating,
  selectNew,
} from "./launch-feed.js";
import { chooseImage, readImageCache, resolveMetadataImage, writeImageCache } from "./token-image.js";

const SOCKET_URL = "wss://pumpportal.fun/api/data";
const META_LIMIT = 3;

export function createLiveFeed({ storage, getSolPrice, onUpdate } = {}) {
  let launches = [];
  let tape = [];
  let status = "connecting";
  let stopped = false;
  let socket = null;
  let connecting = false;
  let reconnectTimer = 0;
  let pollTimer = 0;
  let emitTimer = 0;
  let dirty = false;
  let backoff = 1000;
  let polls = 0;
  let pollOk = false;
  let metaActive = 0;
  const imageCache = readImageCache(storage);
  const metaSeen = new Set();
  let chartCa = "";
  let chartAt = 0;
  let chartWait = 45000;
  let chartPoints = [];
  let chartBusy = false;

  function solPrice() {
    const value = typeof getSolPrice === "function" ? getSolPrice() : null;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  }

  function snapshot() {
    const px = solPrice();
    const decorated = launches.map((token) => decorateLaunch(token, px));
    const king = pickKing(decorated);
    if (king && king.ca === chartCa && chartPoints.length) king.chart = chartPoints.slice();
    tape = fillTape(tape, decorated);
    return {
      status,
      solPrice: px,
      tracked: decorated.length,
      launches: decorated,
      columns: {
        fresh: selectNew(decorated, 200),
        hot: selectGraduating(decorated, 80),
        done: selectGraduated(decorated, 80),
      },
      king,
      tape,
    };
  }

  function emit(immediate) {
    dirty = true;
    if (immediate) {
      clearTimeout(emitTimer);
      emitTimer = 0;
      flush();
      return;
    }
    if (emitTimer) return;
    emitTimer = setTimeout(flush, 120);
  }

  function flush() {
    emitTimer = 0;
    if (!dirty) return;
    dirty = false;
    const snap = snapshot();
    if (typeof onUpdate === "function") onUpdate(snap);
    refreshKingChart(snap.king);
  }

  async function refreshKingChart(king) {
    if (stopped || chartBusy || !king || !isMint(king.ca)) return;
    if (king.ca === chartCa && Date.now() - chartAt < chartWait) return;
    chartBusy = true;
    const ca = king.ca;
    try {
      const points = await loadCloses(king);
      if (stopped || ca !== king.ca) return;
      chartCa = ca;
      chartAt = Date.now();
      chartWait = 45000;
      chartPoints = points;
      emit(false);
    } catch {
      if (chartCa !== ca) chartPoints = [];
      chartCa = ca;
      chartAt = Date.now();
      chartWait = 8000;
    } finally {
      chartBusy = false;
    }
  }

  async function loadCloses(token) {
    let pool = geckoOhlcvUrl(token.poolAddress) ? token.poolAddress : "";
    if (!pool) {
      const data = await fetchJson(geckoTokenPoolsUrl(token.ca), { ttl: 60000 });
      pool = bestPoolAddress(data);
    }
    const url = geckoOhlcvUrl(pool);
    if (!url) return [];
    const payload = await fetchJson(url, { ttl: 45000 });
    return closesFromOhlcv(payload);
  }

  function isMint(value) {
    return typeof value === "string" && value.length >= 32;
  }

  function remember(token) {
    const chosen = chooseImage(token.images);
    if (!chosen || imageCache[token.ca] === chosen) return;
    imageCache[token.ca] = chosen;
    writeImageCache(storage, imageCache);
  }

  function take(token) {
    if (!token) return;
    if (imageCache[token.ca] && !chooseImage(token.images)) {
      token = {
        ...token,
        images: { ...token.images, cached: imageCache[token.ca] },
      };
    }
    const px = solPrice();
    if (token.marketCapUsd == null && token.marketCapSol != null && px) {
      token = { ...token, marketCapUsd: token.marketCapSol * px };
    }
    launches = ingestLaunch(launches, token, { solPrice: px });
    remember(launches.find((item) => item.ca === token.ca) || token);
  }

  function connect() {
    if (stopped || connecting) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    if (typeof WebSocket !== "function") {
      status = pollOk ? "polling" : "connecting";
      emit(true);
      return;
    }
    connecting = true;
    let ws;
    try {
      ws = new WebSocket(SOCKET_URL);
    } catch {
      connecting = false;
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.addEventListener("open", () => {
      connecting = false;
      backoff = 1000;
      status = "live";
      // Free methods only. subscribeTokenTrade bills a funded PumpPortal wallet.
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      ws.send(JSON.stringify({ method: "subscribeMigration" }));
      emit(true);
    });
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = normalizePumpMessage(message, Date.now());
      if (!parsed) return;
      take(parsed.token);
      tape = pushTape(tape, {
        id: parsed.signature || `${parsed.token.graduated ? "migration" : "launch"}:${parsed.token.ca}:${parsed.token.createdAt}`,
        kind: parsed.token.graduated ? "migration" : "launch",
        ca: parsed.token.ca,
        symbol: parsed.token.symbol || parsed.token.name || "NEW",
        image: displayImage(parsed.token),
        devBuySol: parsed.token.devBuySol,
        at: parsed.token.createdAt,
      });
      emit(false);
      pumpMetadata();
    });
    ws.addEventListener("error", () => {
      // Close follows. Status flips there so a blip does not blank the board.
    });
    ws.addEventListener("close", () => {
      connecting = false;
      if (socket === ws) socket = null;
      if (stopped) return;
      status = pollOk ? "polling" : "connecting";
      emit(false);
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, 20000);
  }

  async function poll() {
    if (stopped) return;
    polls += 1;
    const full = polls === 1 || polls % 2 === 0;
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(12000)
      : undefined;
    const jobs = [
      fetchJupiterBoard("recent", { signal }).then((rows) => {
        for (const row of rows) take(launchFromJupiterToken(row));
      }),
    ];
    if (full) {
      jobs.push(
        fetchGeckoPools("new", { signal, page: 1 }).then((payload) => absorbGecko(payload, {})),
        fetchGeckoPools("new", { signal, page: 2 }).then((payload) => absorbGecko(payload, {})),
        fetchGeckoDexPools("pump-fun", { signal, page: 1, sort: "h24_volume_usd_desc" }).then((payload) => {
          absorbGecko(payload, { launchpad: "pump.fun" });
        }),
        fetchGeckoDexPools("pumpswap", { signal, page: 1 }).then((payload) => {
          absorbGecko(payload, { launchpad: "pumpswap", graduated: true });
        }),
        fetchJupiterBoard("traded", { signal }).then((rows) => {
          for (const row of rows) {
            const token = launchFromJupiterToken(row, { trending: true });
            if (token && (token.graduated || token.trending)) take(token);
          }
        }),
        fetchLatestProfiles({ signal }).then((rows) => {
          for (const row of rows) {
            if (!row || !row.icon) continue;
            launches = applyLaunchImage(launches, row.ca, "dex", row.icon);
          }
        }),
      );
    }
    const results = await Promise.allSettled(jobs);
    if (stopped) return;
    if (results.some((result) => result.status === "fulfilled")) pollOk = true;
    if (status !== "live") status = pollOk ? "polling" : "connecting";
    launches = capLaunches(launches, solPrice());
    emit(polls === 1);
    pumpMetadata();
  }

  function absorbGecko(payload, extra) {
    const rows = parseGeckoPools(payload);
    for (const row of rows) {
      const launchpad = extra.launchpad || row.dex || "";
      take(launchFromBoardRow(row, {
        imageSlot: "gecko",
        launchpad,
        graduated: Boolean(extra.graduated) || launchpad === "pumpswap",
        source: "gecko",
      }));
    }
  }

  function pumpMetadata() {
    if (metaActive >= META_LIMIT) return;
    const newest = launches.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 40);
    const job = newest.find((token) => {
      if (!token.uri || token.images.metadata || token.metaFailed || metaSeen.has(token.ca)) return false;
      if (chooseImage(token.images)) return false;
      return true;
    });
    if (!job) return;
    metaSeen.add(job.ca);
    metaActive += 1;
    resolveMetadataImage(job.uri, globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetch)
      .then((image) => {
        if (stopped) return;
        if (image) {
          launches = applyLaunchImage(launches, job.ca, "metadata", image);
          remember(launches.find((item) => item.ca === job.ca) || job);
          emit(false);
        } else {
          launches = markMetadataFailed(launches, job.ca);
        }
      })
      .catch(() => {
        launches = markMetadataFailed(launches, job.ca);
      })
      .finally(() => {
        metaActive -= 1;
        metaSeen.delete(job.ca);
        if (!stopped) pumpMetadata();
      });
  }

  function onVisible() {
    if (stopped || document.hidden) return;
    if (!socket || socket.readyState > 1) connect();
  }

  return {
    start() {
      if (stopped) return;
      connect();
      poll().catch(() => {
        status = "connecting";
        emit(true);
      });
      pollTimer = setInterval(() => {
        poll().catch(() => {});
      }, 12000);
      document.addEventListener("visibilitychange", onVisible);
    },
    stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearTimeout(reconnectTimer);
      clearTimeout(emitTimer);
      document.removeEventListener("visibilitychange", onVisible);
      if (socket) socket.close();
      socket = null;
    },
    touch() {
      launches = capLaunches(launches, solPrice());
      emit(false);
    },
    snapshot,
  };
}

export { emptyLiveSnapshot };
