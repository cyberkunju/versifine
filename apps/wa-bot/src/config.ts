/**
 * Strict environment validation for the bot.
 *
 * Every setting funnels through this module so `import { env }` anywhere
 * else gives a fully typed, fully validated object. A missing or
 * mistyped key fails loudly at startup — never at request time.
 */
import { z } from 'zod';

const csvList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
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
  ALLOWED_TEST_NUMBERS: csvList,
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
