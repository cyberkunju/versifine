/**
 * Sarvam Bulbul TTS — primary text-to-speech for ALL languages.
 *
 * Why Bulbul: native Indic voices (SOTA for hi/ml/ta/te/kn) and natural Indian
 * English. Critically it can emit MP3 via `output_audio_codec`, which WhatsApp
 * accepts directly — so no WAV→Opus transcoding step is needed.
 *
 * The text handed in is ALREADY localized to the target language by the engine
 * (native packs for en/hi/ml; translated for ta/te/kn), so we just synthesize
 * it verbatim in the matching `target_language_code`. Returns null on any
 * failure (disabled, too long, no key, API error) so the caller can fall back
 * to OpenAI TTS or text-only.
 */
import type { OutgoingVoice } from '../../types.ts';
import type { Language } from '@versifine/shared';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';
import { withLatency } from './client.ts';

const TARGET_LANG_CODE: Record<Language, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ml: 'ml-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  kn: 'kn-IN',
};

export interface BulbulOptions {
  text: string;
  language: Language;
}

export async function synthesizeBulbul(options: BulbulOptions): Promise<OutgoingVoice | null> {
  const { text, language } = options;
  if (!env.SARVAM_API_KEY) return null;
  if (!env.TTS_ENABLED) return null;
  if (!text || !text.trim()) return null;
  if (text.length > env.TTS_MAX_CHARS) {
    log.warn('BULBUL_SKIP_TOO_LONG', { language, length: text.length, max: env.TTS_MAX_CHARS });
    return null;
  }

  try {
    const buffer = await withLatency(`bulbul.${language}`, async () => {
      const res = await fetch(`${env.SARVAM_API_URL.replace(/\/+$/, '')}/text-to-speech`, {
        method: 'POST',
        headers: {
          'api-subscription-key': env.SARVAM_API_KEY as string,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text,
          target_language_code: TARGET_LANG_CODE[language],
          model: env.SARVAM_TTS_MODEL,
          speaker: env.SARVAM_TTS_SPEAKER,
          output_audio_codec: 'mp3',
          enable_preprocessing: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
      }
      const json = (await res.json()) as { audios?: string[] };
      const b64 = json.audios?.[0];
      if (!b64) throw new Error('no audio in response');
      return Buffer.from(b64, 'base64');
    });
    if (buffer.byteLength === 0) return null;
    return { buffer, mimetype: 'audio/mpeg', spokenText: text };
  } catch (err) {
    log.warn('BULBUL_TTS_FAIL', {
      language,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}
