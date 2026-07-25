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
function extractBaseSection(sectionNum: string): string {
  if (!sectionNum || typeof sectionNum !== 'string') return 'General';
  const clean = sectionNum.trim();
  const m = clean.match(/^([A-Za-z\s-]+\s*\d+|\d+)/i);
  return m ? m[0].trim() : clean;
}

const SYSTEM_PROMPT =
  'You are an AI Legal Assistant for Occupational Safety and Health (OSH) in Malaysia.\n' +
  'Analyze the primary subject (e.g. employee/pekerja, employer/majikan, machinery/jentera, noise/bising, chemical/bahan kimia) ' +
  'and language (Malay or English) of the user\'s question.\n' +
  'Always structure your response in the user\'s language using separate bullet points starting with a hyphen ("- ").\n' +
  'CRITICAL RULE 1: When summarizing a legal section that contains sub-clauses (e.g. points a, b, c, d), you MUST list ALL individual sub-clauses (a, b, c, d) provided in the legal references without omitting any point.\n' +
  'CRITICAL RULE 2 (COMPLETION BUDGET): Plan your summary to fit cleanly within ~250 words. Simplify points concisely so that every section finishes completely. Do NOT start any heading or bullet point that you cannot complete. ALWAYS finish your final sentence cleanly with a full period ("."). Never leave any sentence or section cut off mid-way.\n' +
  'Place the clauses directly matching the primary subject FIRST under a clear section heading, followed by secondary background oversight under a separate heading.\n' +
  'Include the exact reference citation badge for each section (e.g. **Akta 514 Seksyen 24:** [duty]). ' +
  'Do not add outside information or assumptions.';

export const POST: APIRoute = async ({ request, locals }) => {
  // 1. Premium gate.
  const user = locals.user ?? null;
  if (!user) {
    return json(403, {
      status: 'ERROR',
      message: 'You must be signed in to use AI summary.',
    } satisfies AiSummaryResponse);
  }

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
      // Ignore fallback failure
    }
  }

  if (clausesPayload.length === 0) {
    return json(200, {
      status: 'SUCCESS',
      summary: 'No relevant legal references found. Try different keywords.',
    } satisfies AiSummaryResponse);
  }

  // 3. Dynamic Subject Re-Ranking & Universal Base Section Grouping
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  // Score clauses by relevance to query
  const scoredMap = new Map<string, number>();
  clausesPayload.forEach((c) => {
    const text = `${c.section_number ?? ''} ${c.document_name ?? ''} ${c.clause_text ?? ''}`.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (text.includes(word)) score += 1;
    }
    if ((queryWords.includes('employee') || queryWords.includes('pekerja')) && (text.includes('24') || text.includes('pekerja') || text.includes('employee'))) {
      score += 5;
    }
    if ((queryWords.includes('employer') || queryWords.includes('majikan')) && (text.includes('15') || text.includes('majikan') || text.includes('employer'))) {
      score += 5;
    }
    scoredMap.set(`${c.document_name}::${c.section_number}`, score);
  });

  // Universal Base Section Grouping (groups all sister sub-clauses: a, b, c, d...)
  const baseGroups = new Map<string, { docName: string; baseSec: string; maxScore: number; clauses: typeof clausesPayload }>();

  for (const c of clausesPayload) {
    const doc = c.document_name ?? 'Legislation';
    const baseSec = extractBaseSection(c.section_number ?? '');
    const groupKey = `${doc}::${baseSec}`;
    const score = scoredMap.get(`${c.document_name}::${c.section_number}`) ?? 0;

    if (!baseGroups.has(groupKey)) {
      baseGroups.set(groupKey, { docName: doc, baseSec, maxScore: score, clauses: [] });
    }
    const group = baseGroups.get(groupKey)!;
    if (score > group.maxScore) group.maxScore = score;
    group.clauses.push(c);
  }

  // Sort base section groups by max relevance score
  const sortedGroups = Array.from(baseGroups.values()).sort((a, b) => b.maxScore - a.maxScore);

  // Format all sister sub-clauses sequentially for top section groups
  const formattedLines: string[] = [];
  let currentChars = 0;
  const maxPayloadChars = 6000;

  for (const group of sortedGroups) {
    if (currentChars >= maxPayloadChars) break;

    // Sort sub-clauses inside group alphabetically/numerically (a, b, c, d)
    group.clauses.sort((a, b) => (a.section_number ?? '').localeCompare(b.section_number ?? '', undefined, { numeric: true, sensitivity: 'base' }));

    let docDisplayName = group.docName.replace(/\.pdf$/i, '').replace(/_/g, ' ');
    if (docDisplayName.includes('OSHA_1994_Act_514')) docDisplayName = 'Akta 514';
    if (docDisplayName.includes('FMA_1967_Act_139')) docDisplayName = 'Akta 139';

    for (const c of group.clauses) {
      const secNum = (c.section_number ?? '').replace(/Section/i, 'Seksyen').replace(/Regulation/i, 'Peraturan');
      const snippet = (c.clause_text ?? '').slice(0, 600);
      const line = `Rujukan: ${docDisplayName} (${secNum}) - Kandungan: ${snippet}`;
      formattedLines.push(line);
      currentChars += line.length;
      if (currentChars >= maxPayloadChars) break;
    }
  }

  const clausesText = formattedLines.join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
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
