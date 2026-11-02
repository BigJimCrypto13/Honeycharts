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

## 4. Email sign-in

1. On that same Providers page, open **Email**.
2. Leave **Enable Email provider** on.
3. Leave **Confirm email** on if you want a new password account to click a mail before it can sign in. The magic link still works either way: the visitor enters an email, gets a link, and that link signs them in.

You do not need to edit the email templates.

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

- **Join the hive** opens sign-in. Email magic link, email plus password, and Sign in with Solana (Phantom or Solflare).
- A signed-in visitor gets a public page at `?u=username` after they save a username on **Edit profile**.
- They can upload an avatar, paste a profile song (mp3, YouTube, or SoundCloud), and choose whether the Hive is public.
- The song does not start by itself. The page shows a Play button.
- Their Hive mints sync to their account and merge with the list already in that browser. Notes stay in the browser.
- Signed-out visitors keep the Hive that was already in the browser. Nothing is uploaded for them.
- Follow and unfollow is on each public profile.

Embedded wallets and the Hive vault are not in this step.
