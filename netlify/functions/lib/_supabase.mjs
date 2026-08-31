// Supabase client helpers shared by the API functions that now read/write
// Postgres instead of Netlify Blobs JSON (photo bytes still live in Blobs —
// see photos.mjs/photo.mjs — only the structured metadata moved).
import { createClient } from '@supabase/supabase-js';

// Client scoped to the signed-in caller: built with the PUBLISHABLE key
// (safe, RLS-restricted) plus the caller's own access token forwarded as the
// Authorization header, so every query runs as that user and Postgres's
// row-level security policies (see supabase/schema.sql) do the actual
// ownership enforcement — no manual "does this belong to you?" checks are
// needed in the functions that use this.
function clientForRequest(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, token };
}

// Admin client (SECRET key, bypasses RLS) — used only by photo.mjs to stream
// image bytes back to plain <img> tags, which can't attach an Authorization
// header. Safe because it only ever does a single exact-id lookup the caller
// already supplied (a random UUID); nothing here exposes listing/browsing
// other users' photos.
let _admin = null;
function adminClient() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

async function currentUser(client, token) {
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

export { clientForRequest, adminClient, currentUser };
