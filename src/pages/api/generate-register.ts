import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../lib/supabaseServer';
import { getEmbedding } from '../../lib/embeddings';
import { getSupabasePublic } from '../../lib/supabasePublic';
import type {
  ComplianceRegisterItem,
  TenantProfile,
} from '../../lib/types';

export const prerender = false;

// =====================================================================
// POST /api/generate-register
// Body: { profile: TenantProfile }
//
// FREE for all SHOs. The endpoint is not Premium-gated — the Premium
// gating is on /api/ai-summary, used by the AI Search tab only.
//
// Pipeline (server-side, mirrors the legacy GAS getComplianceObligations
// + getVectorSearch but in one call):
//   1. Expand profile.operations via the legacy CATEGORY_MAP to get a
//      keyword list.
//   2. Add general OSH keywords.
//   3. Join into a single string, embed via OpenRouter.
//   4. RPC `match_clauses(embedding, 0.35, 20)` against Project A.
//   5. For each matched clause, fetch the joined obligation via
//      Project A PostgREST.
//   6. Group by frequency, sort by similarity DESC within each group.
//   7. Return sorted, grouped list.
//
// Returns: { items: ComplianceRegisterItem[] }
// =====================================================================

// Hardcoded from the legacy CATEGORY_MAP (dist/compliance.html line 961).
// These are the OSH trigger keywords that map each profiler card to
// the obligations.clauses.trigger_activity column.
const CATEGORY_MAP: Record<string, string[]> = {
  heights:    ['height', 'fall', 'scaffold', 'ladder', 'harness'],
  confined:   ['confined'],
  chemicals:  ['chemical', 'cadmium', 'sds', 'class', 'usechh', 'kimia'],
  machinery:  ['machinery', 'boiler', 'pressure', 'loji', 'competent'],
  gig:        ['gig', 'rider', 'compounding', 'akta-872'],
  petroleum:  ['petroleum', 'fuel', 'pipeline'],
  transport:  ['pengangkutan', 'road-transport', 'timber', 'traffic'],
  noise:      ['noise', 'bising', 'hearing'],
  lifting:    ['lift', 'escalator', 'crane', 'hoist', 'lifting'],
  toxic:      ['asbestos', 'lead', 'silica'],
  radiation:  ['radiation', 'atomic'],
};

const GENERAL_KEYWORDS = [
  'general', 'safety', 'first aid', 'reporting', 'nadopod',
  'committee', 'welfare', 'duty',
];

const MATCH_THRESHOLD = 0.35;
const MATCH_COUNT = 20; // More than the 8 used for AI Search (register view).

