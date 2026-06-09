/**
 * Voice → text. Azure/Sarvam only — NO OpenAI, NO fallbacks (policy 2026-06-08).
 *   - Indic languages → Sarvam Saaras (`/speech-to-text-translate`), primary.
 *   - English (and anything without a Sarvam key) → Azure MAI-Transcribe-1.5.
 * If the chosen primary fails, we surface an empty transcript (the engine then
 * tells the user it couldn't hear them) rather than silently retrying a second
 * provider.
 *
 * Language handling: we never hard-lock the output language; the spoken
 * language is inferred from the SCRIPT of the returned text (more reliable than
 * the ASR language field on short utterances), with the caller's session
 * language as a last-resort hint.
 */
import { detectScript, LANGUAGES, LANGUAGE_META, isLanguage } from '@versifine/shared';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';
import { withLatency } from './client.ts';

export type TranscribeSource = 'sarvam' | 'mai' | 'mock';

export interface TranscribeResult {
  text: string;
  /** Native-script transcript for the "🎤 ..." echo (what the user actually
   *  said, in their own language). Falls back to `text` when unavailable. */
  echoText: string;
  language: string;
  source: TranscribeSource;
}

/**
 * Session languages routed to Sarvam Saaras (Indic ASR) when a key is set —
 * every supported Indian language (i.e. all but English). Derived from the
 * shared registry so new languages are covered automatically.
 */
const SARVAM_LANGS: ReadonlySet<string> = new Set(LANGUAGES.filter((l) => l !== 'en'));

/** Bare codes whose romanised (Latin-script) speech we still trust the ASR for. */
const ROMANISABLE_LANGS: ReadonlySet<string> = new Set(LANGUAGES.filter((l) => l !== 'en'));

/** Map a bare language tag to the Azure Speech locales for MAI fast transcription. */
function maiLocales(lang: string | undefined): string[] {
  if (lang && isLanguage(lang) && lang !== 'en') {
    return [LANGUAGE_META[lang].bcp47, 'en-IN'];
  }
  switch (lang) {
    case 'hi':
      return ['hi-IN', 'en-IN'];
    case 'ml':
      return ['ml-IN', 'en-IN'];
    case 'ta':
      return ['ta-IN', 'en-IN'];
    case 'te':
      return ['te-IN', 'en-IN'];
    case 'kn':
      return ['kn-IN', 'en-IN'];
    default:
      return ['en-IN', 'en-US'];
  }
}

const FILENAME_BY_MIME: Record<string, string> = {
  'audio/ogg': 'voice.ogg',
  'audio/oga': 'voice.ogg',
  'audio/ogg; codecs=opus': 'voice.ogg',
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
  const key = mimetype.toLowerCase();
  return FILENAME_BY_MIME[key] ?? 'voice.bin';
}

function bareLanguageHint(language?: string): string | undefined {
  if (!language) return undefined;
  const tag = language.split('-')[0]?.toLowerCase();
  return tag && tag.length === 2 ? tag : undefined;
}

/**
 * Decide the spoken language from (in order): the actual script of the
 * transcribed text, the ASR-reported language, then the caller's fallback.
 * Script wins because it can't lie — if the text is Latin letters the user
 * spoke English (or romanised), regardless of what the ASR guessed.
 */
function resolveLanguage(
  text: string,
  asrLanguage: string | undefined,
  fallback: string | undefined,
): string {
  const byScript = detectScript(text);
  if (byScript && byScript !== 'en') {
    // Devanagari is shared by Hindi and Marathi. detectScript can only ever
    // say "hi", so when the user's own language (or the ASR) is Marathi, honour
    // that instead of forcing every Devanagari speaker into Hindi.
    if (byScript === 'hi') {
      const asrBare = bareLanguageHint(asrLanguage);
      const fbBare = bareLanguageHint(fallback);
      if (asrBare === 'mr' || fbBare === 'mr') return 'mr';
    }
    return byScript; // a non-Latin Indic script is otherwise unambiguous
  }
  const asr = bareLanguageHint(asrLanguage);
  if (byScript === 'en') {
    // Latin text: trust the ASR only if it also says a romanisable Indian
    // language; otherwise call it English so we don't reply in the wrong script.
    return asr && ROMANISABLE_LANGS.has(asr) ? asr : 'en';
  }
  return asr ?? bareLanguageHint(fallback) ?? 'en';
}

/**
 * Sarvam Saaras speech-to-text-TRANSLATE. Chosen over Saarika for Indic because
 * it handles CODE-MIXED audio: a Malayalam note with an English clause in the
 * middle comes back as one clean English transcript (Saarika instead
 * transliterates the English into Malayalam script — "and then I had a coffee"
 * → "ആൻഡ് ദെൻ ഐ ഹാഡ് എ കോഫി" — which the parser can't read). The unified
 * English output extracts perfectly; the reply language is unchanged (driven by
 * the user's session, not the transcript). Returns null on any failure so the
 * caller falls back to MAI / OpenAI. Note: Sarvam rejects `audio/ogg;
 * codecs=opus` (what WhatsApp sends) → strip the codec param. ~30s sync cap.
 */
