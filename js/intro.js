// First-visit intro. The video is created after the page script runs, muted,
// so it does not block the home page and does not autoplay with sound.

import { el } from "./dom.js";

export const INTRO_VIDEO = "assets/intro/honeycharts-intro-web.mp4";
export const INTRO_POSTER = "assets/intro/honeycharts-intro-poster.jpg";
export const INTRO_CAPTIONS = "assets/intro/captions.vtt";
export const INTRO_TAGLINE = "Honey Charts. Where the buzz starts. Join the hive.";

// Exact voiceover, in order. Joined with spaces this matches assets/intro/script.txt.
export const INTRO_LINES = [
  "Welcome to the hive.",
  "Live charts.",
  "Your own wallet.",
  "Launch meme tokens in seconds.",
  "Follow traders, share calls, add your song.",
  "Honey Charts.",
  "Your all-in-one Solana platform.",
  "Then protect your colony in the Hive.",
  "Honey Charts.",
];

const INTRO_DURATION = 15;

export function introScript() {
  return INTRO_LINES.join(" ");
}

export function cueAt(seconds) {
  const time = typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const slot = INTRO_DURATION / INTRO_LINES.length;
  const index = Math.min(INTRO_LINES.length - 1, Math.floor(time / slot));
  return INTRO_LINES[index];
}

export function taglineVisible(seconds, duration) {
  const time = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 0;
  const length = typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : INTRO_DURATION;
  return time >= Math.max(0, length - 4);
}

// Replay is an explicit choice and still only belongs on the home page.
export function shouldShowIntro(routeName, seen, replay = false) {
  if (routeName !== "home") return false;
  if (replay) return true;
  return !seen;
}

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function mountIntroOverlay({ reducedMotion = false, onClose } = {}) {
  const overlay = el("div", {
    className: "intro-overlay",
    attrs: {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "intro-tagline",
      "aria-describedby": "intro-script",
      "data-intro": "overlay",
    },
  });
  const video = el("video", {
    className: "intro-video",
    attrs: {
      poster: INTRO_POSTER,
      preload: "none",
      playsinline: "",
      "aria-label": "Honey Charts intro",
    },
  });
  video.muted = true;
  video.playsInline = true;
  video.autoplay = !reducedMotion;
  const source = el("source", { attrs: { type: "video/mp4" } });
  const track = el("track", {
    attrs: {
      kind: "captions",
      src: INTRO_CAPTIONS,
      srclang: "en",
      label: "English",
    },
  });
  video.append(source, track);
  video.addEventListener("loadedmetadata", () => {
    const cues = video.textTracks && video.textTracks[0];
    if (cues) cues.mode = "hidden";
  });

  const ui = el("div", { className: "intro-ui" });
  const tagline = el("p", {
    className: "intro-tagline",
    attrs: { id: "intro-tagline" },
    text: INTRO_TAGLINE,
  });
  if (!reducedMotion) tagline.setAttribute("hidden", "");
  const captions = el("p", { className: "intro-captions", attrs: { "aria-hidden": "true" } });
  const script = el("p", {
    className: "visually-hidden",
    attrs: { id: "intro-script" },
    text: introScript(),
  });
  const actions = el("div", { className: "intro-actions" });
  const sound = el("button", {
    className: "primary intro-sound",
    text: "Tap for sound",
    attrs: { type: "button" },
  });
  const play = el("button", {
    className: "primary intro-play",
    text: "Play intro",
    attrs: { type: "button" },
  });
  if (!reducedMotion) play.setAttribute("hidden", "");
  const skip = el("button", {
    className: "ghost intro-skip",
    text: "Skip",
    attrs: { type: "button" },
  });
  const enter = el("button", {
    className: "ghost intro-enter",
    text: "Enter the hive",
    attrs: { type: "button" },
  });
  actions.append(sound, play, skip, enter);
  ui.append(tagline, captions, script, actions);
  overlay.append(video, ui);
  document.body.append(overlay);
  document.body.classList.add("intro-open");

  let closed = false;
  let soundStarted = false;

  const paint = () => {
    captions.textContent = cueAt(video.currentTime || 0);
    const showLine = reducedMotion || taglineVisible(video.currentTime, video.duration);
    if (showLine) tagline.removeAttribute("hidden");
  };

  const startMuted = () => {
    video.muted = true;
    const pending = video.play();
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {
        if (video.paused) play.removeAttribute("hidden");
      });
    }
  };
  video.addEventListener("playing", () => {
    play.setAttribute("hidden", "");
  });

  sound.addEventListener("click", () => {
    if (!soundStarted) {
      soundStarted = true;
      const restart = () => {
        try { video.currentTime = 0; } catch { /* metadata may not be in yet */ }
      };
      if (video.readyState >= 1) restart();
      else video.addEventListener("loadedmetadata", restart, { once: true });
    }
    video.muted = !video.muted;
    sound.textContent = video.muted ? "Tap for sound" : "Sound on";
    play.setAttribute("hidden", "");
    const pending = video.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
    paint();
  });

  play.addEventListener("click", () => {
    video.muted = true;
    startMuted();
  });
  skip.addEventListener("click", () => finish(true));
  enter.addEventListener("click", () => finish(true));
  video.addEventListener("timeupdate", paint);
  video.addEventListener("ended", () => finish(true));

  source.src = INTRO_VIDEO;
  video.load();
  if (reducedMotion) {
    captions.textContent = INTRO_LINES[0];
  } else {
    startMuted();
    paint();
  }
  enter.focus();

  function finish(remember) {
    if (closed) return;
    closed = true;
    video.pause();
    if (typeof onClose === "function") onClose(Boolean(remember));
    overlay.classList.add("is-leaving");
    const wait = reducedMotion ? 0 : 480;
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.classList.remove("intro-open");
    }, wait);
  }

  return {
    isOpen() { return !closed; },
    finish() { finish(true); },
    dismiss() { finish(false); },
  };
}
