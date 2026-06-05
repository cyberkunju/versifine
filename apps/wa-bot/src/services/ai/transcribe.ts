/**
 * Voice → text. Try gpt-4o-transcribe first, fall back to whisper-1 if the
 * modern model trips on the audio. The bot needs its own copy because we
 * don't share a runtime — pulling the API's module would drag the API's env
 * loader and database client along for the ride.
 *
 * Language handling (important): we DO NOT pass a hard `language` lock to the
 * transcriber. Locking the output language forces the model to transliterate
 * whatever was actually said into that script — so an English sentence from a
 * user whose app language is Malayalam comes back as gibberish Malayalam
 * letters ("ഹൗ മച്ച് ഡിഡ് ഐ സ്പെന്റ് ടുഡേ"). India is code-mixed: the same
 * user switches between English and their language mid-conversation, so we let
 * the model auto-detect and then infer the real language from the SCRIPT of
 * the returned text (more reliable than the ASR language field on short
 * utterances). The caller's preferred language is only a last-resort fallback.
 *
 * Important: `toFile` consumes its source. We rebuild the upload from the
 * original Buffer on retry; reusing the consumed file produces an empty body
 * and a confusing 400.
 */
import { toFile } from 'openai/uploads';
import { detectScript } from '@versifine/shared';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';

export type TranscribeSource = 'gpt-4o-transcribe' | 'whisper-1' | 'mock';

export interface TranscribeResult {
  text: string;
  language: string;
  source: TranscribeSource;
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
  if (byScript && byScript !== 'en') return byScript; // a non-Latin Indic script is unambiguous
  const asr = bareLanguageHint(asrLanguage);
  if (byScript === 'en') {
    // Latin text: trust the ASR only if it also says a romanisable language;
    // otherwise call it English so we don't reply in the wrong script.
    return asr === 'hi' || asr === 'ml' || asr === 'ta' || asr === 'te' || asr === 'kn'
      ? asr
      : 'en';
  }
  return asr ?? bareLanguageHint(fallback) ?? 'en';
}

export async function transcribe(
  audio: Buffer,
  mimetype: string,
  language?: string,
): Promise<TranscribeResult> {
  if (!isAIConfigured()) {
    log.warn('AI_TRANSCRIBE_MOCK', { reason: 'no_api_key', mimetype });
    return {
      text: '',
      language: bareLanguageHint(language) ?? 'en',
      source: 'mock',
    };
  }

  const client = getOpenAI();
  if (!client) {
    return { text: '', language: bareLanguageHint(language) ?? 'en', source: 'mock' };
  }

  const filename = filenameFor(mimetype);
  const fallback = bareLanguageHint(language);

  // Primary attempt: gpt-4o-transcribe with AUTO-DETECT (no language lock).
  try {
    const file = await toFile(audio, filename, { type: mimetype });
    const result = await withLatency('transcribe.primary', () =>
      client.audio.transcriptions.create({
        file,
        model: env.OPENAI_TRANSCRIPTION_MODEL,
        response_format: 'json',
      }),
    );
    const text = (result.text ?? '').trim();
    return {
      text,
      language: resolveLanguage(text, (result as { language?: string }).language, fallback),
      source: 'gpt-4o-transcribe',
    };
  } catch (err) {
    log.warn('AI_TRANSCRIBE_FALLBACK', {
      from: env.OPENAI_TRANSCRIPTION_MODEL,
      to: 'whisper-1',
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
  }

  // Fallback: whisper-1 with verbose JSON (returns a detected language) and
  // still no hard lock, so code-mixed speech transcribes faithfully.
  try {
    const file = await toFile(audio, filename, { type: mimetype });
    const result = await withLatency('transcribe.fallback', () =>
      client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'verbose_json',
      }),
    );
    const text = (result.text ?? '').trim();
    const detected =
      typeof (result as { language?: unknown }).language === 'string'
        ? ((result as { language: string }).language as string)
        : undefined;
    return {
      text,
      language: resolveLanguage(text, detected, fallback),
      source: 'whisper-1',
    };
  } catch (err) {
    log.error('AI_TRANSCRIBE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return { text: '', language: fallback ?? 'en', source: 'mock' };
  }
}

export async function normalizeTranscription(text: string, language: string): Promise<string> {
  const client = getOpenAI();
  if (!client || !text.trim()) return text;

  try {
    const systemPrompt = `You are a transcription cleaner for a personal finance assistant.
Your job is to normalize voice-transcribed Indian English / Romanized Hindi / Malayalam / Tamil / Telugu / Kannada colloquial phrasings into standard clean financial assertions (statements of transaction details) while preserving all original numbers, items, categories, and payment methods.
Do not answer questions, do not add any conversational text. Only reply with the cleaned-up transaction assertion.

Examples:
- 'PhonePe se pachas rupaye beje' -> 'Sent 50 rupees via PhonePe'
- 'chai kudiya aayirunnu anupath roopa' -> 'Spent 50 rupees on tea'
- 'tea kudiye 50 rupees' -> 'Spent 50 rupees on tea'
- 'biryani 250 rs paid' -> 'Paid 250 rupees for biryani'
- 'hdfc card se 2000 rupya rent diya' -> 'Paid 2000 rupees rent from HDFC card'
- 'today I bought a shirt for thousand rupees' -> 'Bought shirt for 1000 rupees today'`;

    const completion = await client.chat.completions.create({
      model: env.OPENAI_TRANSLATE_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 100,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    });

    const cleaned = completion.choices[0]?.message?.content?.trim() ?? text;
    log.info('TRANSCRIBE_NORMALIZATION', { original: text, normalized: cleaned });
    return cleaned;
  } catch (err) {
    log.warn('TRANSCRIBE_NORMALIZATION_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return text;
  }
}
