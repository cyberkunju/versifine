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

/** Sarvam Saaras speech-to-text-translate (Indic). Returns null on any failure. */
async function transcribeSarvam(
  audio: Buffer,
  mimetype: string,
  fallback: string | undefined,
): Promise<TranscribeResult | null> {
  if (!env.SARVAM_API_KEY) return null;
  const cleanMime = (mimetype.split(';')[0] || 'audio/ogg').trim();
  try {
    const result = await withLatency('transcribe.sarvam', async () => {
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
    return { text, language: fallback ?? 'en', source: 'sarvam' };
  } catch (err) {
    log.warn('SARVAM_STT_FAIL', { error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
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
