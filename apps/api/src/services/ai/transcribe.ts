/**
 * Voice → text. Azure/Sarvam only — NO OpenAI, NO fallbacks (policy 2026-06-08).
 *   - Indic languages → Sarvam Saaras (`/speech-to-text-translate`), primary.
 *   - English (and anything without a Sarvam key) → Azure MAI-Transcribe-1.5.
 * If the chosen primary fails we return an empty transcript (the capture route
 * then asks the user to type it) rather than silently retrying a second
 * provider. The spoken language is inferred from the SCRIPT of the returned
 * text, with the caller's hint as a last resort.
 */
import { detectScript, LANGUAGES, LANGUAGE_META, isLanguage } from '@versifine/shared';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { withLatency } from './client.ts';

export type TranscribeSource = 'sarvam' | 'mai' | 'mock';

export interface TranscribeResult {
  text: string;
  language: string;
  source: TranscribeSource;
}

/** Indic session languages routed to Sarvam (every supported lang but English). */
const SARVAM_LANGS: ReadonlySet<string> = new Set(LANGUAGES.filter((l) => l !== 'en'));
const ROMANISABLE_LANGS: ReadonlySet<string> = new Set(LANGUAGES.filter((l) => l !== 'en'));

const FILENAME_BY_MIME: Record<string, string> = {
  'audio/ogg': 'voice.ogg',
  'audio/oga': 'voice.ogg',
  'audio/opus': 'voice.ogg',
  'audio/mpeg': 'voice.mp3',
  'audio/mp3': 'voice.mp3',
  'audio/mp4': 'voice.m4a',
  'audio/m4a': 'voice.m4a',
  'audio/x-m4a': 'voice.m4a',
  'audio/wav': 'voice.wav',
  'audio/wave': 'voice.wav',
  'audio/webm': 'voice.webm',
  'audio/aac': 'voice.aac',
  'audio/flac': 'voice.flac',
};

function filenameFor(mimetype: string): string {
  return FILENAME_BY_MIME[mimetype.toLowerCase()] ?? 'voice.bin';
}

function bareLanguageHint(language?: string): string | undefined {
  if (!language) return undefined;
  const tag = language.split('-')[0]?.toLowerCase();
  return tag && tag.length === 2 ? tag : undefined;
}

/** Map a hint (2-letter or BCP47) to the Sarvam `language_code` the
 *  `/speech-to-text` endpoint expects, or `unknown` for auto-detect. */
function sarvamLanguageCode(fallback: string | undefined): string {
  if (fallback && isLanguage(fallback) && fallback !== 'en') return LANGUAGE_META[fallback].bcp47;
  return 'unknown';
}

/** Resolve the spoken language from a returned transcript: the native SCRIPT
 *  is authoritative (we asked for native-script output), then Sarvam's own
 *  `language_code`, then the caller's hint, then English. */
function languageFromTranscript(text: string, sarvamCode: string | undefined, fallback: string | undefined): string {
  const byScript = detectScript(text);
  if (byScript && byScript !== 'en') {
    // Devanagari resolves to 'hi' by script, but Hindi and Marathi share it.
    // Honour an explicit Marathi signal (Sarvam's code or the caller hint) so
    // a Marathi voice note doesn't get a Hindi reply (regression the review
    // caught vs the old translate path).
    if (byScript === 'hi' && (bareLanguageHint(sarvamCode) === 'mr' || bareLanguageHint(fallback) === 'mr')) {
      return 'mr';
    }
    return byScript;
  }
  const byCode = bareLanguageHint(sarvamCode);
  if (byCode && ROMANISABLE_LANGS.has(byCode)) return byCode;
  if (byScript === 'en') {
    const fb = bareLanguageHint(fallback);
    return fb && ROMANISABLE_LANGS.has(fb) ? fb : 'en';
  }
  return bareLanguageHint(fallback) ?? 'en';
}

function maiLocales(lang: string | undefined): string[] {
  if (lang && isLanguage(lang) && lang !== 'en') return [LANGUAGE_META[lang].bcp47, 'en-IN'];
  return ['en-IN', 'en-US'];
}

function resolveLanguage(text: string, fallback: string | undefined): string {
  const byScript = detectScript(text);
  if (byScript && byScript !== 'en') return byScript;
  if (byScript === 'en') {
    const fb = bareLanguageHint(fallback);
    return fb && ROMANISABLE_LANGS.has(fb) ? fb : 'en';
  }
  return bareLanguageHint(fallback) ?? 'en';
}

/**
 * Sarvam Indic transcription.
 *
 * Uses the TRANSLATE endpoint (saaras) as PRIMARY: real-audio testing showed
 * the downstream batch/compound parser splits an English transcript into the
 * correct multiple expenses, but mis-handles a native-script compound (1 item
 * instead of 3) — and correct transaction extraction is paramount. The
 * reply still lands in the user's language via session + per-turn detection,
 * so we don't lose language mirroring by translating for UNDERSTANDING.
 *
 * The native-script `/speech-to-text` (saarika) endpoint is kept as a fallback
 * (register-preserving) for when translate fails, and is ready to become
 * primary once the parser reliably splits native-script compounds. Returns
 * null on total failure.
 */
