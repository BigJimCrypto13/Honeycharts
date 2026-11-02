# Accounts setup for James

The site already has the publishable key. You do not create a key, and you do not paste the secret service role key anywhere. That secret bypasses row security. Leave it in the Supabase dashboard.

Do these clicks in order. The live site is https://bigjimcrypto13.github.io/Honeycharts/

## 1. Create the tables

1. Open https://supabase.com/dashboard/project/hqqmarbovsgvyfjzxqjj
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.
4. Open `supabase/migrations/001_accounts.sql` in this repo, select the whole file, and paste it into the editor.
5. Click **Run**.
6. You want a success message. Running the same file again later is safe.

That file creates `profiles`, `hive_items`, and `follows`, turns on row level security, and creates the public `avatars` storage bucket. Visitors can read profiles, follows, and a Hive only when that member left "Show my Hive" on (the default). A member can change only their own rows. Avatar files are public to read. Only the owner can write files inside their own folder.

Until this Run succeeds, the site keeps working and shows **Accounts are coming online**. The Hive stays in the browser.

## 2. Allow the site to finish sign-in

1. Left sidebar: **Authentication**.
2. Click **URL Configuration**.
3. Set **Site URL** to exactly:

   `https://bigjimcrypto13.github.io/Honeycharts/`

4. Under **Redirect URLs**, add each of these and save:

   - `https://bigjimcrypto13.github.io/Honeycharts/`
   - `https://bigjimcrypto13.github.io/Honeycharts/**`
   - `http://127.0.0.1:8765/`
   - `http://127.0.0.1:8765/**`
   - `http://localhost:8765/`
   - `http://localhost:8765/**`

The local addresses are only for trying the site on your computer. The GitHub Pages addresses are the ones that matter for the live site.

## 3. Turn on Solana sign-in

1. Left sidebar: **Authentication**.
2. Click **Sign In / Providers** (the page may be labeled **Providers**).
3. Find **Web3** or **Solana**.
4. Turn **Solana** on and save.

If you do not see Solana, open the Web3 section and enable the Solana chain. Email sign-in can work before this switch is on. The Solana button will tell the visitor that Solana sign-in is not switched on yet.

Sign in with Solana asks Phantom or Solflare to sign a login message. It does not send a transaction and it does not ask for a seed phrase or a private key.

## 4. Email codes (do this or the 6-digit code is not in the mail)

The site asks for a 6-digit code on the same page. That code is `{{ .Token }}` in the email. Supabase does not put the code in the mail until you paste it into the template.

1. Open https://supabase.com/dashboard/project/hqqmarbovsgvyfjzxqjj
2. Left sidebar: **Authentication**.
3. Click **Emails**.
4. Click **Templates**.
5. Open **Confirm signup**.
6. Replace the message body with this, then save:

```html
<h2>Confirm your Honey Charts account</h2>
<p>Enter this code on the Honey Charts page:</p>
<p>{{ .Token }}</p>
<p>Or open this link on any device: <a href="{{ .ConfirmationURL }}">Confirm and sign in</a></p>
```

7. Open **Magic Link**.
8. Replace the message body with this, then save:

```html
<h2>Your Honey Charts sign-in code</h2>
<p>Enter this code on the Honey Charts page:</p>
<p>{{ .Token }}</p>
<p>Or open this link on any device: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
```

`{{ .Token }}` is the 6-digit code. `{{ .ConfirmationURL }}` is the link. Keep both lines.

### Confirm email

1. Left sidebar: **Authentication**.
2. Click **Sign In / Providers**.
3. Open **Email**.
4. Leave **Enable Email provider** on.
5. **Confirm email** is the switch that decides if a new password account must enter a code.

Leave **Confirm email** on. A new account then stays on the page, gets a code, and types it. That is the flow the site is built for.

If you turn **Confirm email** off, Create account signs the person in immediately and no code is sent. That is faster, and it does not prove they own the email. Keep the switch on.

### Redirect URLs

You do not need to add another redirect URL for the code. The code is typed on the site, so it never leaves the page.

A clicked link still returns to the Site URL you already set, `https://bigjimcrypto13.github.io/Honeycharts/`, which is covered by `https://bigjimcrypto13.github.io/Honeycharts/**`. Add a new redirect only if you host the site on a different origin.

The site uses the implicit email link (the session rides in the link hash) so a link opened on a phone still signs in. The code works either way, including on a different device. An old link that was sent before this change can show a clear error instead of doing nothing. The person then requests a new code.

## 5. Google, later

The Google button is hidden. Leave it hidden until these steps are done, then change one line in the repo.

1. In Google Cloud Console, open **APIs & Services**, then **Credentials**.
2. Click **Create credentials**, then **OAuth client ID**.
3. If it asks for a consent screen, finish that first. An external app in testing mode is enough to start.
4. Application type: **Web application**.
5. Under **Authorized redirect URIs**, add exactly:

   `https://hqqmarbovsgvyfjzxqjj.supabase.co/auth/v1/callback`

6. Create the client and copy the client ID and client secret.
7. Back in Supabase: **Authentication** → **Sign In / Providers** → **Google**.
8. Turn Google on, paste the client ID and client secret, and save.
9. In this repo, open `js/auth-config.js` and change `GOOGLE_AUTH_ENABLED` from `false` to `true`.
10. Deploy the site. The header sign-in window then shows **Continue with Google**.

Do not put the Google client secret in the repo. Supabase stores it.

## What a visitor can do after this

- **Join the hive** opens **Create account** (username, email, and password on one form) and a **Sign in** tab. **Email me a code instead** sends a 6-digit code that is typed on the same page. Phantom and Solflare stay on the window and in the header even when the browser has no wallet extension.
- The first sign-in without a username opens **Welcome to the hive** (username, display name, optional avatar and profile song) and then the public page at `?u=username`.
- They can upload an avatar, paste a profile song (mp3, YouTube, or SoundCloud), and choose whether the Hive is public.
- The song does not start by itself. The page shows a Play button.
- Their Hive mints sync to their account and merge with the list already in that browser. Notes stay in the browser.
- Signed-out visitors keep the Hive that was already in the browser. Nothing is uploaded for them.
- Follow and unfollow is on each public profile.

Embedded wallets and the Hive vault are not in this step.
