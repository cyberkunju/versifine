/**
 * Prompt Evolver — dynamic, per-space LLM prompt assembly.
 *
 * The static system prompt in parser.ts is a good general baseline, but
 * every user has their own vocabulary, language mix, and phrasing quirks.
 * This module makes the prompt *living*: it assembles a fresh prompt for
 * each parse call by injecting:
 *
 *   1. The Spending DNA prior hint (preferred wallets, common categories).
 *   2. The top-N hardest space-specific examples ordered by difficulty_score
 *      (= 1 − initial_confidence).  Hard examples are more valuable as
 *      few-shot context: they teach the model the edge-cases it would
 *      otherwise flunk.
 *
 * After every confirmed high-confidence parse, `recordExample()` upserts
 * the utterance + result into `prompt_examples` so future prompts improve.
 *
 * Graceful degradation: if the DB is unavailable or there are no examples
 * yet, `buildDynamicSystemPrompt()` returns the static base prompt unchanged.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.ts';
import { promptExamples } from '../../../db/schema/spendingDna.ts';
import { log } from '../../../utils/logger.ts';
import type { ParsedExpense } from '../parser.ts';
import { getDna, dnaToPriorHint } from './spendingDna.ts';

/** Max few-shot examples to inject into the dynamic prompt. */
const MAX_EXAMPLES = 5;

/** Only store examples where the initial confidence was ≤ this (hard cases). */
const HARD_CASE_CEILING = 0.88;

/**
 * Record a confirmed parse as a potential few-shot example.
 * Only stored if confidence < HARD_CASE_CEILING so we keep hard cases.
 *
 * Fire-and-forget safe.
 */
export async function recordExample(
  spaceId: string,
  utterance: string,
  parsedResult: ParsedExpense,
  initialConfidence: number,
): Promise<void> {
  if (initialConfidence >= HARD_CASE_CEILING) return; // only hard cases
  const difficulty = 1 - initialConfidence;

  try {
    await db
      .insert(promptExamples)
      .values({
        spaceId,
        utterance: utterance.trim(),
        parsedJson: parsedResult as unknown as Record<string, unknown>,
        difficultyScore: difficulty,
        useCount: 0,
      })
      .onConflictDoUpdate({
        target: [promptExamples.spaceId, promptExamples.utterance],
        set: {
          parsedJson: parsedResult as unknown as Record<string, unknown>,
          difficultyScore: difficulty,
        },
      });
  } catch (err) {
    log.warn('PROMPT_EVOLVER_RECORD_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/**
 * Fetch the top-N hardest confirmed examples for a space.
 * Returns [] when none exist yet.
 */
async function getTopExamples(
  spaceId: string,
  limit = MAX_EXAMPLES,
): Promise<Array<{ utterance: string; parsedJson: Record<string, unknown> }>> {
  try {
    const rows = await db
      .select({
        utterance: promptExamples.utterance,
        parsedJson: promptExamples.parsedJson,
        id: promptExamples.id,
      })
      .from(promptExamples)
      .where(eq(promptExamples.spaceId, spaceId))
      .orderBy(desc(promptExamples.difficultyScore))
      .limit(limit);

    // Bump use_count asynchronously — do not block.
    if (rows.length > 0) {
      for (const row of rows) {
        void db
          .update(promptExamples)
          .set({ useCount: sql`use_count + 1` })
          .where(eq(promptExamples.id, row.id))
          .catch(() => undefined);
      }
    }

    return rows.map((r) => ({
      utterance: r.utterance,
      parsedJson: r.parsedJson as Record<string, unknown>,
    }));
  } catch (err) {
    log.warn('PROMPT_EVOLVER_FETCH_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return [];
  }
}

/**
 * Format a single few-shot example into the prompt style used by the
 * base SYSTEM_PROMPT (input line → JSON output line).
 */
function formatExample(utterance: string, parsedJson: Record<string, unknown>): string {
  const json = JSON.stringify(parsedJson);
  return `  "${utterance}"\n  → ${json}`;
}

/**
 * Build the full dynamic system prompt for a space.
 *
 * @param basePrompt   The static SYSTEM_PROMPT from parser.ts.
 * @param spaceId      The space to personalise for. Pass null/undefined to
 *                     skip personalisation (returns basePrompt unchanged).
 */
export async function buildDynamicSystemPrompt(
  basePrompt: string,
  spaceId: string | null | undefined,
): Promise<string> {
  if (!spaceId) return basePrompt;

  const [dna, examples] = await Promise.all([
    getDna(spaceId).catch(() => null),
    getTopExamples(spaceId).catch(() => [] as Array<{ utterance: string; parsedJson: Record<string, unknown> }>),
  ]);

  const injections: string[] = [];

  // ── 1. DNA prior hint ──────────────────────────────────────────
  if (dna) {
    const hint = dnaToPriorHint(dna);
    if (hint) injections.push(hint);
  }

  // ── 2. Space-specific few-shot examples ────────────────────────
  if (examples.length > 0) {
    const block = [
      '',
      'Space-specific examples (from this user\'s confirmed parses — highest-weight):',
      ...examples.map((e) => formatExample(e.utterance, e.parsedJson)),
    ].join('\n');
    injections.push(block);
  }

  if (injections.length === 0) return basePrompt;

  return `${basePrompt}\n\n${injections.join('\n\n')}`;
}
