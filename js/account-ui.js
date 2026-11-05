// Sign-in modal, header chip, public profile, and edit profile.
// Text is written with text nodes. Wallet use is login-message signing only.

import { AUTH_SITE_URL, GOOGLE_AUTH_ENABLED, SUPABASE_URL } from "./auth-config.js";
import {
  ACCOUNTS_OFFLINE,
  CROSS_BROWSER_LINK_ERROR,
  OTP_RESEND_SECONDS,
  SAMPLE_PROFILE,
  authCodeType,
  authReturnCleanPath,
  cleanProfileDraft,
  cleanWelcomeDraft,
  followCountLabel,
  friendlyAuthError,
  hiveLeadFor,
  isSchemaOffline,
  needsWelcome,
  otpResendState,
  parseAuthReturn,
  parseSongUrl,
  readPendingUsername,
  rememberUsername,
  safeAvatarUrl,
  supabaseHostFrom,
  usernameStatus,
  validateAvatarFile,
  validateEmail,
  validateOtpCode,
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
  queryUsername,
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
import { renderAccountWallets, renderHeaderWallets } from "./wallet-connect-ui.js";
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
  let resendTimer = 0;
  let usernameTimer = 0;
  let usernameTicket = 0;
  let announceSignIn = false;
  let linkToasted = false;
  let authView = { tab: "create", step: "form", email: "", mode: "signup", username: "" };
  const listeners = new Set();

  function emitAuth() {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // A listener cannot break sign-in.
      }
    }
  }

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
      const cluster = el("div", { className: "header-account" });
      const top = el("div", { className: "header-account-row" });
      top.append(el("button", {
        className: "join-hive primary",
        text: "Join the hive",
        attrs: { type: "button" },
        on: { click: () => openSignIn("create") },
      }));
      top.append(renderHeaderWallets(onWalletReady));
      cluster.append(top);
      slot.append(cluster);
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
    const authReturn = typeof location === "undefined" ? { kind: "none" } : parseAuthReturn(location.href);
    paintHeader();
    openPreview();
    try {
      state.client = await loadSupabase();
    } catch {
      state.schema = "unreachable";
      paintHeader();
      openPreview();
      return;
    }
    state.client.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") {
        state.session = session;
        emitAuth();
        return;
      }
      announceSignIn = event === "SIGNED_IN";
      state.session = session;
      enqueue(() => afterAuth());
    });
    const { data } = await state.client.auth.getSession();
    if (!state.session) state.session = data.session || null;
    await enqueue(() => afterAuth());
    await consumeAuthReturn(authReturn);
    openPreview();
  }

  function openPreview() {
    if (!options.preview || options.preview === "profile" || options.preview === "edit") return;
    if (dialog) return;
    if (options.preview === "code") {
      authView = { tab: "create", step: "code", email: "bee@hive.test", mode: "signup", username: "bigjim" };
      mountAuth();
      return;
    }
    if (options.preview === "welcome") {
      openWelcome();
      return;
    }
    openSignIn(options.preview === "wallets" ? "signin" : "create");
  }

  async function afterAuth() {
    if (!user()) {
      syncedFor = "";
      state.profile = null;
      const probed = await probeSchema(state.client);
      state.schema = probed === "ready" ? "ready" : probed === "offline" ? "offline" : "unreachable";
      paintHeader();
      emitAuth();
      return;
    }
    const result = await ensureProfile(state.client, user());
    state.schema = result.schema === "ready" ? "ready" : result.schema === "offline" ? "offline" : "unreachable";
    state.profile = result.profile;
    paintHeader();
    emitAuth();
    presentSession();
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

  function presentSession() {
    if (options.preview || !user()) return;
    const showWelcome = state.schema === "ready" && needsWelcome(state.profile);
    if (showWelcome) {
      openWelcome();
      return;
    }
    if (dialog && dialog.dataset.purpose === "auth") closeDialog();
    if (announceSignIn && !linkToasted) notify("Signed in.");
  }

  async function consumeAuthReturn(parsed) {
    if (!parsed || parsed.kind === "none" || !state.client) return;
    try {
      if (parsed.kind === "error") {
        notify(parsed.message);
        cleanAuthUrl();
        return;
      }
      if (parsed.kind === "code") {
        const { error } = await state.client.auth.exchangeCodeForSession(parsed.code);
        cleanAuthUrl();
        notify(error ? CROSS_BROWSER_LINK_ERROR : "Signed in.");
        return;
      }
      if (parsed.kind === "token_hash") {
        const { error } = await state.client.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.type,
        });
        cleanAuthUrl();
        notify(error ? friendlyAuthError(error) : "Signed in.");
        return;
      }
      if (parsed.kind === "implicit") {
        cleanAuthUrl();
        notify(user()
          ? "Signed in."
          : "That sign-in link did not finish. Enter the 6-digit code from the email on this page.");
      }
    } catch (error) {
      cleanAuthUrl();
      notify(friendlyAuthError(error));
    }
  }

  function notify(text) {
    linkToasted = true;
    if (options.setStatus && text) options.setStatus(text);
  }

  function cleanAuthUrl() {
    if (typeof location === "undefined") return;
    const next = authReturnCleanPath(location.href);
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (!next || next === current) return;
    history.replaceState(null, "", next);
  }

  function openSignIn(tab) {
    authView = {
      tab: tab === "signin" ? "signin" : "create",
      step: "form",
      email: "",
      mode: "signup",
      username: "",
    };
    mountAuth();
  }

  function mountAuth() {
    if (!dialog || dialog.dataset.purpose !== "auth") {
      closeDialog();
      dialog = el("dialog", {
        className: "account-dialog",
        attrs: { "aria-labelledby": "account-title" },
      });
      dialog.dataset.purpose = "auth";
      wireDialog(dialog);
      document.body.append(dialog);
      if (typeof dialog.showModal === "function") dialog.showModal();
    }
    paintAuth();
  }

  function paintAuth() {
    clearInterval(resendTimer);
    resendTimer = 0;
    clearTimeout(usernameTimer);
    usernameTimer = 0;
    clear(dialog);
    const card = el("div", { className: "account-card" });
    card.append(el("div", { className: "account-card-head" }, [
      el("h2", { attrs: { id: "account-title" }, text: authView.step === "code" ? "Enter your code" : "Join the hive" }),
      el("button", {
        className: "ghost",
        text: "Close",
        attrs: { type: "button" },
        on: { click: closeDialog },
      }),
    ]));
    card.append(el("p", {
      className: "muted",
      text: "Create an account with email, or sign in with Phantom or Solflare. A Solana sign-in only signs a login message. It does not send a transaction or move tokens.",
    }));
    if (state.schema === "offline" || state.schema === "unreachable") {
      card.append(el("p", { className: "banner", text: ACCOUNTS_OFFLINE }));
    }
    const message = el("p", { className: "account-message", attrs: { id: "account-message", role: "status" } });
    if (authView.step === "code") card.append(codePanel(message));
    else card.append(authTabs(), authForm(authView.tab));
    card.append(message);
    card.append(renderAccountWallets({ onReady: onWalletReady, onEmail: () => openSignIn("create") }));
    if (GOOGLE_AUTH_ENABLED) card.append(googleButton(message));
    dialog.append(card);
    if (authView.step === "code") startResendCountdown();
    if (options.preview === "wallets") {
      const block = dialog.querySelector("#wallet-connect");
      const card = dialog.querySelector(".account-card");
      if (block && card) card.scrollTop = Math.max(0, block.offsetTop - 120);
      return;
    }
    const focus = dialog.querySelector(authView.step === "code" ? "#account-code" : "input");
    if (focus) focus.focus();
  }

  function authTabs() {
    const tabs = el("div", { className: "account-tabs", attrs: { role: "tablist", "aria-label": "Account" } });
    tabs.append(authTab("create", "Create account"));
    tabs.append(authTab("signin", "Sign in"));
    return tabs;
  }

  function authTab(tab, text) {
    const selected = authView.tab === tab;
    return el("button", {
      className: "account-tab",
      text,
      attrs: { type: "button", role: "tab", "aria-selected": selected ? "true" : "false" },
      on: {
        click: () => {
          authView.tab = tab;
          authView.step = "form";
          paintAuth();
        },
      },
    });
  }

  function authForm(tab) {
    const creating = tab !== "signin";
    const form = el("form", { className: "account-form" });
    let username = null;
    let usernameNote = null;
    if (creating) {
      username = el("input", {
        attrs: { id: "account-username", type: "text", autocomplete: "username", maxlength: "20", required: "true" },
      });
      usernameNote = el("p", { className: "fine", attrs: { id: "username-status", role: "status" } });
      form.append(fieldBlock("Username", username, "3–20 characters. Letters, numbers, and underscores."));
      form.append(usernameNote);
      username.addEventListener("input", () => scheduleUsernameCheck(username, usernameNote));
    }
    const email = el("input", {
      attrs: {
        id: creating ? "account-email" : "account-signin-email",
        type: "email",
        autocomplete: "email",
        maxlength: "254",
        required: "true",
      },
    });
    const password = el("input", {
      attrs: {
        id: creating ? "account-password" : "account-signin-password",
        type: "password",
        autocomplete: creating ? "new-password" : "current-password",
        maxlength: "72",
        required: "true",
      },
    });
    form.append(fieldBlock("Email", email, ""));
    form.append(fieldBlock("Password", password, creating ? "At least 8 characters." : ""));
    form.append(el("button", {
      className: "primary",
      text: creating ? "Create account" : "Sign in",
      attrs: { type: "submit" },
    }));
    form.append(el("button", {
      className: "text-button",
      text: "Email me a code instead",
      attrs: { type: "button" },
      on: { click: () => sendEmailCode(email, username) },
    }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (creating) submitCreate(username, email, password);
      else submitSignIn(email, password);
    });
    return form;
  }

  function codePanel(message) {
    const form = el("form", { className: "account-form" });
    form.append(el("p", { text: `Enter the 6-digit code sent to ${authView.email}.` }));
    const input = el("input", {
      className: "otp-input",
      attrs: {
        id: "account-code",
        inputmode: "numeric",
        autocomplete: "one-time-code",
        maxlength: "6",
        pattern: "[0-9]{6}",
        "aria-label": "6-digit code",
      },
    });
    form.append(labeled("6-digit code", input));
    form.append(el("button", { className: "primary", text: "Confirm code", attrs: { type: "submit" } }));
    const resend = el("button", {
      className: "ghost",
      text: otpResendState(OTP_RESEND_SECONDS).label,
      attrs: { type: "button", id: "resend-code" },
      on: { click: () => resendCode(message) },
    });
    resend.disabled = true;
    form.append(resend);
    form.append(el("button", {
      className: "text-button",
      text: "Use a different email",
      attrs: { type: "button" },
      on: {
        click: () => {
          authView.step = "form";
          paintAuth();
        },
      },
    }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      verifyCode(input, message);
    });
    return form;
  }

  function scheduleUsernameCheck(input, status) {
    clearTimeout(usernameTimer);
    const checked = validateUsername(input.value);
    if (!input.value.trim()) {
      status.textContent = "";
      return;
    }
    if (!checked.ok) {
      status.textContent = checked.error;
      return;
    }
    status.textContent = usernameStatus(checked, null).text;
    const ticket = ++usernameTicket;
    usernameTimer = setTimeout(async () => {
      if (!state.client) {
        if (ticket !== usernameTicket) return;
        status.textContent = "Looks valid. Availability is checked when accounts are online.";
        return;
      }
      const remote = await queryUsername(state.client, checked.username);
      if (ticket !== usernameTicket) return;
      status.textContent = usernameStatus(checked, remote).text;
    }, 400);
  }

  async function ensureUsernameFree(checked, ownId) {
    if (!state.client) return { ok: true, text: "" };
    const remote = await queryUsername(state.client, checked.username);
    if (remote.taken && ownId && remote.id === ownId) {
      return { ok: true, text: `${checked.username} is available.` };
    }
    const status = usernameStatus(checked, remote);
    return { ok: status.state === "available", text: status.text };
  }

  async function submitCreate(usernameInput, emailInput, passwordInput) {
    const username = validateUsername(usernameInput.value);
    if (!username.ok) {
      setMessage(username.error);
      return;
    }
    const email = validateEmail(emailInput.value);
    if (!email.ok) {
      setMessage(email.error);
      return;
    }
    const password = validatePassword(passwordInput.value);
    if (!password.ok) {
      setMessage(password.error);
      return;
    }
    if (!state.client) {
      setMessage("Couldn't reach accounts just now. The rest of Honey Charts still works.");
      return;
    }
    const availability = await ensureUsernameFree(username);
    if (!availability.ok) {
      setMessage(availability.text);
      return;
    }
    rememberUsername(sessionStore(), username.username);
    setMessage("Creating the account…");
    const result = await state.client.auth.signUp({
      email: email.email,
      password: password.password,
      options: {
        emailRedirectTo: authReturnUrl(),
        data: { username: username.username },
      },
    });
    if (result.error) {
      setMessage(friendlyAuthError(result.error));
      return;
    }
    if (result.data && result.data.session) {
      setMessage("Account created.");
      return;
    }
    authView = { tab: "create", step: "code", email: email.email, mode: "signup", username: username.username };
    paintAuth();
    setMessage(`Enter the 6-digit code sent to ${email.email}.`);
  }

  async function submitSignIn(emailInput, passwordInput) {
    const email = validateEmail(emailInput.value);
    if (!email.ok) {
      setMessage(email.error);
      return;
    }
    const password = validatePassword(passwordInput.value);
    if (!password.ok) {
      setMessage(password.error);
      return;
    }
    if (!state.client) {
      setMessage("Couldn't reach accounts just now. The rest of Honey Charts still works.");
      return;
    }
    setMessage("Signing in…");
    const result = await state.client.auth.signInWithPassword({
      email: email.email,
      password: password.password,
    });
    if (result.error) {
      const raw = result.error.message || "";
      if (/not confirmed/i.test(raw)) {
        authView = { tab: "signin", step: "code", email: email.email, mode: "signup", username: "" };
        paintAuth();
        setMessage("Confirm the email with the 6-digit code, then this password will work.");
        return;
      }
      setMessage(friendlyAuthError(result.error));
    }
  }

  async function sendEmailCode(emailInput, usernameInput) {
    const email = validateEmail(emailInput.value);
    if (!email.ok) {
      setMessage(email.error);
      return;
    }
    let username = "";
    if (usernameInput && usernameInput.value.trim()) {
      const checked = validateUsername(usernameInput.value);
      if (!checked.ok) {
        setMessage(checked.error);
        return;
      }
      const availability = await ensureUsernameFree(checked);
      if (!availability.ok) {
        setMessage(availability.text);
        return;
      }
      username = rememberUsername(sessionStore(), checked.username);
    }
    if (!state.client) {
      setMessage("Couldn't reach accounts just now. The rest of Honey Charts still works.");
      return;
    }
    setMessage("Sending the code…");
    const { error } = await state.client.auth.signInWithOtp({
      email: email.email,
      options: { emailRedirectTo: authReturnUrl(), shouldCreateUser: true },
    });
    if (error) {
      setMessage(friendlyAuthError(error));
      return;
    }
    authView = { ...authView, step: "code", email: email.email, mode: "email", username };
    paintAuth();
    setMessage(`Enter the 6-digit code sent to ${email.email}.`);
  }

  async function verifyCode(input, message) {
    const code = validateOtpCode(input.value);
    if (!code.ok) {
      message.textContent = code.error;
      return;
    }
    if (options.preview || !state.client) {
      message.textContent = options.preview
        ? "This is a sample code step on this computer. Nothing was sent."
        : "Couldn't reach accounts just now. The rest of Honey Charts still works.";
      return;
    }
    message.textContent = "Checking the code…";
    const { error } = await state.client.auth.verifyOtp({
      email: authView.email,
      token: code.code,
      type: authCodeType(authView.mode),
    });
    if (error) message.textContent = friendlyAuthError(error);
    else message.textContent = "Signed in.";
  }

  async function resendCode(message) {
    const button = dialog && dialog.querySelector("#resend-code");
    if (button && button.disabled) return;
    if (options.preview || !state.client) {
      message.textContent = options.preview
        ? "This is a sample code step on this computer. Nothing was sent."
        : "Couldn't reach accounts just now. The rest of Honey Charts still works.";
      return;
    }
    message.textContent = "Sending a new code…";
    const sent = authView.mode === "signup"
      ? await state.client.auth.resend({
        type: "signup",
        email: authView.email,
        options: { emailRedirectTo: authReturnUrl() },
      })
      : await state.client.auth.signInWithOtp({
        email: authView.email,
        options: { emailRedirectTo: authReturnUrl(), shouldCreateUser: true },
      });
    if (sent.error) {
      message.textContent = friendlyAuthError(sent.error);
      return;
    }
    message.textContent = `A new code is on the way to ${authView.email}.`;
    startResendCountdown();
  }

  function startResendCountdown() {
    clearInterval(resendTimer);
    let left = OTP_RESEND_SECONDS;
    const button = dialog && dialog.querySelector("#resend-code");
    const paint = () => {
      const view = otpResendState(left);
      if (!button) return;
      button.textContent = view.label;
      button.disabled = !view.canResend;
    };
    paint();
    resendTimer = setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) clearInterval(resendTimer);
    }, 1000);
  }

  async function onWalletReady(choice) {
    const wallets = listLoginWallets();
    const match = wallets.find((item) => item.name.toLowerCase() === choice.name.toLowerCase())
      || wallets.find((item) => choice.id && item.name.toLowerCase().includes(choice.id));
    if (!match) {
      setMessage("That wallet is not available in this browser.");
      return;
    }
    if (!state.client) {
      setMessage("Couldn't reach accounts just now. The rest of Honey Charts still works.");
      return;
    }
    setMessage(`Waiting for ${match.name} to sign the login message…`);
    try {
      const { error } = await signInWithSolanaWallet(state.client, match.provider);
      if (error) setMessage(friendlyAuthError(error));
    } catch (error) {
      setMessage(friendlyAuthError(error));
    }
  }

  function googleButton(message) {
    return el("button", {
      className: "ghost",
      text: "Continue with Google",
      attrs: { type: "button" },
      on: {
        click: async () => {
          if (!state.client) {
            message.textContent = "Couldn't reach accounts just now. The rest of Honey Charts still works.";
            return;
          }
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

  function openWelcome() {
    if (dialog && dialog.dataset.purpose === "welcome") return;
    closeDialog();
    dialog = el("dialog", {
      className: "account-dialog is-welcome",
      attrs: { "aria-labelledby": "welcome-title" },
    });
    dialog.dataset.purpose = "welcome";
    wireDialog(dialog);
    dialog.append(welcomeCard());
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    const first = dialog.querySelector("input");
    if (first) first.focus();
  }

  function welcomeCard() {
    const card = el("div", { className: "account-card" });
    card.append(el("div", { className: "account-card-head" }, [
      el("h2", { attrs: { id: "welcome-title" }, text: "Welcome to the hive" }),
      el("button", {
        className: "ghost",
        text: "Close",
        attrs: { type: "button" },
        on: { click: closeDialog },
      }),
    ]));
    card.append(el("p", {
      className: "muted",
      text: "Pick how you show up. You can change this later. The song stays paused until someone presses play.",
    }));
    const message = el("p", { className: "account-message", attrs: { id: "account-message", role: "status" } });
    const form = el("form", { className: "account-form welcome-form" });
    const username = textInput("welcome-username", suggestedUsername(), "Username");
    const displayName = textInput("welcome-display", options.preview === "welcome" ? "Big Jim" : "", "Display name");
    const songUrl = textInput("welcome-song", "", "Profile song link");
    const songTitle = textInput("welcome-song-title", "", "Song title");
    const file = el("input", {
      attrs: { id: "welcome-avatar", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" },
    });
    const errors = el("div", { className: "form-errors", attrs: { role: "alert" } });
    form.append(fieldBlock("Username", username, "This becomes your public page."));
    form.append(fieldBlock("Display name", displayName, ""));
    form.append(fieldBlock("Avatar", file, "Optional image, under 2 MB."));
    form.append(fieldBlock("Profile song", songUrl, "Optional https mp3, YouTube, or SoundCloud link."));
    form.append(fieldBlock("Song title", songTitle, ""));
    form.append(errors, message);
    form.append(el("button", { className: "primary", text: "Enter the hive", attrs: { type: "submit" } }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveWelcome({
        username: username.value,
        displayName: displayName.value,
        songUrl: songUrl.value,
        songTitle: songTitle.value,
      }, file.files && file.files[0], errors, message);
    });
    card.append(form);
    return card;
  }

  function suggestedUsername() {
    const stored = readPendingUsername(sessionStore());
    if (stored) return stored;
    if (options.preview === "welcome") return "bigjim";
    const meta = user() && user().user_metadata;
    const raw = meta && typeof meta.username === "string" ? meta.username : "";
    const checked = validateUsername(raw);
    return checked.ok ? checked.username : "";
  }

  async function saveWelcome(input, file, errors, message) {
    const draft = cleanWelcomeDraft(input);
    clear(errors);
    if (!draft.ok) {
      for (const text of Object.values(draft.errors)) errors.append(el("p", { className: "field-error", text }));
      return;
    }
    if (options.preview || !user() || !state.client) {
      message.textContent = "This is a sample on this computer. Nothing was saved.";
      return;
    }
    if (file) {
      const avatar = validateAvatarFile(file);
      if (!avatar.ok) {
        errors.append(el("p", { className: "field-error", text: avatar.error }));
        return;
      }
    }
    const availability = await ensureUsernameFree({ ok: true, username: draft.values.username }, user().id);
    if (!availability.ok) {
      message.textContent = availability.text;
      return;
    }
    message.textContent = "Saving your profile…";
    if (file) {
      const uploaded = await uploadAvatar(state.client, user().id, file);
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
    const existing = state.profile || {};
    const saved = await saveProfile(state.client, user().id, {
      username: draft.values.username,
      displayName: draft.values.displayName,
      bio: existing.bio || "",
      website: existing.website || "",
      xHandle: existing.xHandle || "",
      telegram: existing.telegram || "",
      solanaAddress: existing.solanaAddress || "",
      songUrl: draft.values.songUrl,
      songTitle: draft.values.songTitle,
      hivePublic: existing.hivePublic !== false,
    });
    if (saved.error) {
      message.textContent = duplicateUsername(saved.error) ? "That username is taken." : friendlyAuthError(saved.error);
      return;
    }
    state.profile = saved.profile || { ...existing, ...draft.values, username: draft.values.username };
    paintHeader();
    landOnProfile(draft.values.username);
  }

  function landOnProfile(username) {
    closeDialog();
    const href = profilePath(location.pathname, username);
    history.pushState(null, "", href);
    if (options.onNavigate) options.onNavigate();
    if (options.setStatus) options.setStatus("Welcome to the hive. This is your profile.");
  }

  function setMessage(text) {
    const node = dialog && dialog.querySelector("#account-message");
    if (node) node.textContent = text || "";
    else if (text) notify(text);
  }

  function closeDialog() {
    clearInterval(resendTimer);
    resendTimer = 0;
    clearTimeout(usernameTimer);
    usernameTimer = 0;
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    dialog.remove();
    dialog = null;
  }

  function wireDialog(node) {
    node.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    node.addEventListener("click", (event) => {
      if (event.target === node) closeDialog();
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
    accessToken() {
      const session = state.session;
      return session && typeof session.access_token === "string" ? session.access_token : "";
    },
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function sessionStore() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
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
