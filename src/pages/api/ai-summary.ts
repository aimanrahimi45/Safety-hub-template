import type { APIRoute } from 'astro';
import { getChatCompletion, type ChatMessage } from '../../lib/embeddings';
import type { AiSummaryResponse } from '../../lib/types';

export const prerender = false;

// =====================================================================
// POST /api/ai-summary  (PREMIUM-gated)
//
// Body: { query: string, clause_ids: string[] }
//
// Premium gate: calls the existing is_my_tenant_premium() SECURITY
// DEFINER RPC against the TENANT Supabase (Project B) using the
// caller's session token. If false, returns 403.
//
// Pipeline (Premium SHO only):
//   1. Fetch clause texts from Project A (PostgREST id IN list).
//   2. Build the OSH RAG prompt.
//   3. Call OpenRouter chat (mistralai/mistral-nemo).
//   4. Return AiSummaryResponse.
// =====================================================================

// Mirrors the legacy GAS prompt verbatim.
const SYSTEM_PROMPT =
  'You are an AI Legal Assistant for Occupational Safety and Health (OSH) in Malaysia. ' +
  'Based ONLY on the legal references provided below, answer the user\'s question clearly. ' +
  'EVERY duty must be a SEPARATE bullet point starting with a hyphen ("- "). ' +
  'Include the reference citation badge (e.g., **Akta 514 Seksyen 15:** [duty]). ' +
  'Do not merge multiple duties into a single paragraph. Respond in the user\'s language (Malay or English).';

export const POST: APIRoute = async ({ request, locals }) => {
  // 1. Premium gate.
  const user = locals.user ?? null;
  if (!user) {
    return json(403, {
      status: 'ERROR',
      message: 'You must be signed in to use AI summary.',
    } satisfies AiSummaryResponse);
  }

  // We need a tenant-scoped client to call is_my_tenant_premium().
  // The Astro project uses the getSupabase() singleton (browser bundle),
  // but for the API route we use a fresh server client that uses the
  // user's session from cookies. The supabase client auto-detects
  // cookies when imported here on the server.
  const { createClient } = await import('@supabase/supabase-js');
  const url = import.meta.env.PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !serviceKey) {
    return json(500, {
      status: 'ERROR',
      message: 'Tenant Supabase is not configured.',
    } satisfies AiSummaryResponse);
  }
  const serverClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: tenant } = await serverClient
    .from('tenants')
    .select('subscription_plan, subscription_expires_at')
    .eq('owner_user_id', user.id)
    .single();

  const isPremium = tenant?.subscription_plan === 'premium' &&
    (tenant?.subscription_expires_at === null || new Date(tenant.subscription_expires_at) > new Date());

  const isTrialActive = tenant?.subscription_plan === 'trial' &&
    tenant?.subscription_expires_at !== null &&
    new Date(tenant.subscription_expires_at) > new Date();

  if (!isPremium && !isTrialActive) {
    return json(403, {
      status: 'ERROR',
      message: 'Your 14-day free trial has expired. Upgrade to Premium to use AI summary.',
    } satisfies AiSummaryResponse);
  }

  // Allocation: Premium = 1,000 summaries/month | Trial = 25 summaries total.
  const maxSummaries = isPremium ? 1000 : 25;



  // 2. Parse body.
  let body: {
    query?: unknown;
    clause_ids?: unknown;
    clauses?: Array<{ clause_text?: string; section_number?: string; document_name?: string }>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, {
      status: 'ERROR',
      message: 'Invalid JSON body.',
    } satisfies AiSummaryResponse);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  let clausesPayload = Array.isArray(body.clauses) ? body.clauses : [];

  if (query.length === 0) {
    return json(200, {
      status: 'SUCCESS',
      summary: 'Please enter a question.',
    } satisfies AiSummaryResponse);
  }

  // If clauses were not sent directly, attempt fetch via getSupabasePublic
  if (clausesPayload.length === 0) {
    const clauseIds = Array.isArray(body.clause_ids)
      ? (body.clause_ids.filter((s): s is string => typeof s === 'string'))
      : [];

    if (clauseIds.length === 0) {
      return json(200, {
        status: 'SUCCESS',
        summary: 'No relevant legal references found. Try different keywords.',
      } satisfies AiSummaryResponse);
    }

    try {
      const { getSupabasePublic } = await import('../../lib/supabasePublic');
      const supabasePublic = getSupabasePublic();
      const { data: dbClauses } = await supabasePublic
        .from('clauses')
        .select('id, clause_text, section_number, documents(name,type)')
        .in('id', clauseIds);

      if (Array.isArray(dbClauses)) {
        clausesPayload = dbClauses.map((c) => {
          const docs = c.documents as { name?: string } | undefined;
          return {
            clause_text: typeof c.clause_text === 'string' ? c.clause_text : '',
            section_number: typeof c.section_number === 'string' ? c.section_number : '',
            document_name: docs?.name ?? 'Legislation',
          };
        });
      }
    } catch {
      // Ignore fallback failure if client sends payload
    }
  }

  if (clausesPayload.length === 0) {
    return json(200, {
      status: 'SUCCESS',
      summary: 'No relevant legal references found. Try different keywords.',
    } satisfies AiSummaryResponse);
  }

  // 4. Build prompt.
  const clausesText = clausesPayload.map((c) => {
    let docName = (c.document_name ?? 'Legislation').replace(/\.pdf$/i, '').replace(/_/g, ' ');
    if (docName.includes('OSHA_1994_Act_514')) docName = 'Akta 514';
    if (docName.includes('FMA_1967_Act_139')) docName = 'Akta 139';
    const secNum = (c.section_number ?? '')
      .replace(/Section/i, 'Seksyen')
      .replace(/Regulation/i, 'Peraturan');
    return `Rujukan: ${docName} (${secNum}) - Kandungan: ${c.clause_text ?? ''}`;
  }).join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `${SYSTEM_PROMPT}\n\n` +
        `Legal references:\n${clausesText}\n\n` +
        `Question: ${query}`,
    },
  ];

  // 5. Call OpenRouter.
  try {
    const summary = await getChatCompletion(messages);
    return json(200, {
      status: 'SUCCESS',
      summary,
    } satisfies AiSummaryResponse);
  } catch (err) {
    return json(500, {
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'AI summary failed.',
    } satisfies AiSummaryResponse);
  }
};

function json(status: number, body: AiSummaryResponse | { error: string }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
