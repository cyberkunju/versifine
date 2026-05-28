/**
 * Strict, single-place environment access.
 *
 * Every consumer imports `env` from here and gets a fully typed, fully
 * validated config object. Anything missing or shaped wrong fails noisily
 * at startup so we never debug a runtime mystery rooted in a typo'd .env
 * key three weeks later.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),

  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(5000),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  BOT_SECRET: z.string().min(8, 'BOT_SECRET must be at least 8 chars'),

  OPENAI_API_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().min(10).optional())
    .optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-transcribe'),
  OPENAI_VISION_MODEL: z.string().default('gpt-4o'),
  OPENAI_PARSE_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_NLU_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TRANSLATE_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  OPENAI_TTS_VOICE: z.string().default('nova'),
  OPENAI_AUDIO_MODEL: z.string().default('gpt-4o-audio-preview'),
  OPENAI_AUDIO_VOICE: z.string().default('shimmer'),

  TTS_ENABLED: z.coerce.boolean().default(true),
  TTS_MAX_CHARS: z.coerce.number().int().positive().default(600),

  FX_API_URL: z.string().url().default('https://open.er-api.com/v6/latest'),
  FX_CACHE_SECONDS: z.coerce.number().int().positive().default(21_600),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('\n');
  // Fail loudly — this is the only place we ever console.error directly.
  console.error(`Invalid environment configuration:\n${issues}`);
  throw new Error('Invalid environment configuration. Aborting boot.');
}

export const env = parsed.data;
export type Env = typeof env;
