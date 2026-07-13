import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// =====================================================================
// Server-side Supabase client for Project A (PUBLIC, legal data).
//
// Why a separate client?
//   Project A is the existing public Supabase that holds Malaysian OSH
//   law (Kemalangan 2004, 206 clauses, 12 obligations) — see
//   https://zootofnjqzbblsiptdui.supabase.co. The data is global and
//   public; RLS is off on `documents`, `clauses`, and `obligations`.
//
//   Project B is the NEW tenant Supabase that holds SHO workspace
//   data. Its browser-side singleton lives in ./supabase.ts and uses
//   PUBLIC_* env vars so the client can read them at build/dev time.
//
//   Project A's URL + anon key are only read from `process.env` here.
//   That means this file is server-only: a browser bundle that
//   accidentally imports it will throw at runtime because `process.env`
//   is `undefined` in the browser. The API routes in src/pages/api/*
//   are the only intended importers.
//
//   We intentionally do NOT prefix these with `PUBLIC_` so Astro does
//   not bake the values into the browser bundle. The value being
//   public is fine — Project A's data is global Malaysian law with no
//   secrets — but the API endpoints still need the credentials to
//   forward them to the Project A PostgREST / RPC endpoint server-side.
// =====================================================================

let _client: SupabaseClient | null = null;

export function getSupabasePublic(): SupabaseClient {
  if (_client) return _client;

  const url = import.meta.env.SUPABASE_PUBLIC_URL;
  const anonKey = import.meta.env.SUPABASE_PUBLIC_ANON_KEY;

  if (!url || typeof url !== 'string' || url.length === 0) {
    throw new Error(
      'Missing SUPABASE_PUBLIC_URL in server environment. ' +
        'Add it to .env (server-side only, no PUBLIC_ prefix).',
    );
  }
  if (!anonKey || typeof anonKey !== 'string' || anonKey.length === 0) {
    throw new Error(
      'Missing SUPABASE_PUBLIC_ANON_KEY in server environment. ' +
        'Add it to .env (server-side only, no PUBLIC_ prefix).',
    );
  }

  _client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return _client;
}
