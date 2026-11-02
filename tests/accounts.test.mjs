import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FEE_BPS, JUPITER_REFERRAL_ACCOUNT, LAUNCH_ENABLED } from "../js/config.js";
import { GOOGLE_AUTH_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from "../js/auth-config.js";
import { editProfilePath, profilePath, routeFromSearch } from "../js/paths.js";
import {
  ACCOUNTS_OFFLINE,
  HIVE_LEAD_LOCAL,
  RESERVED_USERNAMES,
  SAMPLE_PROFILE,
  cleanProfileDraft,
  followCountLabel,
  friendlyAuthError,
  hiveLeadFor,
  isSchemaOffline,
  localPreviewKind,
  mergeHiveLists,
  parseSongUrl,
  safeAvatarUrl,
  solanaAddressFromUser,
  songPlayerPlan,
  validateAvatarFile,
  validateEmail,
  validateUsername,
} from "../js/account-logic.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const POPCAT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";

describe("usernames", () => {
  it("accepts a normal username and normalizes case", () => {
    assert.deepEqual(validateUsername("  BigJim "), { ok: true, username: "bigjim" });
    assert.equal(validateUsername("ab").ok, false);
    assert.equal(validateUsername("a".repeat(21)).ok, false);
    assert.equal(validateUsername("1hive").ok, false);
    assert.equal(validateUsername("big-jim").ok, false);
    assert.equal(validateUsername("big__jim").ok, false);
    assert.equal(validateUsername("bigjim_").ok, false);
    assert.match(validateUsername("hive").error, /reserved/);
    assert.match(validateUsername("HoneyCharts").error, /reserved/);
    assert.equal(validateUsername("").ok, false);
    assert.equal(validateUsername(null).ok, false);
  });

  it("keeps the reserved list in the SQL check", () => {
    const sql = readFileSync(new URL("../supabase/migrations/001_accounts.sql", import.meta.url), "utf8");
    for (const name of RESERVED_USERNAMES) assert.match(sql, new RegExp(`'${name}'`));
    assert.match(sql, /enable row level security/);
    assert.match(sql, /auth\.uid\(\) = id/);
    assert.match(sql, /auth\.uid\(\) = user_id/);
    assert.match(sql, /auth\.uid\(\) = follower_id/);
    assert.match(sql, /hive_public is true/);
    assert.match(sql, /bucket_id = 'avatars'/);
    assert.match(sql, /hive_public boolean not null default true/);
    assert.doesNotMatch(sql, /service_role|eyJ/);
  });
});

describe("profile songs", () => {
  it("parses mp3, YouTube, and SoundCloud without starting playback", () => {
    const mp3 = parseSongUrl("https://cdn.example.com/hive/song.mp3?x=1");
    assert.equal(mp3.ok, true);
    assert.equal(mp3.song.kind, "audio");
    assert.equal(songPlayerPlan(mp3.song).autoplay, false);
    assert.equal(songPlayerPlan(mp3.song).showPlayButton, true);

    const watch = parseSongUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    assert.equal(watch.song.kind, "youtube");
    assert.match(watch.song.embedUrl, /youtube-nocookie\.com\/embed\/jNQXAC9IVRw\?autoplay=0/);

    const short = parseSongUrl("https://youtu.be/jNQXAC9IVRw");
    assert.equal(short.song.videoId, "jNQXAC9IVRw");
    const shorts = parseSongUrl("https://www.youtube.com/shorts/jNQXAC9IVRw");
    assert.equal(shorts.song.videoId, "jNQXAC9IVRw");

    const sound = parseSongUrl("https://soundcloud.com/artist/track-name");
    assert.equal(sound.song.kind, "soundcloud");
    assert.match(sound.song.embedUrl, /auto_play=false/);
    assert.doesNotMatch(sound.song.embedUrl, /auto_play=true/);

    assert.equal(parseSongUrl("").song, null);
    assert.equal(parseSongUrl("http://cdn.example.com/a.mp3").ok, false);
    assert.equal(parseSongUrl("javascript:alert(1)").ok, false);
    assert.equal(parseSongUrl("https://soundcloud.com/").ok, false);
    assert.equal(parseSongUrl("https://example.com/not-audio").ok, false);
    assert.equal(parseSongUrl("https://www.youtube.com/watch?v=short").ok, false);
  });

  it("cleans a profile draft and rejects a bad song", () => {
    const good = cleanProfileDraft({
      username: "BigJim",
      displayName: "Big Jim",
      bio: "Watching the hive.",
      website: "https://bigjimcrypto13.github.io/Honeycharts/",
      xHandle: "https://x.com/bigjimcrypto",
      telegram: "@bigjimcrypto",
      solanaAddress: BONK,
      songUrl: "https://cdn.example.com/bee.mp3",
      songTitle: "Flight of the Bumblebee",
      hivePublic: false,
    });
    assert.equal(good.ok, true);
    assert.equal(good.values.username, "bigjim");
    assert.equal(good.values.xHandle, "bigjimcrypto");
    assert.equal(good.values.telegram, "bigjimcrypto");
    assert.equal(good.values.hivePublic, false);
    assert.equal(good.values.songUrl, "https://cdn.example.com/bee.mp3");

    const bad = cleanProfileDraft({ username: "no", songUrl: "notaurl", website: "http://x.test" });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.username);
    assert.ok(bad.errors.songUrl);
    assert.ok(bad.errors.website);
  });
});

