/**
 * Translate-for-user — Sarvam Mayura first, OpenAI as a fallback.
 *
 * en/hi/ml ship hand-translated copy in the bot, so those never hit a model.
 * Every other supported language (ta/te/kn/bn/mr/gu/pa/od) is rendered at
 * send time by translating the English bot copy into the user's language.
 *
 * Provider order:
 *   1. Sarvam Mayura (`/translate`) — purpose-built for Indian languages,
 *      native script, code-mix aware. This is the primary path.
 *   2. OpenAI chat — a generic per-language fallback when Sarvam is
 *      unavailable or returns the wrong script.
 *
 * Either way the output is script-validated: at least 50% of the alphabetic
 * characters must be in the target script and under 5% may be a sibling
 * Indic script. On total failure we return the English source unchanged —
 * better one clean English line than confidently wrong text.
 */
import { LANGUAGE_META, SIBLING_SCRIPTS, type Language } from '@versifine/shared';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';
import { withLatency } from './client.ts';

/** Languages with hand-translated packs — never translated at runtime. */
const NATIVE_PACK_LANGS: ReadonlySet<Language> = new Set(['en', 'hi', 'ml']);

const TARGET_SCRIPT_THRESHOLD = 0.3;
const SIBLING_CONTAMINATION_LIMIT = 0.05;

