import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { learnedPatterns } from '../../db/schema/patterns.ts';
import { log } from '../../utils/logger.ts';
import type { ParsedExpense, MissingField, ExpenseType } from './parser.ts';
import { safeRegexExec } from './brain/regexShield.ts';
import { validatePatternSafe } from './brain/goldenSet.ts';

/**
 * Compile a user-friendly template (e.g. "spent {amount} on {description}")
 * into a safe, anchored regular expression and the corresponding field ordering.
 */
export function compileTemplate(template: string): { regex: string; fields: string[] } {
  const placeholders = ['amount', 'currency', 'description', 'walletHint', 'date'];
  const placeholderRegex = /\{([a-zA-Z]+)\}/g;
  
  const fields: string[] = [];
  let match;
  while ((match = placeholderRegex.exec(template)) !== null) {
    const field = match[1];
    if (field && placeholders.includes(field)) {
      fields.push(field);
    }
  }

  // Escape special regex characters in the template except for curly braces
  let regexPattern = template.trim();
  regexPattern = regexPattern.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

  // Replace placeholders with capturing groups
  regexPattern = regexPattern
    .replace(/\{amount\}/g, '(\\d+(?:\\.\\d+)?)')
    .replace(/\{currency\}/g, '([A-Za-z$₹£€]+)')
    .replace(/\{walletHint\}/g, '([a-zA-Z0-9\\s\\-_]+)')
    .replace(/\{date\}/g, '([a-zA-Z0-9\\s\\-]+)')
    .replace(/\{description\}/g, '(.+)'); // greedy capture at end

  // Make whitespace flexible
  regexPattern = regexPattern.replace(/\s+/g, '\\s+');

  return {
    regex: `^${regexPattern}$`,
    fields,
  };
}

/**
 * Generate a template candidate from a parsed result and the original text.
 * Returns null if the parsed tokens cannot be mapped back to the text cleanly.
 */
export function generateTemplateCandidate(
  text: string,
  parsed: { amount: number | null; description: string | null; walletHint?: string | null }
): string | null {
  if (parsed.amount === null || !parsed.description) return null;

  let template = text.trim();

  // Replace description first (often text, may contain digits)
  const descEscaped = parsed.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const descRegex = new RegExp(`\\b${descEscaped}\\b`, 'i');
  if (descRegex.test(template)) {
    template = template.replace(descRegex, '{description}');
  } else {
    const descIndex = template.toLowerCase().indexOf(parsed.description.toLowerCase());
    if (descIndex !== -1) {
      template =
        template.slice(0, descIndex) +
        '{description}' +
        template.slice(descIndex + parsed.description.length);
    } else {
      return null;
    }
  }

  // Replace amount
  const amtStr = parsed.amount.toString();
  const amtRegex = new RegExp(`\\b${amtStr}\\b`);
  if (amtRegex.test(template)) {
    template = template.replace(amtRegex, '{amount}');
  } else {
    const amtIndex = template.indexOf(amtStr);
    if (amtIndex !== -1) {
      template =
        template.slice(0, amtIndex) +
        '{amount}' +
        template.slice(amtIndex + amtStr.length);
    } else {
      return null;
    }
  }

  // Replace optional wallet hint
  if (parsed.walletHint) {
    const walletEscaped = parsed.walletHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const walletRegex = new RegExp(`\\b${walletEscaped}\\b`, 'i');
    if (walletRegex.test(template)) {
      template = template.replace(walletRegex, '{walletHint}');
    }
  }

  return template;
}

/**
 * Try to parse an input text against all learned templates for the given space.
 * Returns a high-confidence parsed result if matched, else null.
 *
 * Only matches against 'active' and 'gold' patterns.
 * Uses safeRegexExec from regexShield — NEVER throws on a bad pattern.
 */
