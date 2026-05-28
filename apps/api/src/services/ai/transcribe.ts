/**
 * Voice → text. Tries the modern transcription endpoint first; if it
 * trips up on the audio (codec quirks, language detection failure) we
 * fall back to whisper-1, which is older but more forgiving on Indian
 * accents and short utterances.
 *
 * Important: `toFile` consumes its source, so on retry we MUST rebuild
 * the file handle from the original buffer. That's why this module
 * keeps the buffer around and creates the upload twice when needed.
 */
import { toFile } from 'openai/uploads';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';

export type TranscribeSource = 'gpt-4o-transcribe' | 'whisper-1' | 'mock';

export interface TranscribeResult {
  text: string;
  language: string;
  source: TranscribeSource;
}

interface TranscribeOptions {
  /** Optional BCP-47 hint, e.g. `en-IN`, `ml-IN`. The OpenAI APIs accept
   *  the bare language tag like `en` or `ml` — we strip the region. */
  language?: string;
}

const FILENAME_BY_MIME: Record<string, string> = {
  'audio/ogg': 'voice.ogg',
  'audio/oga': 'voice.ogg',
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

/**
 * Transcribe a buffer of speech audio. Returns a uniform shape regardless
 * of which model answered. When the API key is absent we return a marker
 * mock string instead of crashing — capture flows can still be exercised
 * end to end in development.
 */
export async function transcribe(
  audio: Buffer,
  mimetype: string,
  language?: string,
): Promise<TranscribeResult> {
  if (!isAIConfigured()) {
    log.warn('AI_TRANSCRIBE_MOCK', { reason: 'no_api_key', mimetype });
    return {
      text: '[transcription unavailable: OPENAI_API_KEY not configured]',
      language: bareLanguageHint(language) ?? 'en',
      source: 'mock',
    };
  }

  const client = getOpenAI();
  if (!client) {
    return {
      text: '[transcription unavailable]',
      language: bareLanguageHint(language) ?? 'en',
      source: 'mock',
    };
  }

  const filename = filenameFor(mimetype);
  const hint = bareLanguageHint(language);

  // Primary attempt: gpt-4o-transcribe. Recreate the file each call —
  // toFile consumes its iterable source.
  try {
    const file = await toFile(audio, filename, { type: mimetype });
    const result = await withLatency('transcribe.primary', () =>
      client.audio.transcriptions.create({
        file,
        model: env.OPENAI_TRANSCRIPTION_MODEL,
        language: hint,
        response_format: 'json',
      }),
    );
    return {
      text: (result.text ?? '').trim(),
      language: hint ?? 'en',
      source: 'gpt-4o-transcribe',
    };
  } catch (err) {
    log.warn('AI_TRANSCRIBE_FALLBACK', {
      from: env.OPENAI_TRANSCRIPTION_MODEL,
      to: 'whisper-1',
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
  }

  // Fallback attempt: whisper-1 with verbose JSON so we can echo back the
  // detected language even when the user didn't supply a hint.
  try {
    const file = await toFile(audio, filename, { type: mimetype });
    const result = await withLatency('transcribe.fallback', () =>
      client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: hint,
        response_format: 'verbose_json',
      }),
    );
    const detected =
      typeof (result as { language?: unknown }).language === 'string'
        ? ((result as { language: string }).language as string)
        : (hint ?? 'en');
    return {
      text: (result.text ?? '').trim(),
      language: detected,
      source: 'whisper-1',
    };
  } catch (err) {
    log.error('AI_TRANSCRIBE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return {
      text: '',
      language: hint ?? 'en',
      source: 'mock',
    };
  }
}
