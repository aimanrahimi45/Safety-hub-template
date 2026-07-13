import type { APIRoute } from 'astro';
import { getEmbedding } from '../../lib/embeddings';

export const prerender = false;

// =====================================================================
// POST /api/ai-embed
// Body: { query: string }
// Returns: { embedding: number[] }   (1536 dims, text-embedding-3-small)
//
// Server-only. The browser never talks to OpenRouter directly.
// =====================================================================

export const POST: APIRoute = async ({ request }) => {
  let body: { query?: unknown };
  try {
    body = (await request.json()) as { query?: unknown };
  } catch {
    return jsonError(400, 'Invalid JSON body.');
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length === 0) {
    return jsonError(400, 'Missing or empty "query".');
  }

  try {
    const embedding = await getEmbedding(query);
    return new Response(
      JSON.stringify({ embedding }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Embedding failed.';
    // 500 covers both "missing OPENROUTER_API_KEY" and "OpenRouter
    // 4xx/5xx" — the browser doesn't need to distinguish.
    return jsonError(500, msg);
  }
};

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}
