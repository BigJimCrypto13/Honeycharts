// Public Supabase settings for the browser. The publishable key is the anon key.
// Do not put a secret server key in this file or anywhere else in the repo.

export const SUPABASE_URL = "https://hqqmarbovsgvyfjzxqjj.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_KZzkAI9gwJHYxL0amhfkBg_ez6A4nhl";

// Pinned ESM build. The browser loads it directly. There is no bundler.
export const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

// The live GitHub Pages origin. Magic links and OAuth return here.
export const AUTH_SITE_URL = "https://bigjimcrypto13.github.io/Honeycharts/";

// The Google button stays hidden until this is true.
// Steps to turn the provider on are in supabase/README.md.
export const GOOGLE_AUTH_ENABLED = false;
