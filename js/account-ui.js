// Sign-in modal, header chip, public profile, and edit profile.
// Text is written with text nodes. Wallet use is login-message signing only.

import { AUTH_SITE_URL, GOOGLE_AUTH_ENABLED, SUPABASE_URL } from "./auth-config.js";
import {
  ACCOUNTS_OFFLINE,
  SAMPLE_PROFILE,
  cleanProfileDraft,
  followCountLabel,
  friendlyAuthError,
  hiveLeadFor,
  isSchemaOffline,
  parseSongUrl,
  safeAvatarUrl,
  supabaseHostFrom,
  validateAvatarFile,
  validateEmail,
  validatePassword,
  validateUsername,
} from "./account-logic.js";
import {
  ensureProfile,
  fetchFollowCounts,
  fetchProfileByUsername,
  fetchPublicHive,
  fetchViewerFollow,
  loadSupabase,
  probeSchema,
  pushHiveMint,
  removeHiveMint,
  replaceRemoteHive,
  saveProfile,
  setAvatarUrl,
  setFollow,
  signInWithSolanaWallet,
  syncHive,
  uploadAvatar,
} from "./accounts.js";
import { listLoginWallets } from "./auth-wallet.js";
import { el, clear, externalLink } from "./dom.js";
import { appBase, editProfilePath, profilePath, tokenPath, walletPath } from "./paths.js";

const HOST = supabaseHostFrom(SUPABASE_URL);