async function transcribeSarvam(
  audio: Buffer,
  mimetype: string,
  fallback: string | undefined,
): Promise<TranscribeResult | null> {
  if (!env.SARVAM_API_KEY) return null;
  const translated = await sarvamTranslate(audio, mimetype, fallback);
  if (translated) return translated;
  // Fallback: native-script STT. Register-preserving; used only if translate
  // is unavailable so voice still degrades to a usable transcript.
  return sarvamSpeechToText(audio, mimetype, fallback);
}

/** Native-script STT (`/speech-to-text`, saarika). Returns native script +
 *  Sarvam's detected language_code. Null on any failure. */
async function sarvamSpeechToText(
  audio: Buffer,
  mimetype: string,
  fallback: string | undefined,
): Promise<TranscribeResult | null> {
  const cleanMime = (mimetype.split(';')[0] || 'audio/ogg').trim();
  try {
    const result = await withLatency('transcribe.sarvam.native', async () => {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(audio)], { type: cleanMime }), filenameFor(cleanMime));
      fd.append('model', env.SARVAM_TRANSCRIBE_MODEL);
      fd.append('language_code', sarvamLanguageCode(fallback));
      const res = await fetch(`${env.SARVAM_API_URL.replace(/\/+$/, '')}/speech-to-text`, {
        method: 'POST',
        headers: { 'api-subscription-key': env.SARVAM_API_KEY as string },
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
      return (await res.json()) as { transcript?: string; language_code?: string };
    });
    const text = (result.transcript ?? '').trim();
    if (!text) return null;
    return { text, language: languageFromTranscript(text, result.language_code, fallback), source: 'sarvam' };
  } catch (err) {
    log.warn('SARVAM_STT_NATIVE_FAIL', { error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  }
}

/** Sarvam Saaras speech-to-text-translate (Indic → English). Fallback only. */
async function sarvamTranslate(
  audio: Buffer,
  mimetype: string,
  fallback: string | undefined,
): Promise<TranscribeResult | null> {
  const cleanMime = (mimetype.split(';')[0] || 'audio/ogg').trim();
  try {
    const result = await withLatency('transcribe.sarvam.translate', async () => {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(audio)], { type: cleanMime }), filenameFor(cleanMime));
      fd.append('model', env.SARVAM_STT_MODEL);
      const res = await fetch(`${env.SARVAM_API_URL.replace(/\/+$/, '')}/speech-to-text-translate`, {
        method: 'POST',
        headers: { 'api-subscription-key': env.SARVAM_API_KEY as string },
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
      return (await res.json()) as { transcript?: string };
    });
    const text = (result.transcript ?? '').trim();
    if (!text) return null;
    return { text, language: languageFromTranscript(text, undefined, fallback), source: 'sarvam' };
  } catch (err) {
    log.warn('SARVAM_STT_TRANSLATE_FAIL', { error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  }
}

/** Azure AI Speech — MAI-Transcribe-1.5 fast transcription (English). */
async function transcribeMai(
  audio: Buffer,
  mimetype: string,
  lang: string | undefined,
): Promise<TranscribeResult | null> {
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_ENDPOINT) return null;
  const speechKey = env.AZURE_SPEECH_KEY;
  const speechEndpoint = env.AZURE_SPEECH_ENDPOINT;
  try {
    const result = await withLatency('transcribe.mai', async () => {
      const fd = new FormData();
      fd.append('audio', new Blob([new Uint8Array(audio)], { type: mimetype }), filenameFor(mimetype));
      fd.append('definition', JSON.stringify({ locales: maiLocales(lang) }));
      const url = `${speechEndpoint.replace(/\/+$/, '')}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': speechKey },
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
      return (await res.json()) as { combinedPhrases?: Array<{ text?: string }> };
    });
    const text = (result.combinedPhrases?.[0]?.text ?? '').trim();
    if (!text) return null;
    return { text, language: resolveLanguage(text, lang), source: 'mai' };
  } catch (err) {
    log.warn('MAI_STT_FAIL', { error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  }
}

/**
 * Transcribe a buffer of speech audio. Indic → Sarvam, English → MAI; primary
 * only. Returns an empty/mock result on failure so capture flows degrade to a
 * "couldn't hear that — type it" prompt instead of crashing.
 */
export async function transcribe(
  audio: Buffer,
  mimetype: string,
  language?: string,
): Promise<TranscribeResult> {
  const fallback = bareLanguageHint(language);

  if (env.SARVAM_API_KEY && fallback && SARVAM_LANGS.has(fallback)) {
    const sv = await transcribeSarvam(audio, mimetype, fallback);
    if (sv) return sv;
    return { text: '', language: fallback ?? 'en', source: 'mock' };
  }

  if (env.AZURE_SPEECH_KEY) {
    const mai = await transcribeMai(audio, mimetype, fallback);
    if (mai) return mai;
    return { text: '', language: fallback ?? 'en', source: 'mock' };
  }

  log.warn('AI_TRANSCRIBE_UNAVAILABLE', { mimetype });
  return { text: '', language: fallback ?? 'en', source: 'mock' };
}

/** Test-only surface for the pure language-resolution helpers. */
export const __transcribeInternals = { sarvamLanguageCode, languageFromTranscript };