export async function tryParseLearnedPattern(
  spaceId: string,
  text: string
): Promise<Partial<ParsedExpense> | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

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

    for (const p of patterns) {
      // safeRegexExec never throws — bad patterns return null silently.
      const match = safeRegexExec(p.regex, trimmed, 'i', p.id);
      if (match) {
        log.info('PATTERN_LEARNER_MATCH', {
          template: p.template,
          status: p.status,
          text,
        });
        
        const parsed: Partial<ParsedExpense> = {
          type: 'expense' as ExpenseType,
          confidence: p.status === 'gold' ? 0.99 : 0.98,
        };

        // Extract captured fields from matching groups
        p.fields.forEach((field, idx) => {
          const matchedVal = match[idx + 1];
          if (!matchedVal) return;

          if (field === 'amount') {
            parsed.amount = Number(matchedVal);
          } else if (field === 'description') {
            parsed.description = matchedVal.trim();
          } else if (field === 'currency') {
            parsed.currency = matchedVal.trim().toUpperCase();
          } else if (field === 'walletHint') {
            parsed.walletHint = matchedVal.trim();
          } else if (field === 'date') {
            parsed.date = matchedVal.trim();
          }
        });

        // Compute missing fields
        const needs: MissingField[] = [];
        if (parsed.amount === undefined || parsed.amount === null) needs.push('amount');
        if (!parsed.description) needs.push('description');
        if (!parsed.walletHint) needs.push('wallet');
        if (!parsed.currency) needs.push('currency');

        parsed.needs = needs;

        return parsed;
      }
    }
  } catch (err) {
    log.warn('PATTERN_LEARNER_PARSE_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

/**
 * Automatically learn a new pattern if the parse succeeded with high confidence
 * and isn't already matched by an existing template.
 */
export async function learnPatternFromParse(
  spaceId: string,
  text: string,
  parsed: ParsedExpense
): Promise<void> {
  if (parsed.confidence < 0.75 || parsed.amount === null || !parsed.description) {
    return;
  }
  // Don't learn over-specific patterns. If the user wrapped the expense in a
  // story (notes present), the leftover words bake the whole story into the
  // regex and it would never match again — pure clutter. Same for any template
  // that keeps more than a couple of literal connector words after placeholder
  // substitution. We only want generalizable shapes like "{description}
  // {amount}" or "spent {amount} on {description}".
  if (parsed.notes && parsed.notes.trim()) return;
  // Never learn from a dated utterance. The date words ("yesterday", "on the
  // 5th", "last night") would bake into the regex as inert literals; a future
  // match would then return NO date and skip the date extractor, wrongly
  // dating the transaction to today. Dates must always stay dynamic.
  if (parsed.date) return;

  try {
    // Generate template candidate
    const template = generateTemplateCandidate(text, parsed);
    if (!template) return;

    // Reject over-fit templates: count literal words left after removing the
    // {placeholders}. More than 3 ⇒ it memorised a sentence, not a shape.
    const residueWords = template
      .replace(/\{[a-zA-Z]+\}/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (residueWords && residueWords.split(/\s+/).filter(Boolean).length > 3) return;

    const compiled = compileTemplate(template);

    // Validate the compiled regex before storing (shield ensures safety).
    const testMatch = safeRegexExec(compiled.regex, text, 'i');
    if (!testMatch) {
      // The template didn't actually match the source text — don't store.
      return;
    }

    // Quarantine: would this regex misfire on a known non-expense (greeting,
    // query, command)? Reject the promotion if so — an over-eager pattern
    // would corrupt every future "hello" into a phantom transaction.
    const verdict = validatePatternSafe(compiled.regex);
    if (!verdict.ok) {
      log.warn('PATTERN_LEARNER_REJECTED', { reason: verdict.reason, template });
      return;
    }

    // Save to database
    await db
      .insert(learnedPatterns)
      .values({
        spaceId,
        template,
        regex: compiled.regex,
        fields: compiled.fields,
        status: 'active',
      })
      .onConflictDoNothing();

    log.info('PATTERN_LEARNED', { spaceId, template });
  } catch (err) {
    log.warn('PATTERN_LEARNER_LEARN_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
