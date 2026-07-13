// =====================================================================
// OpenRouter helpers for embeddings and chat completions.
//
// Server-only. Reads OPENROUTER_API_KEY from `import.meta.env` (no
// PUBLIC_ prefix) so Astro does NOT bundle the key into the browser
// bundle. The API routes in src/pages/api/* are the only intended
// importers.
//
// Retry pattern: 3 attempts with exponential backoff (1s, 2s, 4s).
// Same shape as the legacy GAS `UrlFetchApp.fetch` calls in
// Safety_Hub_Backend.js but ported to fetch().
// =====================================================================

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const EMBED_MODEL = 'openai/text-embedding-3-small';
const CHAT_MODEL = 'mistralai/mistral-nemo';
const EMBED_DIM = 1536;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

function getApiKey(): string {
  const key = import.meta.env.OPENROUTER_API_KEY;
  if (!key || typeof key !== 'string' || key.length === 0) {
    throw new Error(
      'Missing OPENROUTER_API_KEY in server environment. ' +
        'Add it to .env (server-side only, no PUBLIC_ prefix).',
    );
  }
  return key;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed a single piece of text. Returns a 1536-dim vector (the
 * `openai/text-embedding-3-small` dimensionality).
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('getEmbedding: text is empty');
  }
  const key = getApiKey();
  const url = `${OPENROUTER_BASE}/embeddings`;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: text }),
      });

      if (resp.status === 429 || resp.status >= 500) {
        // Retryable
        lastErr = new Error(
          `OpenRouter embeddings HTTP ${resp.status} (attempt ${attempt})`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        throw lastErr;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(
          `OpenRouter embeddings error (${resp.status}): ${text.slice(0, 500)}`,
        );
      }

      const data = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
      const vec = data.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
        throw new Error(
          `OpenRouter embeddings: expected ${EMBED_DIM}-dim vector, got ${Array.isArray(vec) ? vec.length : 'nothing'}`,
        );
      }
      return vec;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      throw err instanceof Error
        ? err
        : new Error(`getEmbedding failed: ${String(err)}`);
    }
  }
  // Unreachable, but TypeScript needs it.
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`getEmbedding failed: ${String(lastErr)}`);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Send a chat completion request and return the assistant's text
 * content. Throws on non-retryable errors or after MAX_ATTEMPTS.
 */
export async function getChatCompletion(
  messages: ChatMessage[],
): Promise<string> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('getChatCompletion: messages is empty');
  }
  const key = getApiKey();
  const url = `${OPENROUTER_BASE}/chat/completions`;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: CHAT_MODEL, messages }),
      });

      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new Error(
          `OpenRouter chat HTTP ${resp.status} (attempt ${attempt})`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        throw lastErr;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(
          `OpenRouter chat error (${resp.status}): ${text.slice(0, 500)}`,
        );
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (data.error) {
        throw new Error(data.error.message || 'OpenRouter chat returned an error');
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('OpenRouter chat: empty assistant content');
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      throw err instanceof Error
        ? err
        : new Error(`getChatCompletion failed: ${String(err)}`);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`getChatCompletion failed: ${String(lastErr)}`);
}
