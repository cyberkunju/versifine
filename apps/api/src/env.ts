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

  GOOGLE_CLIENT_ID: z
    .string()
    .trim()
    .transform((v) => (v.length > 0 ? v : undefined))
    .pipe(z.string().min(10).optional())
    .optional(),
  /**
   * Optional comma-separated allowlist for backends that accept multiple web
   * client IDs during a migration. GOOGLE_CLIENT_ID is enough for most installs.
   */
  GOOGLE_CLIENT_IDS: z
    .string()
    .trim()
    .transform((v) => (v.length > 0 ? v : undefined))
    .pipe(z.string().min(10).optional())
    .optional(),
  GOOGLE_ALLOWED_DOMAINS: z
    .string()
    .trim()
    .transform((v) => (v.length > 0 ? v : undefined))
    .pipe(z.string().optional())
    .optional(),

  OPENAI_API_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().min(10).optional())
    .optional()
    .describe('deprecated — no direct OpenAI; retained as optional no-op'),

  /**
   * Azure AI Foundry (Model Inference API). AZURE_AI_KEY + AZURE_AI_ENDPOINT
   * are REQUIRED in production — the entire LLM + embeddings surface routes
   * here (no OpenAI-direct fallback). `OPENAI_*_MODEL` values carry the Azure
   * *deployment names* (e.g. gpt-5.4-nano, Cohere-embed-v3-multilingual).
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

  /** Azure AI Speech (MAI-Transcribe-1.5) — English STT. */
  AZURE_SPEECH_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  AZURE_SPEECH_ENDPOINT: z
    .string()
    .transform((v) => (v && v.length > 0 ? v.replace(/\/+$/, '') : undefined))
    .optional(),

  /** Sarvam — Indic STT (Saaras). */
  SARVAM_API_KEY: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  SARVAM_API_URL: z.string().default('https://api.sarvam.ai'),
  SARVAM_STT_MODEL: z.string().default('saaras:v3'),
  /** Native-script speech-to-text model (`/speech-to-text`, saarika family).
   *  Preferred over the translate endpoint so Indic voice keeps its script and
   *  register; the translate model above is the fallback. */
  SARVAM_TRANSCRIBE_MODEL: z.string().default('saarika:v2.5'),

  OPENAI_VISION_MODEL: z.string().default('gpt-4o'),
  OPENAI_PARSE_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_NLU_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_TRANSLATE_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),

  TTS_ENABLED: z.coerce.boolean().default(true),
  TTS_MAX_CHARS: z.coerce.number().int().positive().default(600),

  FX_API_URL: z.string().url().default('https://open.er-api.com/v6/latest'),
  FX_CACHE_SECONDS: z.coerce.number().int().positive().default(21_600),

  /**
   * WhatsApp Business Cloud API (Meta Graph). All optional: when WHATSAPP_TOKEN
   * is absent the public webhook still verifies but inbound messages are
   * ignored, and the legacy whatsapp-web.js bot path stays in charge. Set all
   * of these in production to run on the official Cloud API.
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
  /** Webhook handshake token — must match what you enter in the Meta dashboard. */
  WHATSAPP_VERIFY_TOKEN: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  /** Meta App Secret — used to HMAC-verify every inbound webhook (X-Hub-Signature-256). */
  WHATSAPP_APP_SECRET: z
    .string()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),

  /** Where the API relays parsed inbound messages to the bot process. */
  WABOT_INTERNAL_URL: z.string().url().default('http://127.0.0.1:5001'),
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
