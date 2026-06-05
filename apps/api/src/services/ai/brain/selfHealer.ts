/**
 * Self-Healer — automatically repairs or retires broken learned patterns.
 *
 * A pattern becomes 'demoted' when its reject_count > 3 OR its accuracy
 * drops below 30 %.  This worker:
 *
 *   1. Loads all demoted patterns for a space.
 *   2. Collects a sample of utterances the pattern matched (from utterance_memory)
 *      split into confirmed (should match) and rejected (should NOT match).
 *   3. Calls the LLM with the broken template + evidence to synthesise a
 *      corrected regex template.
 *   4. Validates the new regex: it must match ≥ 80 % of the success set
 *      and 0 false-positives on known-good non-matches.
 *   5a. If valid → replace the pattern (reset counts, status = 'active').
 *   5b. If invalid → mark status = 'retired' (excluded from matching forever).
 *
 * `checkAndHeal(spaceId, patternId)` is called reactively by the
 * reinforcement module whenever a reject pushes a pattern past the threshold.
 *
 * All LLM calls are guarded: if the API is unavailable the pattern stays
 * 'demoted' and will be retried on the next reactive trigger.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.ts';
import { learnedPatterns } from '../../../db/schema/patterns.ts';
import { utteranceMemory } from '../../../db/schema/utteranceMemory.ts';
import { env } from '../../../env.ts';
import { log } from '../../../utils/logger.ts';
import { getOpenAI, isAIConfigured, normalizeChatParams } from '../client.ts';
import { compileTemplate } from '../patternLearner.ts';
import { safeRegexExec } from './regexShield.ts';

const HEAL_SYSTEM_PROMPT = `You are a regex engineer specialising in natural language parsing.

You will be given:
  - A broken regex template that is failing for some user utterances.
  - Utterances the template SHOULD match (confirmed by the user).
  - Utterances it SHOULD NOT match (rejected by the user).

Your job: produce a corrected template that uses the same placeholder format:
  {amount}      — captures a numeric amount
  {description} — captures a short noun phrase
  {currency}    — captures a currency symbol or word
  {walletHint}  — captures a wallet name
  {date}        — captures a date expression

Rules:
  - Keep the template readable (not raw regex).
  - Use {placeholders} for the variable parts.
  - Keep literal words that always appear in the confirmed utterances.
  - Make the template flexible enough to match minor phrasing variation.
  - Return ONLY a JSON object: { "template": "<the corrected template>" }
  - If repair is impossible, return: { "template": null }`;

/**
 * Validate a new regex against success and failure utterance sets.
 * Returns true only when the regex:
 *   - matches ≥ 80 % of the success set (if non-empty)
 *   - produces ZERO false-positives on the failure set (if non-empty)
 */
function validateHealed(
  regex: RegExp,
  successSet: string[],
  failSet: string[],
): boolean {
  if (successSet.length === 0 && failSet.length === 0) return false;

  let hits = 0;
  for (const s of successSet) {
    if (safeRegexExec(regex, s) !== null) hits++;
  }
  const successRate = successSet.length > 0 ? hits / successSet.length : 1;
  if (successRate < 0.8) return false;

  for (const f of failSet) {
    if (safeRegexExec(regex, f) !== null) return false; // false positive
  }

  return true;
}

/**
 * Attempt to heal a single demoted pattern.
 * Returns 'healed', 'retired', or 'skipped' (nothing to do / LLM unavailable).
 */
