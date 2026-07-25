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
  'Based ONLY on the legal references provided below, answer the user\'s question concisely ' +
  'using bullet points in English. You MUST start each bullet point with the matching reference ' +
  '(e.g., **OSHA 1994 Section 15:** [duty]). Do not add outside information or assumptions.';

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
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) {
    return json(500, {
      status: 'ERROR',
      message: 'Tenant Supabase is not configured.',
    } satisfies AiSummaryResponse);
  }
  const serverClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    },
  });

  const { data: isPremium, error: premErr } = await serverClient.rpc('is_my_tenant_premium');
  if (premErr) {
    return json(500, {
      status: 'ERROR',
      message: `Premium check failed: ${premErr.message}`,
    } satisfies AiSummaryResponse);
  }
  if (isPremium !== true) {
    return json(403, {
      status: 'ERROR',
      message: 'Premium feature. Upgrade your plan to use AI summary.',
    } satisfies AiSummaryResponse);
  }

  // 1b. Credit check — 500 summaries/month per tenant-user.
  const { data: creditOk, error: creditErr } = await serverClient.rpc('consume_ai_credit', { p_endpoint: 'summary', p_max: 500 });
  if (creditErr || !creditOk) {
    return json(429, {
      status: 'ERROR',
      message: 'Monthly AI summary credit limit reached (500/month). Your credits reset on the 1st.',
    } satisfies AiSummaryResponse);
  }

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
