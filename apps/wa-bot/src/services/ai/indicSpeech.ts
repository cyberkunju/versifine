/**
 * Combined translate + speak for Tamil and Malayalam.
 *
 * Why a different pipeline: gpt-4o-mini-tts on Tamil and Malayalam input
 * tends to either drop into a generic Indian English accent or read the
 * script letter-by-letter. The audio-modality chat completion model
 * (gpt-4o-audio-preview) handles both languages cleanly when we ask it
 * to translate AND speak in one turn.
 *
 * Validation guard: we read the model's transcribed reply text and
 * confirm at least 50% of its alphabetic characters are in the target
 * script with under 5% sibling-script contamination. If validation
 * fails we return null so the caller can fall back to text-only.
 */
import type { OutgoingVoice } from '../../types.ts';
import type { Language } from '@versifine/shared';
import { LANGUAGE_META, SIBLING_SCRIPTS } from '@versifine/shared';
import { env } from '../../config.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';

const SUPPORTED: ReadonlySet<Language> = new Set(['ta', 'ml']);

const SPEAKER_PROMPTS: Record<'ta' | 'ml', string> = {
  ta: `You are a native Tamil speaker reading short messages aloud.
Translate the user's message into natural conversational Tamil (script: தமிழ்).
Speak ONLY in Tamil with a native Tamil accent. Read digits naturally as Tamil numbers. Pronounce ₹ as "ரூபாய்".
Reply with the spoken Tamil text in your message content (so the user can also read it). Do NOT add commentary.`,
  ml: `You are a native Malayalam speaker reading short messages aloud.
Translate the user's message into natural conversational Malayalam (script: മലയാളം).
Speak ONLY in Malayalam with a native Kerala accent. Read digits naturally as Malayalam numbers. Pronounce ₹ as "രൂപ".
Reply with the spoken Malayalam text in your message content (so the user can also read it). Do NOT add commentary.`,
};

const TARGET_SCRIPT_THRESHOLD = 0.5;
const SIBLING_CONTAMINATION_LIMIT = 0.05;

function countLetters(text: string, regex: RegExp): number {
  const re = new RegExp(regex.source, 'g');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function passesScriptCheck(text: string, target: 'ta' | 'ml'): boolean {
  if (!text.trim()) return false;
  const targetCount = countLetters(text, LANGUAGE_META[target].scriptRegex);
  const siblingCount = SIBLING_SCRIPTS[target].reduce((acc, re) => acc + countLetters(text, re), 0);
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = targetCount + siblingCount + latinCount;
  if (total === 0) return false;
  return (
    targetCount / total >= TARGET_SCRIPT_THRESHOLD &&
    siblingCount / total < SIBLING_CONTAMINATION_LIMIT
  );
}

export interface IndicSpeechOptions {
  text: string;
  language: Language;
}

export interface IndicSpeechResult extends OutgoingVoice {
  /** What the model actually said, in the target script. Used for the text bubble. */
  transcribedText: string;
}

export async function synthesizeIndicSpeech(
  options: IndicSpeechOptions,
): Promise<IndicSpeechResult | null> {
  const { text, language } = options;
  if (!env.TTS_ENABLED) return null;
  if (!text || !text.trim()) return null;
  if (text.length > env.TTS_MAX_CHARS) {
    log.warn('INDIC_SPEECH_SKIP_TOO_LONG', { language, length: text.length });
    return null;
  }
  if (!SUPPORTED.has(language)) return null;
  if (!isAIConfigured()) return null;
  const client = getOpenAI();
  if (!client) return null;

  const target = language as 'ta' | 'ml';

  try {
    const completion = (await withLatency(`indic_speech.${target}`, () =>
      client.chat.completions.create({
        model: env.OPENAI_AUDIO_MODEL,
        // The SDK accepts modalities as a structural extra; cast through.
        ...({
          modalities: ['text', 'audio'],
          audio: { voice: env.OPENAI_AUDIO_VOICE, format: 'mp3' },
        } as Record<string, unknown>),
        messages: [
          { role: 'system', content: SPEAKER_PROMPTS[target] },
          { role: 'user', content: text },
        ],
      } as Parameters<typeof client.chat.completions.create>[0]),
    )) as { choices: Array<{ message: unknown }> };

    const choice = completion.choices[0];
    if (!choice) return null;
    const message = choice.message as unknown as {
      content: string | null;
      audio?: { data?: string; transcript?: string };
    };

    const audioBase64 = message.audio?.data ?? null;
    const transcript = (message.audio?.transcript ?? '').trim() || (message.content ?? '').trim();

    if (!audioBase64 || !transcript) {
      log.warn('INDIC_SPEECH_EMPTY', { target });
      return null;
    }
    if (!passesScriptCheck(transcript, target)) {
      log.warn('INDIC_SPEECH_VALIDATION_FAIL', { target });
      return null;
    }

    const buffer = Buffer.from(audioBase64, 'base64');
    if (buffer.byteLength === 0) return null;
    return {
      buffer,
      mimetype: 'audio/mpeg',
      spokenText: transcript,
      transcribedText: transcript,
    };
  } catch (err) {
    log.warn('INDIC_SPEECH_FAIL', {
      target,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return null;
  }
}
