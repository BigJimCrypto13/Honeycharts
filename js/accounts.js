// Account network calls. The browser uses the publishable key only.

import { SUPABASE_ANON_KEY, SUPABASE_JS_URL, SUPABASE_URL } from "./auth-config.js";
import {
  isSchemaOffline,
  mergeHiveLists,
  profileFromRow,
  profileToRow,
  solanaAddressFromUser,
} from "./account-logic.js";
import { LOGIN_STATEMENT, prepareLoginWallet } from "./auth-wallet.js";

let clientPromise = null;

export function loadSupabase() {
  if (!clientPromise) clientPromise = importClient();
  return clientPromise;
}

async function importClient() {
  const mod = await import(SUPABASE_JS_URL);
  if (!mod || typeof mod.createClient !== "function") {
    throw new Error("accounts-library");
  }
  return mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // implicit puts the session in the link hash, so the link works in a
      // different browser than the one that asked for it. The 6-digit code
      // path does not use this redirect. PKCE links only work in the original
      // browser and failed silently when the email was opened on a phone.
      flowType: "implicit",
    },
  });
}

export async function probeSchema(client) {
  const { error } = await client.from("profiles").select("id").limit(1);
  if (!error) return "ready";
  if (isSchemaOffline(error)) return "offline";
  return "error";
}

export async function ensureProfile(client, user) {
  const id = user && user.id;
  if (!id) return { profile: null, schema: "error" };
  const { error: insertError } = await client.from("profiles").upsert(
    { id },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (isSchemaOffline(insertError)) return { profile: null, schema: "offline" };
  const { data, error } = await client.from("profiles").select("*").eq("id", id).maybeSingle();
  if (isSchemaOffline(error)) return { profile: null, schema: "offline" };
  if (error) return { profile: null, schema: "error", error };
  const profile = profileFromRow(data);
  const address = solanaAddressFromUser(user);
  if (profile && address && !profile.solanaAddress) {
    const { data: updated, error: updateError } = await client
      .from("profiles")
      .update({ solana_address: address })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (!updateError && updated) return { profile: profileFromRow(updated), schema: "ready" };
  }
  return { profile, schema: "ready" };
}

export async function saveProfile(client, id, values) {
  const row = profileToRow(id, values);
  const { data, error } = await client.from("profiles").upsert(row, { onConflict: "id" }).select("*").maybeSingle();
  return { profile: profileFromRow(data), error };
}

export async function uploadAvatar(client, userId, file) {
  const ext = avatarExt(file.type);
  const path = `${userId}/avatar.${ext}`;
  const { error } = await client.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) return { error, publicUrl: "" };
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data && data.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : "";
  return { error: null, publicUrl };
}

export async function setAvatarUrl(client, userId, publicUrl) {
  const { error } = await client.from("profiles").update({ avatar_url: publicUrl }).eq("id", userId);
  return { error };
}

export function signInWithSolanaWallet(client, provider) {
  return prepareLoginWallet(provider).then(() => client.auth.signInWithWeb3({
    chain: "solana",
    statement: LOGIN_STATEMENT,
    wallet: provider,
  }));
}

export async function queryUsername(client, username) {
  const { data, error } = await client.from("profiles").select("id").eq("username", username).maybeSingle();
  if (isSchemaOffline(error)) return { offline: true };
  if (error) return { error: true };
  return { taken: Boolean(data && data.id), id: data && data.id ? data.id : "" };
}

export async function fetchProfileByUsername(client, username) {
  const { data, error } = await client.from("profiles").select("*").eq("username", username).maybeSingle();
  if (error) return { profile: null, error };
  return { profile: profileFromRow(data), error: null };
}

export async function fetchFollowCounts(client, profileId) {
  const followers = await client.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", profileId);
  const following = await client.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", profileId);
  if (isSchemaOffline(followers.error) || isSchemaOffline(following.error)) {
    return { error: followers.error || following.error, followers: 0, following: 0 };
  }
  return {
    error: followers.error || following.error,
    followers: followers.count || 0,
    following: following.count || 0,
  };
}

export async function fetchViewerFollow(client, followerId, followingId) {
  const { data, error } = await client
    .from("follows")
    .select("follower_id")
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
    .maybeSingle();
  return { following: Boolean(data), error };
}

export async function setFollow(client, followerId, followingId, follow) {
  if (follow) {
    const { error } = await client.from("follows").insert({ follower_id: followerId, following_id: followingId });
    return { error };
  }
  const { error } = await client.from("follows").delete().eq("follower_id", followerId).eq("following_id", followingId);
  return { error };
}

export async function fetchPublicHive(client, userId) {
  const { data, error } = await client
    .from("hive_items")
    .select("mint, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: true });
  return { items: Array.isArray(data) ? data : [], error };
}

export async function syncHive(client, userId, localTokens) {
  const remote = await fetchPublicHive(client, userId);
  if (remote.error) return { error: remote.error, tokens: localTokens, uploaded: 0 };
  const merged = mergeHiveLists(localTokens, remote.items);
  if (!merged.toUpload.length) return { error: null, tokens: merged.tokens, uploaded: 0, dropped: merged.dropped };
  const { error } = await client.from("hive_items").upsert(merged.toUpload.map((item) => ({
    user_id: userId,
    mint: item.mint,
    added_at: new Date(item.addedAt).toISOString(),
  })), { onConflict: "user_id,mint" });
  return { error, tokens: merged.tokens, uploaded: merged.toUpload.length, dropped: merged.dropped };
}

export async function pushHiveMint(client, userId, token) {
  const { error } = await client.from("hive_items").upsert({
    user_id: userId,
    mint: token.ca,
    added_at: new Date(token.addedAt || Date.now()).toISOString(),
  }, { onConflict: "user_id,mint" });
  return { error };
}

export async function removeHiveMint(client, userId, mint) {
  const { error } = await client.from("hive_items").delete().eq("user_id", userId).eq("mint", mint);
  return { error };
}

export async function replaceRemoteHive(client, userId, tokens) {
  const remote = await fetchPublicHive(client, userId);
  if (remote.error) return { error: remote.error };
  const localMints = new Set(tokens.map((token) => token.ca));
  if (tokens.length) {
    const { error } = await client.from("hive_items").upsert(tokens.map((token) => ({
      user_id: userId,
      mint: token.ca,
      added_at: new Date(token.addedAt || Date.now()).toISOString(),
    })), { onConflict: "user_id,mint" });
    if (error) return { error };
  }
  const extras = remote.items.map((item) => item.mint).filter((mint) => mint && !localMints.has(mint));
  for (const mint of extras) {
    const { error } = await removeHiveMint(client, userId, mint);
    if (error) return { error };
  }
  return { error: null };
}

function avatarExt(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}