describe("hive merge", () => {
  it("unions local and remote mints, keeps the earlier time, and keeps local notes", () => {
    const local = [
      { ca: BONK, note: "watch", addedAt: 200, name: "Bonk", symbol: "BONK" },
      { ca: WIF, note: "", addedAt: 500, name: "", symbol: "" },
    ];
    const remote = [
      { mint: BONK, added_at: "1970-01-01T00:00:00.100Z" },
      { mint: POPCAT, added_at: "1970-01-01T00:00:00.300Z" },
      { mint: "not-a-mint", added_at: "1970-01-01T00:00:00.000Z" },
    ];
    const merged = mergeHiveLists(local, remote, 200);
    const bonk = merged.tokens.find((token) => token.ca === BONK);
    assert.equal(bonk.note, "watch");
    assert.equal(bonk.name, "Bonk");
    assert.equal(bonk.addedAt, 100);
    assert.equal(merged.tokens.some((token) => token.ca === WIF), true);
    assert.equal(merged.tokens.some((token) => token.ca === POPCAT), true);
    assert.equal(merged.tokens.some((token) => token.ca === "not-a-mint"), false);
    assert.deepEqual(merged.toUpload.map((item) => item.mint).sort(), [WIF]);
    assert.equal(merged.dropped, 0);
  });

  it("keeps local rows when the cap is hit, then fills with the oldest remote-only mints", () => {
    const local = [{ ca: BONK, note: "stay", addedAt: 50, name: "", symbol: "" }];
    const remote = [
      { mint: WIF, added_at: 20 },
      { mint: POPCAT, added_at: 10 },
      { mint: BONK, added_at: 40 },
    ];
    const merged = mergeHiveLists(local, remote, 2);
    assert.deepEqual(merged.tokens.map((token) => token.ca), [BONK, POPCAT]);
    assert.equal(merged.tokens[0].note, "stay");
    assert.equal(merged.tokens[0].addedAt, 40);
    assert.equal(merged.dropped, 1);
    assert.deepEqual(merged.toUpload, []);
  });

  it("uploads an earlier local time and ignores a signed-out shape", () => {
    const merged = mergeHiveLists(
      [{ ca: BONK, note: "", addedAt: 10, name: "", symbol: "" }],
      [{ mint: BONK, addedAt: 30 }],
    );
    assert.equal(merged.tokens[0].addedAt, 10);
    assert.deepEqual(merged.toUpload, [{ mint: BONK, addedAt: 10 }]);
    assert.equal(hiveLeadFor({ signedIn: false, schema: "ready" }), "");
    assert.match(hiveLeadFor({ signedIn: true, schema: "ready" }), /copied to your account/);
    assert.match(hiveLeadFor({ signedIn: true, schema: "offline" }), /coming online/);
    assert.match(HIVE_LEAD_LOCAL, /this browser only/);
  });
});

