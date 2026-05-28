/**
 * Voice → text. Identical strategy to the API's transcribe.ts: try
 * gpt-4o-transcribe first, fall back to whisper-1 if the modern model
 * trips on the audio. The bot needs its own copy because we don't share
 * a runtime — pulling the API's module would drag the API's env loader
 * and database client along for the ride.
 *
 * Important: `toFile` consumes its source. We rebuild the upload from
 * the original Buffer on retry; reusing the consumed file produces an
 * empty body and a confusing 400.
 */
import { toFile } from 'openai/uploads';
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
  const hint = bareLanguageHint(language);

  // Primary attempt: gpt-4o-transcribe.
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

  // Fallback: whisper-1 with verbose JSON so we can see the detected
  // language even if the user didn't supply a hint.
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
    return { text: '', language: hint ?? 'en', source: 'mock' };
  }
}