async function transcribeSarvam(
  audio: Buffer,
  mimetype: string,
  fallback: string | undefined,
): Promise<TranscribeResult | null> {
  if (!env.SARVAM_API_KEY) return null;
  const cleanMime = (mimetype.split(';')[0] || 'audio/ogg').trim();
  const filename = filenameFor(cleanMime);
  try {
    const result = await withLatency('transcribe.sarvam', async () => {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(audio)], { type: cleanMime }), filename);
      fd.append('model', env.SARVAM_STT_MODEL);
      const res = await fetch(
        `${env.SARVAM_API_URL.replace(/\/+$/, '')}/speech-to-text-translate`,
        {
          method: 'POST',
          headers: { 'api-subscription-key': env.SARVAM_API_KEY as string },
          body: fd,
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
      }
      return (await res.json()) as { transcript?: string; language_code?: string };
    });
    const text = (result.transcript ?? '').trim();
    if (!text) return null;
    // Saaras outputs English; keep the user's session language (fallback) for
    // the reply rather than flipping to 'en' off the translated text.
    return { text, echoText: text, language: fallback ?? 'en', source: 'sarvam' };
  } catch (err) {
    log.warn('SARVAM_STT_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

/**
 * Sarvam Saarika native transcription (`/speech-to-text`) — returns the audio
 * in its OWN script (Malayalam stays Malayalam, code-mix transliterates
 * readably), with numbers as digits. Used ONLY to produce the "🎤 ..." echo so
 * the user sees what they actually said in their language. Understanding still
 * uses the English translate transcript. Returns null on any failure (the echo
 * then falls back to the English text).
 */
const SARVAM_NATIVE_STT_MODEL = 'saarika:v2.5';

async function transcribeSarvamNative(
  audio: Buffer,
  mimetype: string,
  bcp47: string | undefined,
): Promise<string | null> {
  if (!env.SARVAM_API_KEY) return null;
  const cleanMime = (mimetype.split(';')[0] || 'audio/ogg').trim();
  try {
    const result = await withLatency('transcribe.sarvam.native', async () => {
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(audio)], { type: cleanMime }), filenameFor(cleanMime));
      fd.append('model', SARVAM_NATIVE_STT_MODEL);
      // language_code helps accuracy; "unknown" lets Saarika auto-detect.
      fd.append('language_code', bcp47 && bcp47.length >= 5 ? bcp47 : 'unknown');
      const res = await fetch(`${env.SARVAM_API_URL.replace(/\/+$/, '')}/speech-to-text`, {
        method: 'POST',
        headers: { 'api-subscription-key': env.SARVAM_API_KEY as string },
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { transcript?: string };
    });
    const text = (result.transcript ?? '').trim();
    return text || null;
  } catch (err) {
    log.warn('SARVAM_NATIVE_STT_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return null;
  }
}

/**
 * Azure AI Speech — MAI-Transcribe-1.5 fast transcription. Used for English
 * (and as an Indic fallback). Accepts WhatsApp OGG/Opus directly (verified),
 * so no MIME massaging needed. Returns null on any failure to fall through.
 */
async function transcribeMai(
  audio: Buffer,
  mimetype: string,
  lang: string | undefined,
): Promise<TranscribeResult | null> {
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_ENDPOINT) return null;
  try {
    const result = await withLatency('transcribe.mai', async () => {
      const fd = new FormData();
      fd.append('audio', new Blob([new Uint8Array(audio)], { type: mimetype }), filenameFor(mimetype));
      fd.append('definition', JSON.stringify({ locales: maiLocales(lang) }));
      const url = `${env.AZURE_SPEECH_ENDPOINT}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY as string },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
      }
      return (await res.json()) as {
        combinedPhrases?: Array<{ text?: string }>;
      };
    });
    const text = (result.combinedPhrases?.[0]?.text ?? '').trim();
    if (!text) return null;
    return { text, echoText: text, language: resolveLanguage(text, undefined, lang), source: 'mai' };
  } catch (err) {
    log.warn('MAI_STT_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

export async function transcribe(
  audio: Buffer,
  mimetype: string,
  language?: string,
): Promise<TranscribeResult> {
  const fallback = bareLanguageHint(language);

  // Indic speech → Sarvam Saaras (primary, no fallback). Fire BOTH in parallel
  // (no added latency): the English translate transcript (for understanding)
  // and the native-script transcript (for the "🎤 ..." echo).
  if (env.SARVAM_API_KEY && fallback && SARVAM_LANGS.has(fallback)) {
    const [sv, native] = await Promise.all([
      transcribeSarvam(audio, mimetype, fallback),
      transcribeSarvamNative(audio, mimetype, language),
    ]);
    if (sv) return { ...sv, echoText: native ?? sv.text };
    log.warn('SARVAM_STT_FAIL', { language: fallback });
    return { text: '', echoText: '', language: fallback ?? 'en', source: 'mock' };
  }

  // English (and any language without a Sarvam key) → Azure MAI-Transcribe-1.5.
  if (env.AZURE_SPEECH_KEY) {
    const mai = await transcribeMai(audio, mimetype, fallback);
    if (mai) return mai;
    log.warn('MAI_STT_FAIL', { language: fallback ?? 'en' });
    return { text: '', echoText: '', language: fallback ?? 'en', source: 'mock' };
  }

  log.warn('AI_TRANSCRIBE_UNAVAILABLE', { mimetype });
  return { text: '', echoText: '', language: fallback ?? 'en', source: 'mock' };
}