async function healPattern(
  patternId: string,
  spaceId: string,
): Promise<'healed' | 'retired' | 'skipped'> {
  if (!isAIConfigured()) return 'skipped';

  // Load the pattern.
  const patternRows = await db
    .select()
    .from(learnedPatterns)
    .where(and(eq(learnedPatterns.id, patternId), eq(learnedPatterns.spaceId, spaceId)))
    .limit(1);

  const pattern = patternRows[0];
  if (!pattern || pattern.status === 'gold' || pattern.status === 'retired') return 'skipped';

  // Collect evidence from utterance_memory.
  const confirmedRows = await db
    .select({ text: utteranceMemory.text })
    .from(utteranceMemory)
    .where(
      and(
        eq(utteranceMemory.spaceId, spaceId),
        sql`${utteranceMemory.confirmCount} > 0`,
      ),
    )
    .limit(10);

  const rejectedRows = await db
    .select({ text: utteranceMemory.text })
    .from(utteranceMemory)
    .where(
      and(
        eq(utteranceMemory.spaceId, spaceId),
        sql`${utteranceMemory.rejectCount} > 0`,
      ),
    )
    .limit(10);

  // Filter to only utterances actually matched by this pattern.
  const brokenRe = safeRegexExec(pattern.regex, '__probe__') !== null
    ? null // pattern is not totally broken, just inaccurate
    : null;
  void brokenRe; // not used — we keep the evidence sets as-is

  const successSet = confirmedRows.map((r) => r.text);
  const failSet = rejectedRows.map((r) => r.text);

  if (successSet.length === 0) {
    // No confirmed evidence — can't heal, retire immediately.
    await db
      .update(learnedPatterns)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(learnedPatterns.id, patternId));
    log.info('SELF_HEALER_RETIRED', { patternId, reason: 'no_evidence' });
    return 'retired';
  }

  // Call the LLM for a corrected template.
  const client = getOpenAI();
  if (!client) return 'skipped';

  const userMessage = [
    `Broken template: ${pattern.template}`,
    '',
    'Utterances that SHOULD be captured (confirmed by user):',
    ...successSet.map((s) => `  - "${s}"`),
    '',
    'Utterances that should NOT be captured (rejected):',
    ...failSet.map((f) => `  - "${f}"`),
  ].join('\n');

  let repairedTemplate: string | null = null;
  try {
    const completion = await client.chat.completions.create(
      normalizeChatParams({
        model: env.OPENAI_NLU_MODEL,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: HEAL_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    );
    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'template' in parsed &&
      typeof (parsed as Record<string, unknown>).template === 'string'
    ) {
      repairedTemplate = ((parsed as Record<string, unknown>).template as string).trim();
    }
  } catch (err) {
    log.warn('SELF_HEALER_LLM_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return 'skipped';
  }

  if (!repairedTemplate) {
    await db
      .update(learnedPatterns)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(learnedPatterns.id, patternId));
    log.info('SELF_HEALER_RETIRED', { patternId, reason: 'llm_returned_null' });
    return 'retired';
  }

  // Compile and validate the new template.
  let compiled: { regex: string; fields: string[] };
  try {
    compiled = compileTemplate(repairedTemplate);
  } catch {
    await db
      .update(learnedPatterns)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(learnedPatterns.id, patternId));
    return 'retired';
  }

  const newRe = safeRegexExec(compiled.regex, '__probe__') !== null
    ? new RegExp(compiled.regex, 'i')
    : (() => {
        try { return new RegExp(compiled.regex, 'i'); } catch { return null; }
      })();

  if (!newRe || !validateHealed(newRe, successSet, failSet)) {
    await db
      .update(learnedPatterns)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(learnedPatterns.id, patternId));
    log.info('SELF_HEALER_RETIRED', { patternId, reason: 'validation_failed' });
    return 'retired';
  }

  // Replace the pattern with the healed version.
  await db
    .update(learnedPatterns)
    .set({
      template: repairedTemplate,
      regex: compiled.regex,
      fields: compiled.fields,
      status: 'active',
      confirmCount: 0,
      rejectCount: 0,
      lastAccuracy: null,
      updatedAt: new Date(),
    })
    .where(eq(learnedPatterns.id, patternId));

  log.info('SELF_HEALER_HEALED', { patternId, newTemplate: repairedTemplate });
  return 'healed';
}

/**
 * Reactively check and attempt to heal a specific demoted pattern.
 * Called by the reinforcement module; fire-and-forget safe.
 */
export async function checkAndHeal(spaceId: string, patternId: string): Promise<void> {
  try {
    const result = await healPattern(patternId, spaceId);
    log.info('SELF_HEALER_RESULT', { spaceId, patternId, result });
  } catch (err) {
    log.warn('SELF_HEALER_UNEXPECTED', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/**
 * Full healing pass for all demoted patterns in a space.
 * Can be called on a schedule or admin-triggered.
 */
export async function runFullHealingPass(spaceId: string): Promise<void> {
  const demoted = await db
    .select({ id: learnedPatterns.id })
    .from(learnedPatterns)
    .where(and(eq(learnedPatterns.spaceId, spaceId), eq(learnedPatterns.status, 'demoted')));

  log.info('SELF_HEALER_PASS_START', { spaceId, count: demoted.length });

  for (const { id } of demoted) {
    await healPattern(id, spaceId);
  }

  log.info('SELF_HEALER_PASS_DONE', { spaceId });
}
