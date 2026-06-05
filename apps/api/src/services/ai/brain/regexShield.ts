/**
 * Regex Shield — the never-throw contract for every regex operation.
 *
 * The "regex strictly should not fail no matter what" requirement is
 * implemented here as a hard API contract:
 *
 *   safeRegexExec()  — executes a pattern string against text; on ANY error
 *                      (invalid syntax, catastrophic backtracking guard) it
 *                      returns null and optionally enqueues a repair request.
 *
 *   safeRegexTest()  — same guarantee, returns boolean.
 *
 *   compilePattern() — try-compile a regex string; returns the compiled
 *                      RegExp on success or null on failure (never throws).
 *
 * Catastrophic-backtracking guard: patterns longer than MAX_PATTERN_LEN chars
 * are rejected immediately — a 2000-char regex is almost certainly corrupt or
 * adversarially crafted.
 *
 * All errors are logged (REGEX_SHIELD_FAIL) and the caller degrades gracefully
 * by receiving null / false, allowing the next pipeline tier to take over.
 */
import { log } from '../../../utils/logger.ts';

/** Safety ceiling on pattern length — anything above this is suspicious. */
const MAX_PATTERN_LEN = 2000;

/** Shared repair-request queue so callers outside this module can enqueue. */
const repairQueue = new Set<string>();

/**
 * Enqueue a broken pattern string for the self-healer.
 * Dequeued by `selfHealer.drainRepairQueue()` on its next run.
 */
export function enqueueRepair(patternId: string): void {
  repairQueue.add(patternId);
}

/** Returns and clears the current repair queue. */
export function drainRepairQueue(): string[] {
  const items = [...repairQueue];
  repairQueue.clear();
  return items;
}

/**
 * Try to compile a regex pattern string.
 * Returns `null` (never throws) if the pattern is invalid or too long.
 */
export function compilePattern(pattern: string, flags = 'i'): RegExp | null {
  if (!pattern || pattern.length > MAX_PATTERN_LEN) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    log.warn('REGEX_SHIELD_COMPILE_FAIL', { patternSnippet: pattern.slice(0, 80) });
    return null;
  }
}

/**
 * Execute a pre-compiled or string pattern against `text`.
 * On any error returns null — NEVER throws.
 *
 * @param patternOrRegex  A compiled RegExp or a raw pattern string.
 * @param text            The input to test.
 * @param flags           Flags used only when `patternOrRegex` is a string.
 * @param patternId       Optional DB id for the pattern — if provided the
 *                        id is pushed onto the repair queue on failure.
 */
export function safeRegexExec(
  patternOrRegex: RegExp | string,
  text: string,
  flags = 'i',
  patternId?: string,
): RegExpExecArray | null {
  try {
    const re =
      patternOrRegex instanceof RegExp ? patternOrRegex : compilePattern(patternOrRegex, flags);
    if (!re) {
      if (patternId) enqueueRepair(patternId);
      return null;
    }
    return re.exec(text);
  } catch (err) {
    log.warn('REGEX_SHIELD_EXEC_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
      patternId,
    });
    if (patternId) enqueueRepair(patternId);
    return null;
  }
}

/**
 * Test a pre-compiled or string pattern against `text`.
 * On any error returns false — NEVER throws.
 */
export function safeRegexTest(
  patternOrRegex: RegExp | string,
  text: string,
  flags = 'i',
  patternId?: string,
): boolean {
  return safeRegexExec(patternOrRegex, text, flags, patternId) !== null;
}
