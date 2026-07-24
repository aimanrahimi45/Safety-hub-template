import { defineMiddleware, sequence } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabaseServer';
import type { AppUser } from './lib/types';

// =====================================================================
// Public routes that do NOT require an authenticated session.
// Everything else under /app/* and any other path that doesn't match
// this allowlist is gated.
// =====================================================================

const PUBLIC_EXACT = new Set<string>(['/', '/login', '/privacy', '/terms', '/favicon.ico']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/assets/')) return true;
  if (pathname.startsWith('/images/')) return true;
  if (pathname.startsWith('/_astro/')) return true;
  // Marketing pages built as static .html files
  if (pathname.endsWith('.html')) return true;
  if (pathname.startsWith('/api/')) return true;
  return false;
}

// ---------------------------------------------------------------------
// Step 1: attach the authenticated user (and tenant id, if any) to
// Astro.locals so downstream handlers and pages can use them.
// ---------------------------------------------------------------------
const attachAuth = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.tenantId = null;

  const supabase = createSupabaseServerClient(context);
  if (!supabase) {
    // Supabase env vars are missing — let the request through so pages
    // can render their own setup-required message. No auth enforcement
    // is possible without credentials.
    return next();
  }

  try {
    // getUser() validates the session token with Supabase Auth and
    // sets the auth state used by subsequent .rpc() / .from() calls
    // so get_my_tenant_id() resolves to the right SHO.
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return next();
    }

    const user: AppUser = {
      id: userData.user.id,
      email: userData.user.email ?? '',
    };
    context.locals.user = user;

    // Look up the tenant id once per request. Pages under /app/* check
    // this; if it's null they redirect to /app/onboarding.
    const { data: tenantId } = await supabase.rpc('get_my_tenant_id');
    context.locals.tenantId = (tenantId as string | null) ?? null;
  } catch {
    // Swallow — treat as unauthenticated.
    context.locals.user = null;
    context.locals.tenantId = null;
  }

  return next();
});

// ---------------------------------------------------------------------
// Step 2: gate non-public routes.
// ---------------------------------------------------------------------
const gateRoutes = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isPublicPath(pathname)) {
    return next();
  }

  // /app/* requires a session. If the user has a session but no
  // tenant yet, force them through onboarding.
  if (pathname.startsWith('/app/')) {
    if (!context.locals.user) {
      // Check if any Supabase auth cookies are present on the request
      const hasAuthCookie = context.cookies.get('sb-access-token') || 
                             context.cookies.get('sb-refresh-token') ||
                             Array.from(context.cookies.headers?.() ?? []).some(([k]) => k.toLowerCase().includes('sb-'));
      if (hasAuthCookie) {
        return next();
      }
      const nextUrl = encodeURIComponent(pathname + context.url.search);
      return context.redirect(`/login?next=${nextUrl}`);
    }
    if (!context.locals.tenantId && pathname !== '/app/onboarding') {
      return context.redirect('/app/onboarding');
    }
    return next();
  }

  // Any other unknown route: if unauthenticated, send to /login.
  if (!context.locals.user) {
    const next = encodeURIComponent(pathname + context.url.search);
    return context.redirect(`/login?next=${next}`);
  }

  return next();
});

export const onRequest = sequence(attachAuth, gateRoutes);
