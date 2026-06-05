/**
 * Reinforcement — wires user feedback into every learning layer.
 *
 * This is the central signal router. Every time a user confirms or rejects
 * a parse, one function call here fans the signal out to all downstream
 * learning systems:
 *
 *   onConfirmed()
 *     → utteranceMemory.recordConfirmation()   — boosts memory row accuracy
 *     → learnPatternFromParse()                — may create/reinforce regex
 *     → utteranceMemory.recordUtterance()      — ensures row is current
 *     → spendingDna.rebuildDna()               — refreshes behavioural profile
 *     → promptEvolver.recordExample()          — adds to few-shot pool if hard
 *     → Pattern table confirm_count++          — may promote pattern to 'gold'
 *
 *   onRejected()
 *     → utteranceMemory.recordRejection()      — reduces memory row accuracy
 *     → learnPatternFromParse(corrected)       — learns the corrected version
 *     → Pattern table reject_count++           — may demote pattern to 'demoted'
 *     → selfHealer.checkAndHeal()              — triggers repair if needed
 *
 * All operations are fire-and-forget (void async) so the user-facing
 * confirm response is never delayed by learning overhead.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.ts';
import { learnedPatterns } from '../../../db/schema/patterns.ts';
import { log } from '../../../utils/logger.ts';
import { learnPatternFromParse } from '../patternLearner.ts';
import type { ParsedExpense } from '../parser.ts';
import { recordExample } from './promptEvolver.ts';
import { checkAndHeal } from './selfHealer.ts';
import { rebuildDna } from './spendingDna.ts';
import { recordConfirmation, recordRejection, recordUtterance } from './utteranceMemory.ts';

/** Accuracy threshold below which a pattern gets demoted. */
const DEMOTE_ACCURACY = 0.30;

/** Accuracy + volume threshold for 'gold' promotion. */
const GOLD_ACCURACY = 0.90;
const GOLD_MIN_CONFIRMS = 20;

/* ── pattern-table helpers ────────────────────────────────────────────── */

/**
 * Find the pattern row (if any) that last matched `text` for `spaceId`.
 * We do this by re-testing all active/gold patterns — cheap for typical
 * pattern set sizes (< 200 per space).
 */
async function findMatchingPattern(
  spaceId: string,
  text: string,
): Promise<{ id: string; confirmCount: number; rejectCount: number } | null> {
  try {
    const patterns = await db
      .select()
      .from(learnedPatterns)
      .where(
        and(
          eq(learnedPatterns.spaceId, spaceId),
          sql`${learnedPatterns.status} IN ('active', 'gold')`,
        ),
      );

    const trimmed = text.trim();
    for (const p of patterns) {
      try {
        const re = new RegExp(p.regex, 'i');
        if (re.test(trimmed)) {
          return { id: p.id, confirmCount: p.confirmCount, rejectCount: p.rejectCount };
        }
      } catch {
        // Shield: skip broken patterns silently.
      }
    }
  } catch (err) {
    log.warn('REINFORCEMENT_PATTERN_FIND_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
  return null;
}

async function incrementPatternConfirm(patternId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE learned_patterns
      SET
        confirm_count = confirm_count + 1,
        last_accuracy = (confirm_count + 1)::real /
                        NULLIF(confirm_count + 1 + reject_count, 0),
        status = CASE
          WHEN (confirm_count + 1) >= ${GOLD_MIN_CONFIRMS}
               AND ((confirm_count + 1)::real / NULLIF(confirm_count + 1 + reject_count, 0)) >= ${GOLD_ACCURACY}
          THEN 'gold'
          ELSE status
        END,
        promoted_at = CASE
          WHEN (confirm_count + 1) >= ${GOLD_MIN_CONFIRMS}
               AND ((confirm_count + 1)::real / NULLIF(confirm_count + 1 + reject_count, 0)) >= ${GOLD_ACCURACY}
               AND status != 'gold'
          THEN NOW()
          ELSE promoted_at
        END,
        updated_at = NOW()
      WHERE id = ${patternId}
    `);
  } catch (err) {
    log.warn('REINFORCEMENT_CONFIRM_PATTERN_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

async function incrementPatternReject(patternId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE learned_patterns
      SET
        reject_count = reject_count + 1,
        last_accuracy = confirm_count::real /
                        NULLIF(confirm_count + reject_count + 1, 0),
        status = CASE
          WHEN (confirm_count::real / NULLIF(confirm_count + reject_count + 1, 0)) < ${DEMOTE_ACCURACY}
               AND status = 'active'
          THEN 'demoted'
          ELSE status
        END,
        updated_at = NOW()
      WHERE id = ${patternId}
    `);
  } catch (err) {
    log.warn('REINFORCEMENT_REJECT_PATTERN_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/* ── public API ───────────────────────────────────────────────────────── */

/**
 * Fire after the user explicitly confirms a parse (POST /confirm succeeds).
 *
 * @param spaceId       Active space.
 * @param originalText  The raw utterance that produced this parse.
 * @param parsedResult  The confirmed ParsedExpense.
 */
export async function onConfirmed(
  spaceId: string,
  originalText: string,
  parsedResult: ParsedExpense,
): Promise<void> {
  log.info('REINFORCEMENT_CONFIRMED', { spaceId, confidence: parsedResult.confidence });

  await Promise.allSettled([
    // Memory layer
    recordConfirmation(spaceId, originalText),
    recordUtterance(spaceId, originalText, parsedResult),

    // Pattern layer
    (async () => {
      const match = await findMatchingPattern(spaceId, originalText);
      if (match) await incrementPatternConfirm(match.id);
      else if (parsedResult.confidence >= 0.75) {
        await learnPatternFromParse(spaceId, originalText, parsedResult);
      }
    })(),

    // Profile + prompt layers
    rebuildDna(spaceId),
    recordExample(spaceId, originalText, parsedResult, parsedResult.confidence),
  ]);
}

/**
 * Fire after the user edits a draft field before confirming
 * (i.e. the original parse was wrong about at least one field).
 *
 * @param spaceId        Active space.
 * @param originalText   The raw utterance that produced the wrong parse.
 * @param originalResult The parse that was wrong.
 * @param correctedResult The corrected parse (after user edits).
 */
export async function onRejected(
  spaceId: string,
  originalText: string,
  originalResult: ParsedExpense,
  correctedResult: ParsedExpense,
): Promise<void> {
  log.info('REINFORCEMENT_REJECTED', {
    spaceId,
    originalConf: originalResult.confidence,
  });

  await Promise.allSettled([
    // Memory layer
    recordRejection(spaceId, originalText),
    // Store the corrected parse so future memory lookups get the right answer.
    recordUtterance(spaceId, originalText, correctedResult),

    // Pattern layer — demote old, learn corrected
    (async () => {
      const match = await findMatchingPattern(spaceId, originalText);
      if (match) {
        await incrementPatternReject(match.id);
        // If the corrected parse is complete, trigger healer check.
        if (match.rejectCount + 1 >= 3) {
          void checkAndHeal(spaceId, match.id).catch(() => undefined);
        }
      }
      // Always learn the corrected version as a new competing pattern.
      if (correctedResult.confidence >= 0.7) {
        await learnPatternFromParse(spaceId, originalText, correctedResult);
      }
    })(),
  ]);
}
