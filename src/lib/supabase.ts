import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// =====================================================================
// Browser Supabase client (singleton).
//
// Reads PUBLIC_* env vars that Astro injects at build/dev time. The
// anon key is safe to ship to the browser; actual security is enforced
// by the database RLS policies in 20260712_phase1a_solo_sho.sql.
// =====================================================================

let _client: SupabaseClient | null = null;

function readEnv(name: 'PUBLIC_SUPABASE_URL' | 'PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name];
  if (!value || typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Missing environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in your Supabase project credentials.`,
    );
  }
  return value;
}

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = readEnv('PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('PUBLIC_SUPABASE_ANON_KEY');

  _client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return _client;
}

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    typeof anon === 'string' &&
    anon.length > 0
  );
}
