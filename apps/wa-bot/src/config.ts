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
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-transcribe'),
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  OPENAI_TTS_VOICE: z.string().default('nova'),
  OPENAI_AUDIO_MODEL: z.string().default('gpt-4o-audio-preview'),
  OPENAI_AUDIO_VOICE: z.string().default('shimmer'),
  OPENAI_TRANSLATE_MODEL: z.string().default('gpt-4o-mini'),

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
