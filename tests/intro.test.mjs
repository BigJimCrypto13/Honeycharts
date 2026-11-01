import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { memoryStorage, readIntroSeen, markIntroSeen, INTRO_KEY } from "../js/store.js";
import {
  INTRO_LINES,
  INTRO_TAGLINE,
  cueAt,
  introScript,
  shouldShowIntro,
  taglineVisible,
} from "../js/intro.js";

describe("intro video", () => {
  it("uses the voiceover script as the captions", () => {
    const script = readFileSync(new URL("../assets/intro/script.txt", import.meta.url), "utf8").trim();
    assert.equal(introScript(), script);
    const vtt = readFileSync(new URL("../assets/intro/captions.vtt", import.meta.url), "utf8");
    for (const line of INTRO_LINES) assert.match(vtt, new RegExp(line.replace(/[.]/g, "\\.")));
    assert.equal(cueAt(0), "Welcome to the hive.");
    assert.equal(cueAt(14.9), "Honey Charts.");
    assert.equal(taglineVisible(10, 15), false);
    assert.equal(taglineVisible(12, 15), true);
    assert.equal(INTRO_TAGLINE, "Honey Charts. Where the buzz starts. Join the hive.");
  });

  it("plays on the first home visit and stays off token links", () => {
    assert.equal(shouldShowIntro("home", false), true);
    assert.equal(shouldShowIntro("home", true), false);
    assert.equal(shouldShowIntro("home", true, true), true);
    assert.equal(shouldShowIntro("token", false), false);
    assert.equal(shouldShowIntro("token", false, true), false);
    assert.equal(shouldShowIntro("wallet", false), false);
    const storage = memoryStorage();
    assert.equal(readIntroSeen(storage), false);
    assert.equal(markIntroSeen(storage), true);
    assert.equal(storage.getItem(INTRO_KEY), "1");
    assert.equal(readIntroSeen(storage), true);
  });

  it("autoplays muted, keeps a skip control, and can be replayed from home", () => {
    const source = readFileSync(new URL("../js/intro.js", import.meta.url), "utf8");
    const home = readFileSync(new URL("../js/home-view.js", import.meta.url), "utf8");
    assert.match(source, /video\.muted = true/);
    assert.match(source, /playsInline = true/);
    assert.match(source, /preload: "none"/);
    assert.match(source, /Tap for sound/);
    assert.match(source, /currentTime = 0/);
    assert.match(source, /Enter the hive/);
    assert.match(source, /text: "Skip"/);
    assert.match(source, /prefers-reduced-motion/);
    assert.match(home, /Watch intro/);
    assert.equal(readFileSync(new URL("../assets/intro/honeycharts-intro-web.mp4", import.meta.url)).length > 1000000, true);
    assert.equal(readFileSync(new URL("../assets/intro/honeycharts-intro-poster.jpg", import.meta.url)).length > 1000, true);
  });
});