export function startAccounts(options) {
  const hive = options.hive;
  const state = {
    schema: "loading",
    session: null,
    profile: null,
    client: null,
    menu: false,
  };
  let queue = Promise.resolve();
  let syncedFor = "";
  let pageTicket = 0;
  let dialog = null;

  function enqueue(task) {
    queue = queue.then(task, task);
    return queue;
  }

  function user() {
    return state.session && state.session.user ? state.session.user : null;
  }

  function snapshot() {
    return { signedIn: Boolean(user()), schema: state.schema };
  }

  function paintHeader() {
    const slot = document.getElementById("account-slot");
    if (!slot) return;
    clear(slot);
    if (!user()) {
      slot.append(el("button", {
        className: "join-hive primary",
        text: "Join the hive",
        attrs: { type: "button" },
        on: { click: openSignIn },
      }));
      return;
    }
    const profile = state.profile;
    const label = (profile && (profile.displayName || profile.username)) || (user().email || "Account");
    const chip = el("button", {
      className: "account-chip",
      attrs: { type: "button", "aria-haspopup": "menu", "aria-expanded": state.menu ? "true" : "false" },
      on: { click: () => { state.menu = !state.menu; paintHeader(); } },
    }, [
      avatarNode(profile, label, "account-avatar"),
      el("span", { className: "account-label", text: label }),
    ]);
    slot.append(chip);
    if (!state.menu) return;
    const menu = el("div", { className: "account-pop", attrs: { role: "menu" } });
    if (profile && profile.username) {
      menu.append(menuLink("View profile", profilePath(location.pathname, profile.username)));
    }
    menu.append(menuLink(profile && profile.username ? "Edit profile" : "Finish your profile", editProfilePath(location.pathname)));
    menu.append(el("button", {
      className: "account-pop-item",
      text: "Sign out",
      attrs: { type: "button", role: "menuitem" },
      on: { click: () => { state.menu = false; signOut(); } },
    }));
    slot.append(menu);
  }

  function menuLink(text, href) {
    return el("a", {
      className: "account-pop-item",
      text,
      attrs: { href, role: "menuitem" },
      on: { click: () => { state.menu = false; } },
    });
  }

  async function boot() {
    paintHeader();
    try {
      state.client = await loadSupabase();
    } catch {
      state.schema = "unreachable";
      paintHeader();
      if (options.preview === "signin") openSignIn();
      return;
    }
    state.client.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") {
        state.session = session;
        return;
      }
      state.session = session;
      enqueue(() => afterAuth());
    });
    const { data } = await state.client.auth.getSession();
    if (!state.session) state.session = data.session || null;
    await enqueue(() => afterAuth());
    if (options.preview === "signin") openSignIn();
  }

  async function afterAuth() {
    if (!user()) {
      syncedFor = "";
      state.profile = null;
      const probed = await probeSchema(state.client);
      state.schema = probed === "ready" ? "ready" : probed === "offline" ? "offline" : "unreachable";
      paintHeader();
      return;
    }
    const result = await ensureProfile(state.client, user());
    state.schema = result.schema === "ready" ? "ready" : result.schema === "offline" ? "offline" : "unreachable";
    state.profile = result.profile;
    paintHeader();
    if (state.schema !== "ready" || syncedFor === user().id) return;
    syncedFor = user().id;
    const synced = await syncHive(state.client, user().id, hive.list());
    if (isSchemaOffline(synced.error)) {
      state.schema = "offline";
      syncedFor = "";
      paintHeader();
      if (options.onHiveReplaced) options.onHiveReplaced();
      return;
    }
    if (!synced.error && synced.tokens) {
      hive.replaceAll(synced.tokens);
      if (options.onHiveReplaced) options.onHiveReplaced();
    }
  }

  function noteHiveChange(change) {
    if (!user() || state.schema !== "ready" || !change) return;
    const userId = user().id;
    enqueue(async () => {
      let result = { error: null };
      if (change.type === "add" && change.token) result = await pushHiveMint(state.client, userId, change.token);
      else if (change.type === "remove" && change.ca) result = await removeHiveMint(state.client, userId, change.ca);
      else if (change.type === "replace") result = await replaceRemoteHive(state.client, userId, hive.list());
      else if (change.type === "merge") {
        const synced = await syncHive(state.client, userId, hive.list());
        if (!synced.error && synced.tokens) {
          hive.replaceAll(synced.tokens);
          if (options.onHiveReplaced) options.onHiveReplaced();
        }
        result = synced;
      }
      if (isSchemaOffline(result.error)) {
        state.schema = "offline";
        syncedFor = "";
        paintHeader();
      }
    });
  }

  function openSignIn() {
    closeDialog();
    dialog = buildDialog();
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function closeDialog() {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    dialog.remove();
    dialog = null;
  }

  function buildDialog() {
    const node = el("dialog", {
      className: "account-dialog",
      attrs: { "aria-labelledby": "account-title" },
    });
    const card = el("div", { className: "account-card" });
    card.append(el("div", { className: "account-card-head" }, [
      el("h2", { attrs: { id: "account-title" }, text: "Join the hive" }),
      el("button", {
        className: "ghost",
        text: "Close",
        attrs: { type: "button" },
        on: { click: closeDialog },
      }),
    ]));
    card.append(el("p", {
      className: "muted",
      text: "Sign in with email, or with Phantom or Solflare. A Solana sign-in only signs a login message. It does not send a transaction or move tokens.",
    }));
    if (state.schema === "offline" || state.schema === "unreachable" || !state.client) {
      card.append(el("p", { className: "banner", text: ACCOUNTS_OFFLINE }));
    }
    const message = el("p", { className: "account-message", attrs: { role: "status" } });
    card.append(message);
    if (!state.client) {
      node.append(card);
      node.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeDialog();
      });
      node.addEventListener("click", (event) => {
        if (event.target === node) closeDialog();
      });
      return node;
    }
    card.append(emailForm(message));
    card.append(passwordForm(message));
    card.append(solanaBlock(message));
    if (GOOGLE_AUTH_ENABLED) card.append(googleButton(message));
    node.append(card);
    node.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    node.addEventListener("click", (event) => {
      if (event.target === node) closeDialog();
    });
    return node;
  }

  function emailForm(message) {
    const form = el("form", { className: "account-form" });
    const input = el("input", {
      attrs: { id: "account-email", type: "email", autocomplete: "email", maxlength: "254", required: "true" },
    });
    form.append(labeled("Email", input));
    form.append(el("button", { className: "primary", text: "Email me a sign-in link", attrs: { type: "submit" } }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const checked = validateEmail(input.value);
      if (!checked.ok) {
        message.textContent = checked.error;
        return;
      }
      message.textContent = "Sending the sign-in link…";
      const { error } = await state.client.auth.signInWithOtp({
        email: checked.email,
        options: { emailRedirectTo: authReturnUrl() },
      });
      message.textContent = error
        ? friendlyAuthError(error)
        : "Check your email for the sign-in link. It opens Honey Charts in this browser.";
    });
    return form;
  }

  function passwordForm(message) {
    const wrap = el("div", { className: "account-password" });
    const password = el("input", {
      attrs: { id: "account-password", type: "password", autocomplete: "current-password", maxlength: "72" },
    });
    const email = el("input", {
      attrs: { id: "account-password-email", type: "email", autocomplete: "username", maxlength: "254" },
    });
    let open = false;
    const panel = el("div", { className: "account-form" });
    const toggle = el("button", {
      className: "ghost",
      text: "Use a password instead",
      attrs: { type: "button", "aria-expanded": "false" },
      on: {
        click: () => {
          open = !open;
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          panel.hidden = !open;
        },
      },
    });
    panel.hidden = true;
    panel.append(labeled("Email", email));
    panel.append(labeled("Password", password));
    const row = el("div", { className: "account-actions" });
    row.append(el("button", {
      className: "primary",
      text: "Sign in",
      attrs: { type: "button" },
      on: { click: () => passwordAuth("sign-in", email, password, message) },
    }));
    row.append(el("button", {
      className: "ghost",
      text: "Create account",
      attrs: { type: "button" },
      on: { click: () => passwordAuth("sign-up", email, password, message) },
    }));
    panel.append(row);
    wrap.append(toggle, panel);
    return wrap;
  }

  async function passwordAuth(mode, emailInput, passwordInput, message) {
    const email = validateEmail(emailInput.value);
    if (!email.ok) {
      message.textContent = email.error;
      return;
    }
    const password = validatePassword(passwordInput.value);
    if (!password.ok) {
      message.textContent = password.error;
      return;
    }
    message.textContent = mode === "sign-up" ? "Creating the account…" : "Signing in…";
    const result = mode === "sign-up"
      ? await state.client.auth.signUp({
        email: email.email,
        password: password.password,
        options: { emailRedirectTo: authReturnUrl() },
      })
      : await state.client.auth.signInWithPassword({
        email: email.email,
        password: password.password,
      });
    if (result.error) {
      message.textContent = friendlyAuthError(result.error);
      return;
    }
    if (mode === "sign-up" && !result.data.session) {
      message.textContent = "Check your email to confirm the account, then sign in.";
      return;
    }
    closeDialog();
  }

  function solanaBlock(message) {
    const block = el("div", { className: "account-solana" });
    block.append(el("p", {
      className: "fine",
      text: "Sign in with Solana uses your own Phantom or Solflare wallet. Honey Charts never asks for a wallet secret.",
    }));
    const wallets = listLoginWallets();
    if (!wallets.length) {
      block.append(el("p", {
        className: "muted",
        text: "Phantom or Solflare was not found in this browser. Install one, then reopen this window. Email sign-in still works.",
      }));
      return block;
    }
    for (const wallet of wallets) {
      block.append(el("button", {
        className: "primary",
        text: `Sign in with ${wallet.name}`,
        attrs: { type: "button" },
        on: { click: () => solanaSignIn(wallet, message) },
      }));
    }
    return block;
  }

  async function solanaSignIn(wallet, message) {
    message.textContent = `Waiting for ${wallet.name} to sign the login message…`;
    try {
      const { error } = await signInWithSolanaWallet(state.client, wallet.provider);
      if (error) {
        message.textContent = friendlyAuthError(error);
        return;
      }
      closeDialog();
    } catch (error) {
      message.textContent = friendlyAuthError(error);
    }
  }

  function googleButton(message) {
    return el("button", {
      className: "ghost",
      text: "Continue with Google",
      attrs: { type: "button" },
      on: {
        click: async () => {
          message.textContent = "Opening Google…";
          const { error } = await state.client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: authReturnUrl() },
          });
          if (error) message.textContent = friendlyAuthError(error);
        },
      },
    });
  }

  function showProfile(root, username) {
    const ticket = ++pageTicket;
    clear(root);
    const checked = validateUsername(typeof username === "string" ? username : "");
    if (!checked.ok) {
      root.append(noticePage("That profile link is not valid.", checked.error));
      return;
    }
    root.append(noticePage("Loading profile…", ""));
    enqueue(async () => {
      await readyClient();
      if (ticket !== pageTicket) return;
      if (state.schema === "offline" || state.schema === "unreachable" || !state.client) {
        clear(root);
        root.append(noticePage("Accounts are coming online", ACCOUNTS_OFFLINE));
        return;
      }
      const loaded = await fetchProfileByUsername(state.client, checked.username);
      if (ticket !== pageTicket) return;
      if (isSchemaOffline(loaded.error)) {
        state.schema = "offline";
        clear(root);
        root.append(noticePage("Accounts are coming online", ACCOUNTS_OFFLINE));
        return;
      }
      if (loaded.error) {
        clear(root);
        root.append(noticePage("Couldn't load that profile.", "Try again in a moment."));
        return;
      }
      if (!loaded.profile) {
        clear(root);
        root.append(noticePage("No profile uses that username.", "Usernames are chosen on Edit profile after signing in."));
        return;
      }
      const model = await decorateProfile(loaded.profile);
      if (ticket !== pageTicket) return;
      document.title = `${model.displayName || model.username} · Honey Charts`;
      clear(root);
      root.append(renderProfile(model, false));
    });
  }

  async function decorateProfile(profile) {
    const counts = await fetchFollowCounts(state.client, profile.id);
    const hiveResult = await fetchPublicHive(state.client, profile.id);
    let followingViewer = false;
    const viewer = user();
    if (viewer && viewer.id !== profile.id && !counts.error) {
      const rel = await fetchViewerFollow(state.client, viewer.id, profile.id);
      followingViewer = rel.following;
    }
    return {
      ...profile,
      followers: counts.followers,
      following: counts.following,
      followingViewer,
      hive: hiveResult.error ? [] : hiveResult.items,
      hiveHidden: profile.hivePublic === false && (!viewer || viewer.id !== profile.id),
    };
  }

  function showEdit(root) {
    const ticket = ++pageTicket;
    clear(root);
    if (!user()) {
      root.append(noticePage("Sign in to edit your profile.", "Join the hive to pick a username, avatar, and profile song."));
      const actions = el("p", {});
      actions.append(el("button", {
        className: "primary",
        text: "Join the hive",
        attrs: { type: "button" },
        on: { click: openSignIn },
      }));
      root.append(actions);
      return;
    }
    root.append(noticePage("Loading your profile…", ""));
    enqueue(async () => {
      await readyClient();
      if (ticket !== pageTicket) return;
      if (state.schema === "offline" || state.schema === "unreachable") {
        clear(root);
        root.append(noticePage("Accounts are coming online", ACCOUNTS_OFFLINE));
        return;
      }
      if (!state.profile) {
        const result = await ensureProfile(state.client, user());
        state.profile = result.profile;
        if (result.schema === "offline") state.schema = "offline";
      }
      if (ticket !== pageTicket) return;
      if (!state.profile || state.schema === "offline") {
        clear(root);
        root.append(noticePage("Accounts are coming online", ACCOUNTS_OFFLINE));
        return;
      }
      clear(root);
      root.append(renderEdit(state.profile, false));
    });
  }

  function showPreview(root, kind) {
    pageTicket += 1;
    clear(root);
    if (kind === "edit") root.append(renderEdit(SAMPLE_PROFILE, true));
    else root.append(renderProfile({ ...SAMPLE_PROFILE, hiveHidden: false }, true));
  }

  function renderProfile(model, preview) {
    const page = el("article", { className: "profile-page stack" });
    const head = el("header", { className: "profile-head panel" });
    head.append(avatarNode(model, model.displayName || model.username, "profile-avatar"));
    const copy = el("div", { className: "profile-copy" });
    copy.append(el("h1", { text: model.displayName || model.username || "Honey member" }));
    if (model.username) copy.append(el("p", { className: "profile-user", text: `@${model.username}` }));
    if (model.bio) copy.append(el("p", { text: model.bio }));
    copy.append(el("p", { className: "profile-counts", text: followCountLabel(model.followers, model.following) }));
    copy.append(renderLinks(model));
    copy.append(followControl(model, preview));
    head.append(copy);
    page.append(head);
    page.append(renderHiveSection(model));
    page.append(renderSong(model.songUrl, model.songTitle));
    return page;
  }

  function renderLinks(model) {
    const list = el("ul", { className: "profile-links" });
    if (model.website) {
      const link = externalLink(model.website, "Website", "text-link");
      if (link) list.append(el("li", {}, [link]));
    }
    if (model.xHandle) {
      list.append(el("li", {}, [externalLink(`https://x.com/${model.xHandle}`, `@${model.xHandle} on X`)]));
    }
    if (model.telegram) {
      list.append(el("li", {}, [externalLink(`https://t.me/${model.telegram}`, `@${model.telegram} on Telegram`)]));
    }
    if (model.solanaAddress) {
      list.append(el("li", {}, [
        el("a", {
          className: "text-link",
          text: "Public Solana address",
          attrs: { href: walletPath(location.pathname, model.solanaAddress) },
        }),
      ]));
    }
    return list;
  }

  function followControl(model, preview) {
    const viewer = user();
    if (!preview && viewer && state.profile && viewer.id === model.id) {
      return el("p", {}, [
        el("a", { className: "button", attrs: { href: editProfilePath(location.pathname) }, text: "Edit profile" }),
      ]);
    }
    if (!preview && !viewer) {
      return el("button", {
        className: "primary",
        text: "Join the hive to follow",
        attrs: { type: "button" },
        on: { click: openSignIn },
      });
    }
    let on = Boolean(model.followingViewer);
    const button = el("button", {
      className: on ? "ghost" : "primary",
      text: on ? "Unfollow" : "Follow",
      attrs: { type: "button", "aria-pressed": on ? "true" : "false" },
    });
    button.addEventListener("click", async () => {
      if (preview || !viewer) {
        on = !on;
        button.textContent = on ? "Unfollow" : "Follow";
        button.className = on ? "ghost" : "primary";
        button.setAttribute("aria-pressed", on ? "true" : "false");
        return;
      }
      button.disabled = true;
      const next = !on;
      const { error } = await setFollow(state.client, viewer.id, model.id, next);
      button.disabled = false;
      if (error) {
        if (options.setStatus) options.setStatus(isSchemaOffline(error) ? ACCOUNTS_OFFLINE : "Couldn't update that follow.");
        return;
      }
      on = next;
      button.textContent = on ? "Unfollow" : "Follow";
      button.className = on ? "ghost" : "primary";
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    return button;
  }

  function renderHiveSection(model) {
    const section = el("section", { className: "panel profile-hive" });
    section.append(el("h2", { text: "Hive" }));
    if (model.hiveHidden) {
      section.append(el("p", { text: "This Hive is private." }));
      return section;
    }
    const items = Array.isArray(model.hive) ? model.hive : [];
    if (!items.length) {
      section.append(el("p", { text: "This Hive is empty." }));
      return section;
    }
    const list = el("ul", { className: "profile-hive-list" });
    items.slice(0, 50).forEach((item) => {
      const mint = item.mint || item.ca;
      list.append(el("li", {}, [
        el("a", { attrs: { href: tokenPath(location.pathname, mint) }, text: shortMint(mint) }),
      ]));
    });
    section.append(list);
    if (items.length > 50) section.append(el("p", { className: "muted", text: `${items.length - 50} more` }));
    return section;
  }

  function renderSong(songUrl, songTitle) {
    const section = el("section", { className: "panel profile-song" });
    section.append(el("h2", { text: "Profile song" }));
    const parsed = parseSongUrl(songUrl || "");
    if (!songUrl) {
      section.append(el("p", { className: "muted", text: "No song yet." }));
      return section;
    }
    if (!parsed.ok || !parsed.song) {
      section.append(el("p", { text: "This song link needs to be updated." }));
      return section;
    }
    const title = songTitle || "Untitled";
    section.append(el("p", { className: "song-title", text: title }));
    section.append(el("p", { className: "fine", text: "Paused until you press play." }));
    const mount = el("div", { className: "song-mount" });
    const play = el("button", {
      className: "primary",
      text: "Play",
      attrs: { type: "button" },
      on: {
        click: () => {
          play.disabled = true;
          if (parsed.song.kind === "audio") {
            const audio = el("audio", { attrs: { controls: "true", preload: "none", src: parsed.song.src } });
            mount.append(audio);
            audio.play().catch(() => {
              section.append(el("p", { className: "field-error", text: "This link did not play. Paste an mp3 link, or a YouTube or SoundCloud link." }));
            });
            return;
          }
          mount.append(el("iframe", {
            className: "song-frame",
            attrs: {
              src: parsed.song.embedUrl,
              title: title,
              allow: "fullscreen",
              loading: "lazy",
            },
          }));
        },
      },
    });
    section.append(play, mount);
    return section;
  }

  function renderEdit(profile, preview) {
    const page = el("section", { className: "profile-edit stack" });
    page.append(el("h1", { text: "Edit profile" }));
    page.append(el("p", {
      className: "muted",
      text: "Your public page is ?u=username. The avatar is stored in your account. The song stays paused until a visitor presses play.",
    }));
    const message = el("p", { className: "account-message", attrs: { role: "status" } });
    const form = el("form", { className: "account-form panel" });
    const avatarRow = el("div", { className: "avatar-edit" });
    avatarRow.append(avatarNode(profile, profile.displayName || profile.username || "You", "profile-avatar"));
    const file = el("input", {
      attrs: { id: "avatar-file", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" },
    });
    avatarRow.append(labeled("Avatar", file));
    form.append(avatarRow);
    const fields = {
      username: textInput("username", profile.username || "", "Pick a public username"),
      displayName: textInput("display-name", profile.displayName || "", "Display name"),
      bio: textArea("bio", profile.bio || "", "Bio"),
      website: textInput("website", profile.website || "", "Website"),
      xHandle: textInput("x-handle", profile.xHandle || "", "X handle"),
      telegram: textInput("telegram", profile.telegram || "", "Telegram"),
      solanaAddress: textInput("solana-address", profile.solanaAddress || "", "Public Solana address"),
      songUrl: textInput("song-url", profile.songUrl || "", "Profile song link"),
      songTitle: textInput("song-title", profile.songTitle || "", "Song title"),
    };
    form.append(fieldBlock("Username", fields.username, "3–20 characters. Letters, numbers, and underscores. This becomes ?u=username."));
    form.append(fieldBlock("Display name", fields.displayName, ""));
    form.append(fieldBlock("Bio", fields.bio, "280 characters or fewer."));
    form.append(fieldBlock("Website", fields.website, "https only."));
    form.append(fieldBlock("X", fields.xHandle, "Handle only, without the @."));
    form.append(fieldBlock("Telegram", fields.telegram, "Username only."));
    form.append(fieldBlock("Public Solana address", fields.solanaAddress, "People can see this address. This form does not ask for a wallet secret and it does not send a transaction."));
    form.append(fieldBlock("Profile song", fields.songUrl, "An https mp3 link, or a YouTube or SoundCloud link."));
    form.append(fieldBlock("Song title", fields.songTitle, ""));
    const hivePublic = el("input", { attrs: { id: "hive-public", type: "checkbox" } });
    hivePublic.checked = profile.hivePublic !== false;
    const checkLabel = el("label", { className: "check-row", attrs: { for: "hive-public" } }, [
      hivePublic,
      el("span", { text: "Show my Hive on my public profile" }),
    ]);
    form.append(checkLabel);
    const errors = el("div", { className: "form-errors", attrs: { role: "alert" } });
    form.append(errors, message);
    form.append(el("button", { className: "primary", text: "Save profile", attrs: { type: "submit" } }));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const draft = cleanProfileDraft({
        username: fields.username.value,
        displayName: fields.displayName.value,
        bio: fields.bio.value,
        website: fields.website.value,
        xHandle: fields.xHandle.value,
        telegram: fields.telegram.value,
        solanaAddress: fields.solanaAddress.value,
        songUrl: fields.songUrl.value,
        songTitle: fields.songTitle.value,
        hivePublic: hivePublic.checked,
      });
      clear(errors);
      if (!draft.ok) {
        for (const text of Object.values(draft.errors)) errors.append(el("p", { className: "field-error", text }));
        return;
      }
      if (preview) {
        message.textContent = "This is a sample form on this computer. Nothing was saved.";
        return;
      }
      const chosen = file.files && file.files[0];
      if (chosen) {
        const avatar = validateAvatarFile(chosen);
        if (!avatar.ok) {
          errors.append(el("p", { className: "field-error", text: avatar.error }));
          return;
        }
      }
      message.textContent = "Saving…";
      if (chosen) {
        const uploaded = await uploadAvatar(state.client, user().id, chosen);
        if (uploaded.error) {
          message.textContent = isSchemaOffline(uploaded.error) ? ACCOUNTS_OFFLINE : "The avatar did not upload. The rest of the form was not saved.";
          return;
        }
        const savedAvatar = await setAvatarUrl(state.client, user().id, uploaded.publicUrl);
        if (savedAvatar.error) {
          message.textContent = "The avatar uploaded, but the profile did not update.";
          return;
        }
      }
      const saved = await saveProfile(state.client, user().id, draft.values);
      if (saved.error) {
        message.textContent = duplicateUsername(saved.error) ? "That username is taken." : friendlyAuthError(saved.error);
        return;
      }
      state.profile = saved.profile || { ...state.profile, ...draft.values, username: draft.values.username };
      if (chosen && state.profile) {
        const fresh = await ensureProfile(state.client, user());
        if (fresh.profile) state.profile = fresh.profile;
      }
      paintHeader();
      message.textContent = draft.values.username
        ? "Saved. Your public page is ready."
        : "Saved. Add a username when you want a public page.";
      if (draft.values.username && options.onHiveReplaced) options.onHiveReplaced();
    });
    page.append(form);
    return page;
  }

  async function readyClient() {
    if (state.client) {
      if (state.schema === "loading") {
        const probed = await probeSchema(state.client);
        state.schema = probed === "ready" ? "ready" : probed === "offline" ? "offline" : "unreachable";
      }
      return;
    }
    try {
      state.client = await loadSupabase();
      const probed = await probeSchema(state.client);
      state.schema = probed === "ready" ? "ready" : probed === "offline" ? "offline" : "unreachable";
    } catch {
      state.schema = "unreachable";
    }
  }

  async function signOut() {
    if (!state.client) return;
    await state.client.auth.signOut();
    state.session = null;
    state.profile = null;
    syncedFor = "";
    paintHeader();
    if (options.onSignedOut) options.onSignedOut();
  }

  document.addEventListener("pointerdown", (event) => {
    if (!state.menu) return;
    const slot = document.getElementById("account-slot");
    if (slot && slot.contains(event.target)) return;
    state.menu = false;
    paintHeader();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.menu) return;
    state.menu = false;
    paintHeader();
  });

  boot();

  return {
    hiveLead() {
      return hiveLeadFor(snapshot());
    },
    noteHiveChange,
    openSignIn,
    closeMenu() {
      if (!state.menu) return;
      state.menu = false;
      paintHeader();
    },
    showProfile,
    showEdit,
    showPreview,
    cancelPage() {
      pageTicket += 1;
    },
  };
}

