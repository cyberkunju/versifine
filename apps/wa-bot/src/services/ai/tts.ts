/**
 * Text-to-speech for en, hi, kn, te.
 *
 * gpt-4o-mini-tts accepts an `instructions` field that lets us pin the
 * speaking script and accent — without it the model often slips into
 * the wrong accent for Indian scripts. Each language carries an explicit
 * speaker prompt. Falls back to tts-1 on error so we still emit *some*
 * audio when the new endpoint hiccups.
 *
 * Returns null when:
 *   - TTS is disabled via env
 *   - text is longer than TTS_MAX_CHARS
 *   - the API key is absent
 *   - both attempts fail
 *
 * Tamil and Malayalam go through indicSpeech.ts instead because their
 * combined translate+speak pipeline is dramatically better when both
 * are issued in a single audio-modality chat call.
 */
import type { OutgoingVoice } from '../../types.ts';
import type { Language } from '@versifine/shared';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAITTS, withLatency } from './client.ts';

const SPEAKER_INSTRUCTIONS: Record<'en' | 'hi' | 'kn' | 'te', string> = {
  en: 'Warm, friendly Indian English voice. Steady, conversational pace. Pronounce ₹ as "rupees".',
  hi: 'Speak in clear, conversational Hindi. Use Devanagari pronunciation. Read numbers naturally as Hindi numerals. Pronounce ₹ as "रुपये" (rupaye).',
  kn: 'Speak in clear, conversational Kannada (ಕನ್ನಡ). Native Kannada accent and intonation. Pronounce ₹ as "ರೂಪಾಯಿ" (rupayi). Read digits in Kannada.',
  te: 'Speak in clear, conversational Telugu (తెలుగు). Native Telugu accent and intonation. Pronounce ₹ as "రూపాయలు" (rupayalu). Read digits in Telugu.',
};

/** Languages routed through this module. ta/ml live in indicSpeech.ts. */
const SUPPORTED: ReadonlySet<Language> = new Set(['en', 'hi', 'kn', 'te']);

export interface TtsOptions {
  text: string;
  language: Language;
}

export async function synthesizeSpeech(options: TtsOptions): Promise<OutgoingVoice | null> {
  const { text, language } = options;
  if (!env.TTS_ENABLED) return null;
  if (!text || !text.trim()) return null;
  if (text.length > env.TTS_MAX_CHARS) {
    log.warn('TTS_SKIP_TOO_LONG', { language, length: text.length, max: env.TTS_MAX_CHARS });
    return null;
  }
  if (!SUPPORTED.has(language)) return null;

  const client = getOpenAITTS();
  if (!client) return null;

  const lang = language as 'en' | 'hi' | 'kn' | 'te';
  const instructions = SPEAKER_INSTRUCTIONS[lang];

  // Primary: gpt-4o-mini-tts with instructions for accent + script.
  try {
    const response = await withLatency(`tts.${lang}`, () =>
      client.audio.speech.create({
        model: env.OPENAI_TTS_MODEL,
        voice: env.OPENAI_TTS_VOICE,
        input: text,
        // The SDK type doesn't list `instructions` yet, but the API accepts
        // it on gpt-4o-mini-tts. Fold it in via a structural cast.
        ...({ instructions } as Record<string, unknown>),
        // OGG Opus = WhatsApp-native voice format.
        response_format: 'opus',
      } as Parameters<typeof client.audio.speech.create>[0]),
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 0) {
      return { buffer, mimetype: 'audio/ogg', spokenText: text };
    }
  } catch (err) {
    log.warn('TTS_PRIMARY_FAIL', {
      language: lang,
      from: env.OPENAI_TTS_MODEL,
      to: 'tts-1',
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
  }

  // Fallback: legacy tts-1, no instructions field, mp3 format.
  try {
    const response = await withLatency(`tts.${lang}.fallback`, () =>
      client.audio.speech.create({
        model: 'tts-1',
        voice: env.OPENAI_TTS_VOICE,
        input: text,
        response_format: 'mp3',
      } as Parameters<typeof client.audio.speech.create>[0]),
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) return null;
    return { buffer, mimetype: 'audio/mpeg', spokenText: text };
  } catch (err) {
    log.error('TTS_FAIL', {
      language: lang,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return null;
  }
}
