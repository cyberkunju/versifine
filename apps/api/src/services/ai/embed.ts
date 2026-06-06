/**
 * Vector embeddings for the copilot RAG retriever.
 *
 * Single endpoint, single dimension (1536, matching the
 * `transaction_embeddings` PgVector column). When the API key is absent
 * we return a deterministic zero vector so callers stay shape-stable —
 * inserting rows into the embeddings table is idempotent and the search
 * just returns no useful results.
 */
import { VECTOR_DIM } from '../../db/schema/embeddings.ts';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';

export const EMBEDDING_DIM = VECTOR_DIM;

function emptyVector(): number[] {
  return new Array<number>(EMBEDDING_DIM).fill(0);
}

/**
 * Embed a short piece of text. The model is fixed in env so we can swap
 * dimensions globally without spelunking through call sites.
 */
export async function embed(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return emptyVector();
  if (!isAIConfigured()) return emptyVector();

  const client = getOpenAI();
  if (!client) return emptyVector();

  try {
    const response = await withLatency('embed', () =>
      client.embeddings.create({
        model: env.OPENAI_EMBED_MODEL,
        // Must be an array: the Azure AI Inference embeddings schema (Cohere)
        // rejects a bare string with HTTP 422. OpenAI accepts an array too, so
        // this is provider-safe.
        input: [trimmed],
      }),
    );
    const vector = response.data[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIM) {
      log.warn('AI_EMBED_DIM_MISMATCH', {
        expected: EMBEDDING_DIM,
        got: vector?.length ?? 0,
      });
      return emptyVector();
    }
    return vector;
  } catch (err) {
    log.warn('AI_EMBED_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return emptyVector();
  }
}
