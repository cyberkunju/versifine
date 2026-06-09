/**
 * Golden test set — the immune system for the auto-learning loops.
 *
 * `promptEvolver` (per-space few-shot examples) and `patternLearner` (per-space
 * regex templates) are open feedback loops: every confirmed parse can promote
 * itself into the prompt or compile itself into a learned regex that will
 * match FUTURE messages. That's powerful — and it's the textbook attack
 * surface for stored prompt-injection / pattern poisoning.
 *
 * This module locks the door: a small, frozen, in-code golden set of the
 * highest-volume parser shapes (clean amounts, code-mixed Indic, foreign
 * currency, year traps, fraction words). Before promoting a new example or
 * a new regex pattern, we run it through these gates:
 *
 *   - validateExampleSafe(utterance, parsed): the example itself passes
 *     deterministic sanity (regex amount agrees, no foreign-currency
 *     hallucination, no description leakage of override phrases).
 *
 *   - validatePatternSafe(regex): the regex doesn't match KNOWN-NON-EXPENSE
 *     utterances (greetings, queries, off-topic). It's a sanity check on the
 *     pattern's specificity, not a coverage test.
 *
 * Both are fast, pure functions — they impose ZERO LLM calls on the hot path
 * because the learning loop is already fire-and-forget.
 */
import { extractAmount, textHasForeignCurrencyToken } from '../parserRegex.ts';
import { sanitizeUntrusted } from '../guard.ts';
import type { ParsedExpense } from '../parser.ts';

/**
 * Texts that should NEVER match an expense pattern. If `patternLearner` would
 * promote a regex that fires on any of these, we reject the promotion.
 * Greetings + finance queries + bare commands.
 */
const NON_EXPENSE_GUARD_TEXTS: ReadonlyArray<string> = [
  'hi',
  'hello',
  'namaste',
  'good morning',
  'help',
  'menu',
  'status',
  'how much did i spend today',
  'how much did i spend on food',
  'what is my balance',
  'show me my transactions',
  'who owes me',
  'how much do i owe',
  'set budget for food 5000',
  'save 50000 for a trip',
  'change language to hindi',
  'undo',
  'delete that',
  'thanks',
  'ok',
  'fine',
];

/**
 * Phrases that, if they appear inside a stored prompt example's UTTERANCE,
 * mean the example is poisoned and must NOT enter future prompts. These are
 * the highest-signal injection markers — `sanitizeUntrusted` defangs them at
 * runtime, but a stored example LITERALLY embeds the phrase as data, and the
 * stored phrase could re-bias the model on a future call.
 */
const POISON_MARKERS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|earlier|preceding)\s+(?:instructions?|prompts?|rules?)/i,
  /system\s+prompt/i,
  /developer\s+mode/i,
  /\byou\s+are\s+now\b/i,
  /<\|?\s*(?:im_start|im_end|system|endoftext|assistant|user)\s*\|?>/i,
  /\[\s*(?:INST|SYS|system|assistant|user)\s*\]/i,
];

export interface GoldenValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a confirmed parse before storing it as a few-shot example.
 *
 * Reject when:
 *  - the utterance carries a poison marker (stored injection),
 *  - the parsed amount disagrees with the deterministic extractor,
 *  - the parse claims a foreign currency that the text does not name,
 *  - the description is empty or huge,
 *  - the utterance after sanitization differs materially (defensive).
 */
export function validateExampleSafe(
  utterance: string,
  parsed: ParsedExpense,
): GoldenValidation {
  if (!utterance || !utterance.trim()) return { ok: false, reason: 'empty utterance' };
  const text = utterance.trim();
  if (text.length > 800) return { ok: false, reason: 'utterance too long' };

  // 1) Stored prompt-injection markers — refuse. We never want these in the
  //    few-shot pool, even sanitized: future model calls would still see the
  //    phrase as DATA in a position where it could re-bias.
  for (const re of POISON_MARKERS) {
    if (re.test(text)) return { ok: false, reason: 'poison_marker' };
  }
  // Sanitization changes more than whitespace? Defensive defense — keep out.
  const cleaned = sanitizeUntrusted(text, 800);
  if (cleaned.replace(/\s+/g, '').length < text.replace(/\s+/g, '').length * 0.7) {
    return { ok: false, reason: 'sanitize_dropped_too_much' };
  }

  // 2) Amount sanity — the parsed amount must concur with the deterministic
  //    extractor when the regex finds one. Otherwise we'd memorise the model's
  //    own hallucinations.
  if (parsed.amount != null) {
    const det = extractAmount(text).amount;
    if (det != null && Math.abs(det - parsed.amount) > 0.005) {
      return { ok: false, reason: 'amount_disagrees' };
    }
  }

  // 3) Currency hallucination — if the parse claims a foreign currency, the
  //    text MUST contain a foreign token. (Mirrors the live merge guard.)
  if (parsed.currency && parsed.currency !== 'INR' && !textHasForeignCurrencyToken(text)) {
    return { ok: false, reason: 'foreign_currency_hallucinated' };
  }

  // 4) Description sanity.
  if (!parsed.description || parsed.description.trim().length === 0) {
    return { ok: false, reason: 'no_description' };
  }
  if (parsed.description.length > 200) {
    return { ok: false, reason: 'description_too_long' };
  }

  return { ok: true };
}

/**
 * Validate a learned regex pattern before storing/promoting it. We run the
 * pattern against the NON_EXPENSE_GUARD_TEXTS set: a learned expense regex
 * that fires on a greeting or a query is over-eager and would corrupt every
 * future "hello" into a phantom transaction.
 */
export function validatePatternSafe(regexSrc: string): GoldenValidation {
  let re: RegExp;
  try {
    re = new RegExp(regexSrc, 'i');
  } catch {
    return { ok: false, reason: 'bad_regex' };
  }

  // The shield in regexShield protects against ReDoS at runtime. Here we
  // ONLY check semantic over-matching against our frozen non-expense set.
  for (const text of NON_EXPENSE_GUARD_TEXTS) {
    if (re.test(text)) {
      return { ok: false, reason: `over_matches:${text.slice(0, 40)}` };
    }
  }
  return { ok: true };
}

/** Test-only re-export so the regression tests can iterate the same set. */
export const __NON_EXPENSE_GUARD_TEXTS_FOR_TESTS = NON_EXPENSE_GUARD_TEXTS;