const FREQUENCY_ORDER: Record<string, number> = {
  continuous: 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
  yearly: 4,
  annually: 4,
  'on occurrence': 5,
  once: 6,
  other: 7,
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  // Auth gate — prevent unauthenticated credit burn.
  if (!locals.user) {
    return jsonError(401, 'You must be signed in.');
  }

  // Credit check — 50 register generations/month per tenant-user.
  const supabaseClient = createSupabaseServerClient({ cookies } as Parameters<typeof createSupabaseServerClient>[0]);
  if (supabaseClient) {
    const { data: creditOk, error: creditErr } = await supabaseClient.rpc('consume_ai_credit', { p_endpoint: 'register', p_max: 50 });
    if (creditErr || !creditOk) {
      return jsonError(429, 'Monthly register generation credit limit reached (50/month). Your credits reset on the 1st.');
    }
  }

  let body: { profile?: unknown };
  try {
    body = (await request.json()) as { profile?: unknown };
  } catch {
    return jsonError(400, 'Invalid JSON body.');
  }

  const profile = parseProfile(body.profile);
  if (!profile) {
    return jsonError(400, 'Missing or invalid "profile".');
  }

  // 1. Build keyword list.
  const keywords: string[] = [...GENERAL_KEYWORDS];
  for (const op of profile.operations) {
    const mapped = CATEGORY_MAP[op];
    if (mapped) keywords.push(...mapped);
  }
  for (const [hazard, on] of Object.entries(profile.hazards)) {
    if (on) {
      const mapped = CATEGORY_MAP[hazard];
      if (mapped) keywords.push(...mapped);
    }
  }
  if (keywords.length === 0) {
    return jsonError(400, 'Profile has no keywords to match (no operations or hazards selected).');
  }

  // 2. Embed the joined keyword string.
  let embedding: number[];
  try {
    embedding = await getEmbedding(keywords.join(' '));
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : 'Embedding failed.');
  }

  // 3. RPC match_clauses against Project A.
  let matchedClauses: Array<{ id: string; similarity: number }>;
  try {
    const supabasePublic = getSupabasePublic();
    const { data, error } = await supabasePublic.rpc('match_clauses', {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
    });
    if (error) {
      return jsonError(502, `Supabase RPC error: ${error.message}`);
    }
    matchedClauses = (data ?? []) as Array<{ id: string; similarity: number }>;
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : 'Supabase RPC failed.');
  }

  if (matchedClauses.length === 0) {
    return new Response(
      JSON.stringify({ items: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  // 4. Resolve clause IDs into joined obligations.
  const clauseIds = matchedClauses.map((c) => c.id);
  const similarityMap = new Map<string, number>();
  for (const c of matchedClauses) similarityMap.set(c.id, c.similarity);

  let obligations: Array<Record<string, unknown>>;
  try {
    const supabasePublic = getSupabasePublic();
    const url = `/rest/v1/obligations?select=id,clause_id,trigger_activity,required_action,frequency,legal_weight&clause_id=in.(${clauseIds.map((id) => `"${id}"`).join(',')})`;
    // Use the underlying PostgREST via fetch for an explicit id IN list.
    const baseUrl = import.meta.env.SUPABASE_PUBLIC_URL ?? '';
    const key = import.meta.env.SUPABASE_PUBLIC_ANON_KEY ?? '';
    const resp = await fetch(`${baseUrl}${url}`, {
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return jsonError(502, `Supabase obligations fetch error (${resp.status}): ${text.slice(0, 200)}`);
    }
    obligations = (await resp.json()) as Array<Record<string, unknown>>;
    // Suppress unused-var lint on the client reference.
    void supabasePublic;
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : 'Obligations fetch failed.');
  }

  // 5. Join clause text + document metadata.
  let clauses: Array<Record<string, unknown>>;
  try {
    const baseUrl = import.meta.env.SUPABASE_PUBLIC_URL ?? '';
    const key = import.meta.env.SUPABASE_PUBLIC_ANON_KEY ?? '';
    const url = `/rest/v1/clauses?select=id,clause_text,section_number,parent_citations,doc_id,documents(name,type)&id=in.(${clauseIds.map((id) => `"${id}"`).join(',')})`;
    const resp = await fetch(`${baseUrl}${url}`, {
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return jsonError(502, `Supabase clauses fetch error (${resp.status}): ${text.slice(0, 200)}`);
    }
    clauses = (await resp.json()) as Array<Record<string, unknown>>;
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : 'Clauses fetch failed.');
  }

  const clauseById = new Map<string, Record<string, unknown>>();
  for (const c of clauses) {
    if (typeof c.id === 'string') clauseById.set(c.id, c);
  }

  const items: ComplianceRegisterItem[] = [];
  for (const obl of obligations) {
    const clauseId = typeof obl.clause_id === 'string' ? obl.clause_id : '';
    const clause = clauseById.get(clauseId);
    if (!clause) continue;
    const documents = clause.documents as { name?: string; type?: string } | undefined;
    items.push({
      id: typeof obl.id === 'string' ? obl.id : '',
      clause_id: clauseId,
      clause_text: typeof clause.clause_text === 'string' ? clause.clause_text : '',
      section_number: typeof clause.section_number === 'string' ? clause.section_number : null,
      document_name: documents?.name ?? 'Legislation',
      document_type: documents?.type ?? 'Act',
      parent_citations: Array.isArray(clause.parent_citations)
        ? (clause.parent_citations as string[])
        : null,
      trigger_activity: typeof obl.trigger_activity === 'string' ? obl.trigger_activity : '',
      required_action: typeof obl.required_action === 'string' ? obl.required_action : '',
      frequency: typeof obl.frequency === 'string' ? obl.frequency : 'other',
      legal_weight: typeof obl.legal_weight === 'string' ? obl.legal_weight : 'mandatory',
      similarity: similarityMap.get(clauseId) ?? 0,
    });
  }

  // 6. Sort by (frequency bucket ASC, similarity DESC).
  items.sort((a, b) => {
    const fa = FREQUENCY_ORDER[a.frequency.toLowerCase()] ?? 99;
    const fb = FREQUENCY_ORDER[b.frequency.toLowerCase()] ?? 99;
    if (fa !== fb) return fa - fb;
    return b.similarity - a.similarity;
  });

  return new Response(
    JSON.stringify({ items }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

function parseProfile(raw: unknown): TenantProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hazardsRaw = (r.hazards ?? {}) as Record<string, unknown>;
  const hazards = {
    noise: bool(hazardsRaw.noise),
    chemicals: bool(hazardsRaw.chemicals),
    machinery: bool(hazardsRaw.machinery),
    lifting: bool(hazardsRaw.lifting),
    toxic: bool(hazardsRaw.toxic),
    radiation: bool(hazardsRaw.radiation),
  };
  const operations = Array.isArray(r.operations)
    ? (r.operations.filter((s) => typeof s === 'string') as string[])
    : [];
  const industry = typeof r.industry === 'string' ? r.industry : null;
  const headcount = typeof r.headcount === 'number' && Number.isFinite(r.headcount)
    ? r.headcount
    : null;
  return { industry, headcount, hazards, operations };
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}
