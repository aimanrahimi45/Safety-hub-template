import type { APIRoute } from 'astro';
import { getSupabasePublic } from '../../lib/supabasePublic';

export const prerender = false;

interface LegalSearchResult {
  id: string;
  clause_id: string;
  clause_text: string;
  section_number: string | null;
  document_name: string;
  document_type: string;
  parent_citations: string[] | null;
  trigger_activity: string;
  required_action: string;
  frequency: string;
  legal_weight: string;
  similarity: number;
}

async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured on server.');
  }

  const resp = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Embedding service returned ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Malformed embedding response from OpenRouter.');
  }
  return embedding;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { query?: string };
    const query = body.query?.trim();

    if (!query) {
      return new Response(JSON.stringify({ error: 'Search query is required.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 1. Dual-language term & acronym query expansion for vector embedding
    let searchEmbeddingPrompt = query;

    if (/section|seksyen|peraturan/i.test(query)) {
      searchEmbeddingPrompt = searchEmbeddingPrompt
        .replace(/section\s*(\d+(?:\(\d+\))*)/gi, 'Peraturan $1 Seksyen $1 Section $1')
        .replace(/peraturan\s*(\d+(?:\(\d+\))*)/gi, 'Peraturan $1 Seksyen $1 Section $1')
        .replace(/seksyen\s*(\d+(?:\(\d+\))*)/gi, 'Peraturan $1 Seksyen $1 Section $1');
    }

    if (/usechh/i.test(query)) {
      searchEmbeddingPrompt += ' Peraturan-Keselamatan-dan-Kesihatan-Pekerjaan-Penggunaan-dan-Standard-Pendedahan-Bahan-Kimia-Berbahaya-Kepada-Kesihatan-2000 Penilaian Risiko Kesihatan';
    }
    if (/class/i.test(query)) {
      searchEmbeddingPrompt += ' Peraturan-peraturan-Keselamatan-dan-Kesihatan-Pekerjaan-Pengelasan-Pelabelan-dan-Helaian-Data-Keselamatan-Bahan-Kimia-Berbahaya-2013';
    }
    if (/fma/i.test(query)) {
      searchEmbeddingPrompt += ' Akta-139-Akta-Kilang-dan-Jentera-1967';
    }
    if (/osha/i.test(query)) {
      searchEmbeddingPrompt += ' Akta-514-Edisi-Cetakan-Semula-1.6.2024_BM.pdf';
    }

    const embedding = await getEmbedding(searchEmbeddingPrompt);

    // 2. Query Project A via getSupabasePublic
    const supabasePublic = getSupabasePublic();
    const { data: matched, error: rpcErr } = await supabasePublic.rpc('match_clauses', {
      query_embedding: embedding,
      match_threshold: 0.05,
      match_count: 50,
    });

    if (rpcErr) {
      return new Response(JSON.stringify({ error: `Supabase RPC error: ${rpcErr.message}` }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const matchedRows = (matched ?? []) as Array<{ id: string; similarity: number }>;
    if (matchedRows.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const clauseIds = matchedRows.map((c) => c.id);
    const similarityMap = new Map<string, number>();
    for (const c of matchedRows) similarityMap.set(c.id, c.similarity);

    // 3. Fetch obligations & clauses from Project A
    const { data: obligations } = await supabasePublic
      .from('obligations')
      .select('id, clause_id, trigger_activity, required_action, frequency, legal_weight')
      .in('clause_id', clauseIds);

    const { data: clauses } = await supabasePublic
      .from('clauses')
      .select('id, clause_text, section_number, parent_citations, documents(name,type)')
      .in('id', clauseIds);

    const clauseById = new Map<string, Record<string, unknown>>();
    if (Array.isArray(clauses)) {
      for (const c of clauses) {
        if (typeof c.id === 'string') clauseById.set(c.id, c as Record<string, unknown>);
      }
    }

    // 4. Dynamic Document Title & Section Re-Ranking
    const numMatch = query.match(/\d+(?:\(\d+\))*/);
    const targetSectionNum = numMatch ? numMatch[0].toLowerCase() : '';
    const queryTokens = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    matchedRows.forEach(row => {
      const c = clauseById.get(row.id);
      if (!c) return;
      const docs = c.documents as { name?: string } | undefined;
      const docName = (docs?.name ?? '').toLowerCase();
      const secNum = (typeof c.section_number === 'string' ? c.section_number : '').toLowerCase();

      let boost = 0;
      queryTokens.forEach(tok => {
        if (docName.includes(tok)) boost += 0.30;
      });

      if (/usechh/i.test(query) && docName.includes('pendedahan-bahan-kimia')) boost += 0.50;
      if (/class/i.test(query) && docName.includes('pengelasan-pelabelan')) boost += 0.50;
      if (/fma/i.test(query) && docName.includes('kilang-dan-jentera')) boost += 0.50;
      if (/514|osha/i.test(query) && docName.includes('514')) boost += 0.50;

      if (targetSectionNum && secNum.includes(targetSectionNum)) {
        if (secNum === targetSectionNum || secNum === `section ${targetSectionNum}` || secNum === `peraturan ${targetSectionNum}`) {
          boost += 0.60;
        } else {
          boost += 0.40;
        }
      }

      similarityMap.set(row.id, row.similarity + boost);
    });

    const results: LegalSearchResult[] = [];

    if (Array.isArray(obligations)) {
      for (const obl of obligations) {
        const cid = typeof obl.clause_id === 'string' ? obl.clause_id : '';
        const cl = clauseById.get(cid);
        if (!cl) continue;
        const docs = cl.documents as { name?: string; type?: string } | undefined;
        results.push({
          id: typeof obl.id === 'string' ? obl.id : '',
          clause_id: cid,
          clause_text: typeof cl.clause_text === 'string' ? cl.clause_text : '',
          section_number: typeof cl.section_number === 'string' ? cl.section_number : null,
          document_name: docs?.name ?? 'Legislation',
          document_type: docs?.type ?? 'Act',
          parent_citations: Array.isArray(cl.parent_citations) ? (cl.parent_citations as string[]) : null,
          trigger_activity: typeof obl.trigger_activity === 'string' ? obl.trigger_activity : 'General Compliance Requirement',
          required_action: typeof obl.required_action === 'string' ? obl.required_action : '',
          frequency: typeof obl.frequency === 'string' ? obl.frequency : 'ongoing',
          legal_weight: typeof obl.legal_weight === 'string' ? obl.legal_weight : 'mandatory',
          similarity: similarityMap.get(cid) ?? 0,
        });
      }
    }

    // Fallback: If any matched clauses have no obligation records, add them directly
    if (Array.isArray(clauses)) {
      for (const cl of clauses) {
        const cid = typeof cl.id === 'string' ? cl.id : '';
        if (!cid || results.some((r) => r.clause_id === cid)) continue;
        const docs = cl.documents as { name?: string; type?: string } | undefined;
        results.push({
          id: cid,
          clause_id: cid,
          clause_text: typeof cl.clause_text === 'string' ? cl.clause_text : '',
          section_number: typeof cl.section_number === 'string' ? cl.section_number : null,
          document_name: docs?.name ?? 'Legislation',
          document_type: docs?.type ?? 'Act',
          parent_citations: Array.isArray(cl.parent_citations) ? (cl.parent_citations as string[]) : null,
          trigger_activity: 'General Duties & Compliance Provisions',
          required_action: typeof cl.clause_text === 'string' ? cl.clause_text : '',
          frequency: 'ongoing',
          legal_weight: 'mandatory',
          similarity: similarityMap.get(cid) ?? 0,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Server error' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
};
