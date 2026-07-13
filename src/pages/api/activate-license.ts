import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../lib/supabaseServer';
import type { LicensePlanType } from '../../lib/types';

export const prerender = false;

// =====================================================================
// POST /api/activate-license
//
// Validates a license key against the GAS Web App (same upstream as
// /api/validate-license) and, on success, writes the result onto the
// caller's tenant row. Returns the simplified { status, plan, expires }
// shape the settings page expects.
//
// Note: /api/validate-license is kept untouched — the onboarding form
// uses it as a non-mutating "is this key valid?" check, while this
// route is the "validate AND persist" path.
// =====================================================================

interface GasSuccess {
  valid: boolean;
  planType?: string;
  expiry?: string;
  message?: string;
}

interface ActivateResponse {
  status: 'SUCCESS' | 'ERROR';
  plan?: LicensePlanType;
  expires_at?: string | null;
  message?: string;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  // 1. Parse body
  let body: { licenseKey?: unknown };
  try {
    body = (await request.json()) as { licenseKey?: unknown };
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }
  const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
  if (!licenseKey) {
    return jsonError('License key is required.', 400);
  }

  // 2. Auth check
  const supabase = createSupabaseServerClient({ cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (!supabase) {
    return jsonError('Supabase is not configured.', 500);
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonError('Unauthorized.', 401);
  }

  // 3. Resolve tenant id via the same RPC the rest of the app uses.
  const { data: tenantIdRaw } = await supabase.rpc('get_my_tenant_id');
  const tenantId = (tenantIdRaw as string | null) ?? null;
  if (!tenantId) {
    return jsonError('No workspace found for this account.', 403);
  }

  // 4. Validate the key against the GAS Web App.
  const gasUrl = import.meta.env.LICENSE_VALIDATION_WEBAPP_URL as string | undefined;
  if (!gasUrl) {
    return jsonError(
      'License validation is not configured. Set LICENSE_VALIDATION_WEBAPP_URL in .env.',
      503,
    );
  }
  const upstream =
    gasUrl +
    '?action=validateLicense' +
    '&key=' +
    encodeURIComponent(licenseKey) +
    '&spreadsheetId=' +
    encodeURIComponent('solo');

  let gas: GasSuccess;
  try {
    const resp = await fetch(upstream, { method: 'GET' });
    if (!resp.ok) throw new Error(`GAS responded ${resp.status}`);
    gas = (await resp.json()) as GasSuccess;
  } catch {
    return jsonError('License validation service unavailable. Please try again later.', 502);
  }

  if (!gas.valid) {
    return jsonError(gas.message ?? 'License key is not valid.', 400);
  }

  const plan: LicensePlanType = gas.planType === 'premium' ? 'premium' : 'free';
  const expiresAt: string | null = gas.expiry ?? null;

  // 5. Persist onto the tenant row. RLS scopes the update to the
  //    caller's own workspace.
  const { error: updateError } = await supabase
    .from('tenants')
    .update({
      license_key: licenseKey,
      subscription_plan: plan,
      subscription_expires_at: expiresAt,
      subscription_activated_at: new Date().toISOString(),
    })
    .eq('id', tenantId);

  if (updateError) {
    return jsonError(updateError.message, 500);
  }

  const payload: ActivateResponse = {
    status: 'SUCCESS',
    plan,
    expires_at: expiresAt,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

function jsonError(message: string, status: number): Response {
  const body: ActivateResponse = { status: 'ERROR', message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
