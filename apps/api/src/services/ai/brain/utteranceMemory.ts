/**
 * Utterance Memory — Tier 0 of the parse pipeline.
 *
 * Every confirmed parse is stored here with its 1536-dim embedding.
 * On the next request we cosine-search the vector index: if the nearest
 * neighbour's similarity is ≥ EXACT_HIT_THRESHOLD we return its cached
 * parse immediately (no LLM call, no regex pass, ~5 ms total).
 *
 * If similarity is in the softer [PRIOR_THRESHOLD, EXACT_HIT_THRESHOLD)
 * band we return the match as a "prior hint" for the caller to inject
 * into the LLM prompt — giving the model a strong starting guess.
 *
 * Accuracy tracking:
 *   recordConfirmation() — bumps confirm_count, recomputes last_accuracy
 *   recordRejection()    — bumps reject_count, recomputes last_accuracy
 *
 * Deduplication: text is normalised (lowercase, collapsed whitespace) and
 * hashed with SHA-256 before upsert so the same sentence never gets two
 * rows even if the user formats it differently.
 */
import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.ts';
import { utteranceMemory } from '../../../db/schema/utteranceMemory.ts';
import { log } from '../../../utils/logger.ts';
import { embed } from '../embed.ts';
import type { ParsedExpense } from '../parser.ts';

/** Cosine similarity ≥ this → return cached parse directly (Tier 0 hit). */
export const EXACT_HIT_THRESHOLD = 0.93;

/** Cosine similarity in [PRIOR_THRESHOLD, EXACT_HIT_THRESHOLD) → inject as prior hint. */
export const PRIOR_THRESHOLD = 0.75;

export interface MemoryLookupResult {
  /** 'exact' → return cached parse; 'prior' → use as LLM hint. */
  type: 'exact' | 'prior';
  parsedResult: ParsedExpense;
  similarity: number;
  rowId: string;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashText(normalised: string): string {
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

/* ── public API ───────────────────────────────────────────────────────── */

/**
 * Look up the closest past utterance for `text` in this space.
 *
 * Returns null when:
 *  - the embedding API is unavailable (graceful degradation),
 *  - no row has similarity ≥ PRIOR_THRESHOLD, or
 *  - the DB query fails.
 */
export async function lookupSimilar(
  spaceId: string,
  text: string,
): Promise<MemoryLookupResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // First try an exact hash match — zero vector cost.
  const norm = normalise(trimmed);
  const hash = hashText(norm);
  try {
    const exactRows = await db
      .select()
      .from(utteranceMemory)
      .where(and(eq(utteranceMemory.spaceId, spaceId), eq(utteranceMemory.textHash, hash)))
      .limit(1);

    if (exactRows.length > 0) {
      const row = exactRows[0]!;
      // Touch last_used_at asynchronously — don't block the caller.
      void db
        .update(utteranceMemory)
        .set({ lastUsedAt: new Date() })
        .where(eq(utteranceMemory.id, row.id))
        .catch(() => undefined);

      log.info('UTTERANCE_MEMORY_EXACT_HASH_HIT', { spaceId });
      return {
        type: 'exact',
        parsedResult: row.parsedResult as ParsedExpense,
        similarity: 1.0,
        rowId: row.id,
      };
    }
  } catch (err) {
    log.warn('UTTERANCE_MEMORY_HASH_LOOKUP_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }

  // Embed the incoming text.
  let vector: number[];
  try {
    vector = await embed(trimmed);
  } catch {
    return null;
  }
  // embed() never throws (returns zero vector on failure) but a zero vector
  // means the API is down — bail out rather than returning a nonsense result.
  if (vector.every((v) => v === 0)) return null;

  // Cosine nearest-neighbour search via pgvector.
  // `<=>` is the cosine-distance operator; 1 − distance = similarity.
  try {
    const vectorLiteral = `[${vector.join(',')}]`;
    const result = await db.execute<{
      id: string;
      parsed_result: unknown;
      similarity: number;
    }>(
      sql`
        SELECT
          id,
          parsed_result,
          1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
        FROM utterance_memory
        WHERE space_id = ${spaceId}
          AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${PRIOR_THRESHOLD}
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT 1
      `,
    );

    // postgres-js RowList is array-like — index directly.
    const row = (result as unknown as Array<{ id: string; parsed_result: unknown; similarity: number }>)[0];
    if (!row) return null;

    const similarity = Number(row.similarity);
    void db
      .update(utteranceMemory)
      .set({ lastUsedAt: new Date() })
      .where(eq(utteranceMemory.id, row.id))
      .catch(() => undefined);

    const type: 'exact' | 'prior' = similarity >= EXACT_HIT_THRESHOLD ? 'exact' : 'prior';
    log.info('UTTERANCE_MEMORY_VECTOR_HIT', { spaceId, similarity: similarity.toFixed(3), type });

    return {
      type,
      parsedResult: row.parsed_result as ParsedExpense,
      similarity,
      rowId: row.id,
    };
  } catch (err) {
    log.warn('UTTERANCE_MEMORY_LOOKUP_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return null;
  }
}

/**
 * Store (or update) an utterance + its parsed result.
 * Called after every LLM/regex parse regardless of confidence — we let
 * the confirm/reject feedback loop decide what to trust.
 *
 * Fire-and-forget safe: all errors are swallowed internally.
 */
export async function recordUtterance(
  spaceId: string,
  text: string,
  parsedResult: ParsedExpense,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  let vector: number[];
  try {
    vector = await embed(trimmed);
  } catch {
    return;
  }
  if (vector.every((v) => v === 0)) return;

  const norm = normalise(trimmed);
  const hash = hashText(norm);

  try {
    await db
      .insert(utteranceMemory)
      .values({
        spaceId,
        text: trimmed,
        textHash: hash,
        embedding: vector,
        parsedResult: parsedResult as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [utteranceMemory.spaceId, utteranceMemory.textHash],
        set: {
          parsedResult: parsedResult as unknown as Record<string, unknown>,
          lastUsedAt: new Date(),
        },
      });

    log.info('UTTERANCE_MEMORY_STORED', { spaceId });
  } catch (err) {
    log.warn('UTTERANCE_MEMORY_STORE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/**
 * User confirmed this parse — bump confirm_count and recompute accuracy.
 * Call this from the /confirm route after a successful persist.
 */
export async function recordConfirmation(spaceId: string, text: string): Promise<void> {
  const hash = hashText(normalise(text.trim()));
  try {
    await db.execute(sql`
      UPDATE utterance_memory
      SET
        confirm_count = confirm_count + 1,
        last_accuracy = (confirm_count + 1)::real /
                        NULLIF(confirm_count + 1 + reject_count, 0)
      WHERE space_id = ${spaceId}
        AND text_hash = ${hash}
    `);
  } catch (err) {
    log.warn('UTTERANCE_MEMORY_CONFIRM_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/**
 * User rejected / edited this parse — bump reject_count and recompute accuracy.
 * Call this from the /confirm route when the user edits a draft field.
 */
export async function recordRejection(spaceId: string, text: string): Promise<void> {
  const hash = hashText(normalise(text.trim()));
  try {
    await db.execute(sql`
      UPDATE utterance_memory
      SET
        reject_count = reject_count + 1,
        last_accuracy = confirm_count::real /
                        NULLIF(confirm_count + reject_count + 1, 0)
      WHERE space_id = ${spaceId}
        AND text_hash = ${hash}
    `);
  } catch (err) {
    log.warn('UTTERANCE_MEMORY_REJECT_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}
