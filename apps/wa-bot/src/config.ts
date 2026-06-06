/**
 * Strict environment validation for the bot.
 *
 * Every setting funnels through this module so `import { env }` anywhere
 * else gives a fully typed, fully validated object. A missing or
 * mistyped key fails loudly at startup — never at request time.
 */
import { z } from 'zod';
import { normalizePhone } from './utils/phone.ts';

const csvList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

/**
 * Allowlist of phone numbers, normalised to the same canonical digits-only
 * form that inbound WhatsApp ids are reduced to (see utils/phone.ts). This
 * means an operator can write `9037931435`, `919037931435`, or
 * `+91 90379 31435` in the env and they all match the same sender.
 */
const phoneAllowlist = csvList.transform((list) =>
  list.map((v) => normalizePhone(v)).filter(Boolean),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  BOT_SECRET: z.string().min(8, 'BOT_SECRET must be at least 8 chars'),
  API_URL: z.string().url().default('http://localhost:5000'),

  BOT_PORT: z.coerce.number().int().positive().default(5001),
  BOT_HOST: z.string().default('127.0.0.1'),
  BOT_NAME: z.string().default('Versifine'),
  SESSION_ID: z.string().default('VERSIFINE_DEV'),

  DEMO_MODE: z.coerce.boolean().default(true),
  ALLOWED_TEST_NUMBERS: phoneAllowlist,
  /**
   * Optional override for where the dynamic demo allowlist is persisted.
   * Defaults to `.wwebjs_auth/versifine-demo-allowlist.json` (a durable,
   * gitignored location). Mainly useful for tests.
   */
  DEMO_ALLOWLIST_FILE: z.string().optional(),
  HEADLESS: z.coerce.boolean().default(true),

  OPENAI_API_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().min(10).optional())
    .optional(),

  /**
   * Azure AI Foundry — mirrors the API. When set, the bot's LLM calls
   * (ta/te/kn translation) target Azure gpt-5-mini instead of OpenAI direct.
   */
  AZURE_AI_ENDPOINT: z
    .string()
    .transform((v) => (v && v.length > 0 ? v.replace(/\/+$/, '') : undefined))
    .optional(),
  AZURE_AI_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  AZURE_AI_API_VERSION: z.string().default('2024-05-01-preview'),

  OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-transcribe'),
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  OPENAI_TTS_VOICE: z.string().default('nova'),
  OPENAI_AUDIO_MODEL: z.string().default('gpt-4o-audio-preview'),
  OPENAI_AUDIO_VOICE: z.string().default('shimmer'),
  OPENAI_TRANSLATE_MODEL: z.string().default('gpt-4o-mini'),

  /**
   * Sarvam AI — SOTA for Indic speech. When SARVAM_API_KEY is set, voice
   * notes whose session language is Indic (hi/ml/ta/te/kn) are transcribed
   * with Saarika instead of gpt-4o-transcribe (which mishears Indic words,
   * e.g. Malayalam "പിന്നെ"→"പിള്ളെ"). Falls back to OpenAI on any failure.
   */
  SARVAM_API_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  SARVAM_API_URL: z.string().default('https://api.sarvam.ai'),
  SARVAM_STT_MODEL: z.string().default('saaras:v3'),
  /** Sarvam Bulbul TTS — emits MP3 (output_audio_codec) which WhatsApp accepts. */
  SARVAM_TTS_MODEL: z.string().default('bulbul:v2'),
  SARVAM_TTS_SPEAKER: z.string().default('anushka'),

  /**
   * Azure AI Speech — MAI-Transcribe-1.5 fast transcription for English STT.
   * When AZURE_SPEECH_KEY is set, non-Indic (English) voice notes transcribe
   * here instead of gpt-4o-transcribe. Accepts WhatsApp OGG/Opus directly.
   */
  AZURE_SPEECH_ENDPOINT: z
    .string()
    .transform((v) => (v && v.length > 0 ? v.replace(/\/+$/, '') : undefined))
    .optional(),
  AZURE_SPEECH_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),

  /**
   * WhatsApp Business Cloud API (Meta Graph). When WHATSAPP_TOKEN is set the
   * bot runs in Cloud API mode (no Chromium); otherwise the whatsapp-web.js
   * path drives it. Phone number id + version are required to send.
   */
  WHATSAPP_TOKEN: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().min(20).optional())
    .optional(),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),

  TTS_ENABLED: z.coerce.boolean().default(true),
  TTS_MAX_CHARS: z.coerce.number().int().positive().default(600),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('\n');
  console.error(`Invalid bot environment configuration:\n${issues}`);
  throw new Error('Invalid bot environment configuration. Aborting boot.');
}

export const env = parsed.data;
export type Env = typeof env;