describe("account routes and flags", () => {
  it("routes public profiles without taking over a token link", () => {
    assert.deepEqual(routeFromSearch("?u=BigJim"), { name: "profile", username: "BigJim" });
    assert.equal(routeFromSearch("?view=edit-profile").name, "edit-profile");
    assert.equal(routeFromSearch(`?ca=${BONK}&u=bigjim`).name, "token");
    assert.equal(routeFromSearch("?view=hive").name, "hive");
    assert.equal(profilePath("/Honeycharts/", "big jim"), "/Honeycharts/?u=big%20jim");
    assert.equal(editProfilePath("/Honeycharts/"), "/Honeycharts/?view=edit-profile");
    assert.equal(localPreviewKind({ hostname: "127.0.0.1", search: "?preview=profile" }), "profile");
    assert.equal(localPreviewKind({ hostname: "bigjimcrypto13.github.io", search: "?preview=profile" }), "");
  });

  it("keeps fees, launch, and the Google switch where they are", () => {
    assert.equal(JUPITER_REFERRAL_ACCOUNT, "6QwK1AUisPZrKHRYuYforGxNnY8hVGMjcvhEWAb5csDU");
    assert.equal(FEE_BPS, 50);
    assert.equal(LAUNCH_ENABLED, false);
    assert.equal(GOOGLE_AUTH_ENABLED, false);
    assert.equal(SUPABASE_URL, "https://hqqmarbovsgvyfjzxqjj.supabase.co");
    assert.match(SUPABASE_ANON_KEY, /^sb_publishable_/);
    const accounts = readFileSync(new URL("../js/accounts.js", import.meta.url), "utf8");
    const ui = readFileSync(new URL("../js/account-ui.js", import.meta.url), "utf8");
    const swap = readFileSync(new URL("../js/swap.js", import.meta.url), "utf8");
    assert.match(accounts, /signInWithWeb3\(\{/);
    assert.match(accounts, /chain: "solana"/);
    assert.match(ui, /GOOGLE_AUTH_ENABLED/);
    assert.match(ui, /Join the hive/);
    assert.match(ui, /text: "Play"/);
    assert.doesNotMatch(ui, /autoplay/);
    assert.match(swap, /enableWalletPassthrough: false/);
    assert.doesNotMatch(accounts + ui, /signTransaction|service_role/);
  });

  it("recognizes a missing table and a wallet address on the user", () => {
    assert.equal(isSchemaOffline({ code: "PGRST205", message: "Could not find the table public.profiles in the schema cache" }), true);
    assert.equal(isSchemaOffline({ code: "42P01", message: 'relation "profiles" does not exist' }), true);
    assert.equal(isSchemaOffline({ message: "permission denied" }), false);
    assert.equal(friendlyAuthError({ code: "PGRST205", message: "schema cache" }), ACCOUNTS_OFFLINE);
    const address = solanaAddressFromUser({
      identities: [{ identity_data: { address: BONK } }],
    });
    assert.equal(address, BONK);
    assert.equal(solanaAddressFromUser({ user_metadata: { solana_address: "not-an-address" } }), "");
    assert.equal(validateEmail("Bee@Hive.test").email, "bee@hive.test");
    assert.equal(validateEmail("nope").ok, false);
    assert.equal(validateAvatarFile({ type: "image/png", size: 1000 }).ok, true);
    assert.equal(validateAvatarFile({ type: "image/svg+xml", size: 1000 }).ok, false);
    assert.equal(validateAvatarFile({ type: "image/png", size: 3 * 1024 * 1024 }).ok, false);
    assert.equal(
      safeAvatarUrl(`https://hqqmarbovsgvyfjzxqjj.supabase.co/storage/v1/object/public/avatars/u/a.png`, "hqqmarbovsgvyfjzxqjj.supabase.co"),
      "https://hqqmarbovsgvyfjzxqjj.supabase.co/storage/v1/object/public/avatars/u/a.png",
    );
    assert.equal(safeAvatarUrl("https://evil.example/a.png", "hqqmarbovsgvyfjzxqjj.supabase.co"), "");
    assert.match(followCountLabel(12, 3), /12 followers · 3 following/);
    assert.equal(SAMPLE_PROFILE.username, "bigjim");
    assert.equal(parseSongUrl(SAMPLE_PROFILE.songUrl).song.kind, "youtube");
  });
});
