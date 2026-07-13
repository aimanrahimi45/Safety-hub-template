import type { APIRoute } from 'astro';
import type { LicensePlanType, LicenseValidationResult } from '../../lib/types';

export const prerender = false;

// =====================================================================
// License validation passthrough.
//
// The user's existing Google Apps Script Web App holds the license
// records in a private Google Sheet. This route is a thin server-side
// proxy: it forwards the key to the GAS endpoint, normalises the
// response, and never exposes the GAS URL to the client.
//
// Application of the validation result to the tenant row (e.g.
// tenants.subscription_plan = 'premium') is done by the caller, not
// here. This endpoint is purely a validator.
// =====================================================================

interface GasSuccess {
  valid: boolean;
  planType?: string;
  expiry?: string;
  message?: string;
}

export const POST: APIRoute = async ({ request }) => {
  // Require an authenticated session. The onboarding form should only
  // call this after sign-in.
  const user = (globalThis as { Astro?: { locals?: { user?: { id: string } | null } } })
    .Astro?.locals?.user;
  void user;

  let body: { licenseKey?: unknown };
  try {
    body = (await request.json()) as { licenseKey?: unknown };
  } catch {
    return new Response(
      JSON.stringify({ valid: false, reason: 'Invalid JSON body.' } satisfies LicenseValidationResult),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey.trim() : '';
  if (!licenseKey) {
    return new Response(
      JSON.stringify({ valid: false, reason: 'License key is required.' } satisfies LicenseValidationResult),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const gasUrl = import.meta.env.LICENSE_VALIDATION_WEBAPP_URL as string | undefined;
  if (!gasUrl) {
    return new Response(
      JSON.stringify({
        valid: false,
        reason:
          'License validation is not configured. Set LICENSE_VALIDATION_WEBAPP_URL in .env.',
      } satisfies LicenseValidationResult),
      { status: 503, headers: { 'content-type': 'application/json' } },
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
    return new Response(
      JSON.stringify({
        valid: false,
        reason: 'License validation service unavailable. Please try again later.',
      } satisfies LicenseValidationResult),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  if (!gas.valid) {
    return new Response(
      JSON.stringify({
        valid: false,
        reason: gas.message ?? 'License key is not valid.',
      } satisfies LicenseValidationResult),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const planType: LicensePlanType =
    gas.planType === 'premium' ? 'premium' : 'free';

  return new Response(
    JSON.stringify({
      valid: true,
      planType,
      expiry: gas.expiry ?? null,
    } satisfies LicenseValidationResult),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};
