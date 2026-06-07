/**
 * Translate-for-user.
 *
 * Three of our six languages (en, hi, ml) ship with hand-written message
 * packs in the bot, so we never call the model for them. The remaining
 * three (ta, te, kn) are translated at runtime with a strict validator:
 * the output must contain enough target-script characters AND be free
 * of sibling-script contamination (Tamil leaking into Malayalam, etc).
 *
 * On validation failure we retry once with a sharper prompt. If that
 * still fails we return the source text — better one untranslated line
 * than a confidently wrong one.
 */
import { LANGUAGE_META, SIBLING_SCRIPTS, type Language } from '@versifine/shared';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, normalizeChatParams, withLatency } from './client.ts';

const NATIVE_PACK_LANGS: ReadonlyArray<Language> = ['en', 'hi', 'ml'];

const TARGET_SCRIPT_THRESHOLD = 0.5;
const SIBLING_CONTAMINATION_LIMIT = 0.05;

const PRESERVE_BLOCK = `Preserve verbatim, do NOT translate:
- emojis (😀 🎉 etc)
- markdown markers (*, **, _, \`, \`\`\`, > )
- numbered list markers (1. 2. 3.)
- the rupee symbol "₹"
- the SAME numeric digits the user wrote (do not localize numerals)
- Latin uppercase command keywords like MENU, BACK, RESET, LINK, HELP, STATUS, UNDO, LANGUAGE, HUMAN, STOP`;

function translatePrompt(target: Language): string {
  const meta = LANGUAGE_META[target];
  return `You translate financial chat messages from English (or any source) into ${meta.englishName} (native script: ${meta.nativeName}).
Output ONLY the translated text in ${meta.englishName} script. Do not output any other script.
${PRESERVE_BLOCK}`;
}

function sharpRetryPrompt(target: Language): string {
  const meta = LANGUAGE_META[target];
  return `Your previous reply contained the wrong script. Translate the user's message into ${meta.englishName} — and ONLY ${meta.englishName}, written in its own native script (${meta.nativeName}). Do not output a single character of any other Indian script.`;
}

interface CacheEntry {
  text: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 400;
const cache = new Map<string, CacheEntry>();

function cacheKey(language: Language, text: string): string {
  return `${language}::${text}`;
}

function readCache(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.text;
}

function writeCache(key: string, text: string): void {
  if (cache.size >= CACHE_MAX) {
    const eldest = cache.keys().next().value as string | undefined;
    if (eldest) cache.delete(eldest);
  }
  cache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface ScriptStats {
  total: number;
  target: number;
  contaminated: number;
}

function countLetters(text: string, regex: RegExp): number {
  // matchAll-friendly without resetting lastIndex on the shared regex
  const re = new RegExp(regex.source, 'g');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function statsFor(text: string, target: Language): ScriptStats {
  // We only count letters of any tracked script (target + siblings + Devanagari + Malayalam + Latin).
  // Numbers, punctuation, emoji are ignored entirely so they don't dilute the ratio.
  const targetCount = countLetters(text, LANGUAGE_META[target].scriptRegex);
  const siblings = SIBLING_SCRIPTS[target];
  const siblingCount = siblings.reduce((acc, re) => acc + countLetters(text, re), 0);
  // Latin is not "contamination" — many finance words stay in Latin (UPI, HDFC).
  // We still count it toward total so very-short outputs don't pass on a single Latin token.
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = targetCount + siblingCount + latinCount;
  return { total, target: targetCount, contaminated: siblingCount };
}

function passesValidation(text: string, target: Language): boolean {
  if (!text.trim()) return false;
  const s = statsFor(text, target);
  if (s.total === 0) return false;
  const targetRatio = s.target / s.total;
  const contaminationRatio = s.contaminated / s.total;
  return targetRatio >= TARGET_SCRIPT_THRESHOLD && contaminationRatio < SIBLING_CONTAMINATION_LIMIT;
}

async function callTranslate(
  text: string,
  target: Language,
  systemPrompt: string,
): Promise<string | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const completion = await withLatency(`translate.${target}`, () =>
      client.chat.completions.create(
        normalizeChatParams({
          model: env.OPENAI_TRANSLATE_MODEL,
          temperature: 0.2,
          max_tokens: Math.max(256, Math.min(1024, text.length * 4)),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
        }),
      ),
    );
    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    log.warn('AI_TRANSLATE_FAIL', {
      target,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return null;
  }
}

/**
 * Translate `text` into the user's target language for display.
 *
 * Returns the source text unchanged when:
 *   - target language has a native message pack (en/hi/ml)
 *   - the API key is missing
 *   - the model failed validation twice
 */
export async function translateForUser(text: string, targetLanguage: Language): Promise<string> {
  if (!text.trim()) return text;
  if ((NATIVE_PACK_LANGS as ReadonlyArray<Language>).includes(targetLanguage)) return text;
  if (!isAIConfigured()) return text;

  const target = targetLanguage;
  const key = cacheKey(target, text);
  const cached = readCache(key);
  if (cached) return cached;

  const first = await callTranslate(text, target, translatePrompt(target));
  if (first && passesValidation(first, target)) {
    writeCache(key, first);
    return first;
  }

  log.warn('AI_TRANSLATE_VALIDATION', { target, attempt: 1 });

  // Second pass: sharper prompt, lower temperature implicit via the rephrase.
  const retryClient = getOpenAI();
  if (!retryClient) return text;
  try {
    const completion = await withLatency(`translate.${target}.retry`, () =>
      retryClient.chat.completions.create(
        normalizeChatParams({
          model: env.OPENAI_TRANSLATE_MODEL,
          temperature: 0,
          max_tokens: Math.max(256, Math.min(1024, text.length * 4)),
          messages: [
            { role: 'system', content: sharpRetryPrompt(target) },
            { role: 'user', content: text },
          ],
        }),
      ),
    );
    const second = completion.choices[0]?.message?.content?.trim() ?? '';
    if (second && passesValidation(second, target)) {
      writeCache(key, second);
      return second;
    }
    log.warn('AI_TRANSLATE_VALIDATION', { target, attempt: 2 });
  } catch (err) {
    log.warn('AI_TRANSLATE_RETRY_FAIL', {
      target,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
  }

  return text;
}

/** Test-only escape hatch. */
export function __clearTranslateCacheForTests(): void {
  cache.clear();
}
