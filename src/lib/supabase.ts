import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Polyfill WebSocket for Node.js < 22 SSR environments where Supabase checks for it
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = class {};
}

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

  _client = createBrowserClient(url, anonKey);
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

/**
 * Checks if the tenant has a premium subscription, caches it in localStorage,
 * and returns the boolean value.
 */
export async function checkPremiumStatus(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      localStorage.setItem('is_premium', 'false');
      return false;
    }
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('subscription_plan, subscription_expires_at')
      .eq('owner_user_id', userData.user.id)
      .maybeSingle();

    if (tenantErr || !tenant) {
      localStorage.setItem('is_premium', 'false');
      return false;
    }

    const isPremium =
      tenant.subscription_plan === 'premium' &&
      (tenant.subscription_expires_at === null ||
        new Date(tenant.subscription_expires_at) > new Date());

    localStorage.setItem('is_premium', isPremium ? 'true' : 'false');
    return isPremium;
  } catch (e) {
    console.error('Failed to check premium status:', e);
    // Fallback to cache if database check throws
    return localStorage.getItem('is_premium') === 'true';
  }
}

/**
 * Synchronously reads the cached premium status from localStorage.
 * Useful for instant checks on page load to prevent visual layout shifts.
 */
export function getCachedPremiumStatus(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('is_premium') === 'true';
}
