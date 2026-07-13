import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr';
import type { APIContext, AstroGlobal } from 'astro';

// Polyfill WebSocket for Node.js < 22 SSR environments where Supabase checks for it
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = class {};
}

// =====================================================================
// Server-side Supabase client for Astro middleware.
//
// Astro middleware runs on the server, so it can read/write cookies on
// the incoming request. We hand @supabase/ssr a thin adapter around
// Astro.cookies so that getSession()/getUser() reads the auth cookies
// Supabase set during the OAuth callback, and subsequent .from()/.rpc()
// calls run as that authenticated user (so get_my_tenant_id() resolves).
// =====================================================================

type AstroLike = AstroGlobal | APIContext;

export function createSupabaseServerClient(context: AstroLike) {
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !anonKey) {
    return null;
  }

  const cookieOptions: CookieOptionsWithName = {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: import.meta.env.PROD,
  };

  return createServerClient(url, anonKey, {
    cookieOptions,
    cookies: {
      get(name: string) {
        return context.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        context.cookies.set(name, value, { ...cookieOptions, ...options });
      },
      remove(name: string, options: Record<string, unknown>) {
        context.cookies.delete(name, { ...cookieOptions, ...options });
      },
    },
  });
}