function authReturnUrl() {
  if (typeof location === "undefined") return AUTH_SITE_URL;
  return `${location.origin}${appBase(location.pathname)}`;
}

function noticePage(title, body) {
  const section = el("section", { className: "panel empty profile-notice" });
  section.append(el("h1", { text: title }));
  if (body) section.append(el("p", { text: body }));
  return section;
}

function labeled(text, input) {
  const id = input.getAttribute("id");
  return el("label", { attrs: id ? { for: id } : {} }, [text, input]);
}

function fieldBlock(label, input, hint) {
  const block = el("div", { className: "field" });
  block.append(labeled(label, input));
  if (hint) block.append(el("p", { className: "fine", text: hint }));
  return block;
}

function textInput(id, value, placeholder) {
  const input = el("input", {
    attrs: { id, type: "text", autocomplete: "off", maxlength: "500", placeholder },
  });
  input.value = value;
  return input;
}

function textArea(id, value, placeholder) {
  const input = el("textarea", { attrs: { id, rows: "4", maxlength: "280", placeholder } });
  input.value = value;
  return input;
}

function avatarNode(profile, label, className) {
  const src = avatarSource(profile);
  if (src) {
    return el("img", {
      className,
      attrs: { src, alt: "", width: "96", height: "96" },
    });
  }
  const initial = (label || "?").trim().charAt(0).toUpperCase() || "?";
  return el("span", { className: `${className} avatar-fallback`, attrs: { "aria-hidden": "true" }, text: initial });
}

function avatarSource(profile) {
  if (!profile) return "";
  if (profile.previewAvatar && /^assets\/[a-z0-9._-]+$/i.test(profile.previewAvatar)) return profile.previewAvatar;
  return safeAvatarUrl(profile.avatarUrl, HOST);
}

function shortMint(mint) {
  if (typeof mint !== "string" || mint.length < 10) return mint || "";
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function duplicateUsername(error) {
  const code = error && error.code;
  const text = error && error.message ? error.message : "";
  return code === "23505" || /duplicate|unique/i.test(text);
}