interface CacheEntry {
  text: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 600;
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

function countLetters(text: string, regex: RegExp): number {
  const re = new RegExp(regex.source, 'g');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

/**
 * Validate that `text` is predominantly in `target`'s script with little
 * sibling-script contamination. Generalised over every supported language.
 */
function passesValidation(text: string, target: Language): boolean {
  if (!text.trim()) return false;
  const targetCount = countLetters(text, LANGUAGE_META[target].scriptRegex);
  const siblingCount = SIBLING_SCRIPTS[target].reduce((acc, re) => acc + countLetters(text, re), 0);
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = targetCount + siblingCount + latinCount;
  if (total === 0) return false;
  const targetRatio = targetCount / total;
  const contaminationRatio = siblingCount / total;
  return targetRatio >= TARGET_SCRIPT_THRESHOLD && contaminationRatio < SIBLING_CONTAMINATION_LIMIT;
}

/* ------------------------------------------------------------------ *
 * Provider 1 — Sarvam Mayura (/translate)
 * ------------------------------------------------------------------ */

/** Sarvam caps a single translate request; bot copy is short, so we guard. */
const SARVAM_MAX_INPUT = 950;

async function sarvamTranslate(text: string, target: Language): Promise<string | null> {
  if (!env.SARVAM_API_KEY) return null;
  if (text.length > SARVAM_MAX_INPUT) return null;
  try {
    const res = await withLatency(`sarvam.translate.${target}`, () =>
      fetch(`${env.SARVAM_API_URL}/translate`, {
        method: 'POST',
        headers: {
          'api-subscription-key': env.SARVAM_API_KEY as string,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          // The bot's source copy is English; Mayura still auto-corrects if a
          // fragment is already localized.
          source_language_code: 'en-IN',
          target_language_code: LANGUAGE_META[target].bcp47,
          // 'formal' translates completely into the native script. The
          // 'modern-colloquial' mode deliberately keeps English words
          // ("Coffee", "logged", "under"), which reads as broken code-mix in a
          // UI confirmation — so we use formal for clean, fully-native output.
          mode: 'formal',
          output_script: null,
          numerals_format: 'international',
        }),
      }),
    );
    if (!res.ok) {
      log.warn('SARVAM_TRANSLATE_HTTP', { target, status: res.status });
      return null;
    }
    const json = (await res.json().catch(() => null)) as { translated_text?: string } | null;
    const out = json?.translated_text?.trim();
    return out && out.length > 0 ? out : null;
  } catch (err) {
    log.warn('SARVAM_TRANSLATE_FAIL', {
      target,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Translation (Sarvam Mayura only — no OpenAI fallback, policy 2026-06-08)
 * ------------------------------------------------------------------ */

/**
 * Translate a user's native-language message INTO English for the
 * understanding pipeline (intent + parse + copilot). Used for languages where
 * the LLM is weaker, so GPT always reasons over English while the reply is
 * localized back into the user's language afterwards. Numbers are preserved
 * (international numerals) so amount extraction still works.
 *
 * Returns null when Sarvam is unavailable or the call fails, so the caller
 * falls back to sending the original text.
 */
export async function translateToEnglish(text: string, source: Language): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (source === 'en') return null;
  if (!env.SARVAM_API_KEY) return null;
  if (trimmed.length > SARVAM_MAX_INPUT) return null;

  const key = cacheKey('en' as Language, `${source}>${trimmed}`);
  const cached = readCache(key);
  if (cached) return cached;

  try {
    const res = await withLatency(`sarvam.translate.en`, () =>
      fetch(`${env.SARVAM_API_URL}/translate`, {
        method: 'POST',
        headers: {
          'api-subscription-key': env.SARVAM_API_KEY as string,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input: trimmed,
          // Auto-detect handles code-mixed input (native + English words).
          source_language_code: 'auto',
          target_language_code: 'en-IN',
          mode: 'formal',
          numerals_format: 'international',
        }),
      }),
    );
    if (!res.ok) {
      log.warn('SARVAM_TO_EN_HTTP', { source, status: res.status });
      return null;
    }
    const json = (await res.json().catch(() => null)) as { translated_text?: string } | null;
    const out = json?.translated_text?.trim();
    if (!out) return null;
    writeCache(key, out);
    return out;
  } catch (err) {
    log.warn('SARVAM_TO_EN_FAIL', {
      source,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

/**
 * Translate a dynamic CHAT/copilot answer (always produced in English by the
 * model) into the user's language. Unlike `translateForUser`, this is NOT
 * gated by the native-pack set: hi/ml chat answers ARE translated too, because
 * the model's direct Indic output is clunky ("ഒരു ചെലവ് നോട്ടാക്കണോ") whereas
 * Sarvam Mayura's `formal` mode is clean, natural, fully-native. Fixed UI
 * strings still use the hand-written packs via `translateForUser`.
 */
export async function translateChatAnswer(text: string, target: Language): Promise<string> {
  if (!text.trim()) return text;
  if (target === 'en') return text;
  // Already predominantly in the target script? Leave it.
  if (passesValidation(text, target)) return text;

  const key = cacheKey(target, `chat>${text}`);
  const cached = readCache(key);
  if (cached) return cached;

  const viaSarvam = await sarvamTranslate(text, target);
  if (viaSarvam && passesValidation(viaSarvam, target)) {
    writeCache(key, viaSarvam);
    return viaSarvam;
  }
  // No second provider (Sarvam-only policy). Return whatever Sarvam produced
  // even if mixed, else the English source — never a confidently-wrong guess.
  return viaSarvam ?? text;
}

/**
 * Translate `text` into the user's target language for outgoing display.
 * Returns the source unchanged when the target has a native pack, when the
 * text is already in the target script, or when every provider fails.
 */
export async function translateForUser(text: string, targetLanguage: Language): Promise<string> {
  if (!text.trim()) return text;
  if (NATIVE_PACK_LANGS.has(targetLanguage)) return text;

  // Already in the target script (e.g. the copilot answered in-language)?
  // Don't double-translate.
  if (passesValidation(text, targetLanguage)) return text;

  const key = cacheKey(targetLanguage, text);
  const cached = readCache(key);
  if (cached) return cached;

  // 1) Sarvam Mayura — the only translator (no OpenAI fallback).
  const viaSarvam = await sarvamTranslate(text, targetLanguage);
  if (viaSarvam && passesValidation(viaSarvam, targetLanguage)) {
    writeCache(key, viaSarvam);
    return viaSarvam;
  }
  // Sarvam unavailable or under-translated → return the English source rather
  // than a wrong-script guess (primary-only policy).
  return text;
}
