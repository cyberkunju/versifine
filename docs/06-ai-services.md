# 06 · AI Services

> All AI calls go through `apps/api/src/services/ai/*.ts` (server) and `apps/wa-bot/src/services/ai/*.ts` (bot, when latency-sensitive). Single OpenAI client, lazy-initialized, with `withLatency()` instrumentation on every call.

## Model map

The same map in three places (env defaults, design.md, and this file). Source of truth is `apps/api/src/env.ts`.

| Job | Live model | Env var | Where it runs |
| --- | --- | --- | --- |
| Voice → text | `MAI-Transcribe-1.5` (en) / Sarvam `saaras:v3` (Indic); `gpt-4o-transcribe` fallback | `OPENAI_TRANSCRIPTION_MODEL` | API + bot (bot calls directly for latency) |
| Receipt vision | `gpt-5.4-nano` | `OPENAI_VISION_MODEL` | API |
| Expense parse | `gpt-5.4-nano` | `OPENAI_PARSE_MODEL` | API |
| Intent classify | `gpt-5.4-nano` | `OPENAI_NLU_MODEL` | API |
| Copilot chat | `gpt-5.4-nano` | `OPENAI_CHAT_MODEL` | API (streaming) |
| Translate | `gpt-5.4-nano` (Sarvam Mayura primary in bot) | `OPENAI_TRANSLATE_MODEL` | API + bot |
| Embeddings | `Cohere-embed-v3-multilingual` | `OPENAI_EMBED_MODEL` | API (1024-dim) |

> Models route through Azure AI Foundry (the `OPENAI_*_MODEL` values are Azure
> deployment names). See `docs/17-model-stack.md` for the full target/live stack.
| TTS en/hi/kn/te | `gpt-4o-mini-tts` (fallback `tts-1`) | `OPENAI_TTS_MODEL` | bot |
| TTS ta/ml combined | `gpt-4o-audio-preview` | `OPENAI_AUDIO_MODEL` | bot |

## Client wrapper (`services/ai/client.ts`)

```ts
let cached: OpenAI | null | undefined;
export function getOpenAI(): OpenAI | null {
  if (cached !== undefined) return cached;
  if (!env.OPENAI_API_KEY) { cached = null; return cached; }
  cached = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: 30_000 });
  return cached;
}
export function isAIConfigured(): boolean { return Boolean(env.OPENAI_API_KEY); }
```

Every AI call wraps in `withLatency('label', () => client.x.y(...))` so we get an `AI_CALL_OK { label, ms }` log line on success and `AI_CALL_FAIL { label, ms, error }` on failure.

When the API key isn't set:
- Transcribe returns `{ text: '', source: 'mock' }`.
- Vision returns `{ amount: null, description: null, confidence: 0, source: 'mock' }`.
- Intent returns `{ intent: 'unknown', confidence: 0, source: 'mock' }`.
- Parser returns the regex extractor's output only.
- Translate returns the source unchanged.
- Embed returns a zero vector.
- TTS / IndicSpeech return `null`.
- Copilot route returns 503 `UPSTREAM_AI`.

This means the API can boot, register, login, ingest CSV, and run every non-AI feature **without an OpenAI key**. The bot can even pair its WhatsApp session and reply to text-only messages with stub processing.

## Transcribe — `services/ai/transcribe.ts`

Strategy:
1. Try `gpt-4o-transcribe` with the user's BCP-47 language as a hint.
2. On failure, fall back to `whisper-1` with `response_format: 'verbose_json'` so we can see the detected language.
3. On both failing, return a mock with empty text.

**Critical detail**: `toFile()` consumes its source. We rebuild the upload from the original Buffer on retry. Reusing the consumed file produces an empty body and a confusing 400.

Filename inference from MIME (`audio/ogg → voice.ogg`, `audio/mpeg → voice.mp3`, etc.) is non-trivial because some Whisper-1 endpoints inferred encoding from the filename more strictly than the MIME header.

## Vision — `services/ai/vision.ts`

Receipt OCR for the `/capture/image` route.

- Model: `gpt-4o` with image_url message and a strict JSON-output prompt.
- Returns `{ amount, currency, description, date, confidence, source }` Zod-validated.
- The prompt asks the model to return `null` for any field it can't see clearly. Confidence < 0.5 forces a confirmation flow even when the omnibar would otherwise auto-persist.

## Intent classifier — `services/ai/intent.ts`

`gpt-4o-mini`, JSON-mode, temperature 0, max_tokens 200.

- Output schema: `{ intent, confidence, category? }` with `intent` as one of 15 enum values from `@versifine/shared`.
- 60-second in-memory LRU cache (key = locale + text). Cuts duplicate-prompt cost during a single conversation.
- Regex shortcut: messages matching `/^(spent|paid|gave|cost) \d+/i` skip the LLM entirely and return `expense` with confidence 0.95.

## Expense parser — `services/ai/parser.ts` + `parserRegex.ts`

The parser is the most important AI surface — every transaction passes through it.

**Strict null rule**: the LLM is instructed to return `null` for any field the user did NOT explicitly state. The system never defaults missing fields. Instead, the capture pipeline either auto-fills with a single best guess (last-used wallet, today's date) or asks one clarifying question.

**Two layers**:
1. `parserRegex.ts` — deterministic, runs first. Pulls amount, currency aliases (₹ Rs USD $ etc.), date keywords ("today", "yesterday", "last Tuesday", "on 14 May"), wallet hints (first match against the user's wallet names), split count ("split with 4 people"). Whatever it captures is locked in — the LLM can't override.
2. `parser.ts` — `gpt-5-mini` JSON-mode call with a comprehensive prompt covering 6-language slang. Fills any field the regex layer missed.

**Output**: `ParsedExpense { type, amount, currency, description, categoryHint, walletHint, date, splitPeople, originalAmount, originalCurrency, confidence, needs[] }`.

The `needs[]` field is the list of still-missing fields; `<6 words` text typically returns `['amount', 'description']`, full sentences return `[]`.

**Indian regional slang test cases** (from `apps/api/tests/categorize.test.ts` and the parser's prompt examples):
- Malayalam: "Food-inu 200 spent aayi", "Chai kudichu 30"
- Tamil: "Sapadu ku 180 podunga", "Auto ku 50"
- Hindi: "200 chai pe kharcha", "ek auto liya 80 ka"
- Telugu: "Tea ki 30 ichindi"
- Kannada: "Auto ge 50 kotte"
- Mixed Hinglish: "spent 1500 on Swiggy yesterday", "₹4500 rent paid"

## Translate — `services/ai/translate.ts` (API) and `apps/wa-bot/src/services/ai/translate.ts` (bot)

Translate-on-output for languages without a hand-translated message pack.

- Native packs: en, hi, ml — bot has hand-written copy in those languages, no translation needed.
- Runtime translate: ta, te, kn — every outgoing string passes through the LLM.

**Sibling-script validation** is the killer detail:
- Tamil and Malayalam look similar but use different Unicode blocks.
- Devanagari (hi) is unrelated to South Indian scripts.
- Telugu and Kannada share a common ancestor visually.
- LLMs occasionally produce mixed-script garbage when translating to ta or kn.

The validator counts:
- target script characters (must be ≥ 50% of all alphabetic chars)
- sibling-script characters (must be < 5%)
- Latin chars (allowed for digits, brand names, command keywords)

If validation fails, retry once with a sharper prompt that explicitly mentions the Unicode block. If that also fails, return the source unchanged (better one English line than confidently wrong Tamil).

5-minute LRU cache keyed by `(language, text)` — bot replies are highly repetitive, this cuts ~80% of translate calls in normal use.

## Embed — `services/ai/embed.ts`

`text-embedding-3-small`, 1536 dimensions.

- Input: transaction description (raw, including UPI prefixes etc. — those carry signal too).
- Output: `number[]` of length 1536, or a zero vector if API key absent / call fails.
- Background queue (`services/transactions/embed.ts`) drains a Promise chain so transaction creation never blocks on the embed call.

PgVector cosine search uses the `<=>` operator with the IVFFlat index. Top-20 retrieval for the copilot context.

## TTS — `apps/wa-bot/src/services/ai/tts.ts`

For en, hi, kn, te.

- Primary: `gpt-4o-mini-tts` with `instructions` field for accent + script pinning.
- Fallback: `tts-1` (no instructions field, still works).
- Output format: OGG/Opus (WhatsApp-native).

The instructions are language-specific and explicit:

```
en: "Warm, friendly Indian English voice. Steady, conversational pace. Pronounce ₹ as 'rupees'."
hi: "Speak in clear, conversational Hindi. Use Devanagari pronunciation. Read numbers naturally as Hindi numerals. Pronounce ₹ as 'रुपये' (rupaye)."
kn: "Speak in clear, conversational Kannada (ಕನ್ನಡ). Native Kannada accent and intonation. Pronounce ₹ as 'ರೂಪಾಯಿ' (rupayi). Read digits in Kannada."
te: "Speak in clear, conversational Telugu (తెలుగు). Native Telugu accent and intonation. Pronounce ₹ as 'రూపాయలు' (rupayalu). Read digits in Telugu."
```

Without these instructions the model often slips into a generic Indian English accent regardless of input script.

`TTS_MAX_CHARS=600` bound prevents runaway audio generation on long replies.

## Indic speech (combined translate + speak) — `apps/wa-bot/src/services/ai/indicSpeech.ts`

Tamil and Malayalam need a different pipeline. `gpt-4o-mini-tts` on Tamil/Malayalam input either drops into a generic Indian English accent or reads the script letter-by-letter.

`gpt-4o-audio-preview` (an audio-modality chat-completion model) handles both languages cleanly when we ask it to translate AND speak in one turn:

```ts
client.chat.completions.create({
  model: 'gpt-4o-audio-preview',
  modalities: ['text', 'audio'],
  audio: { voice: 'shimmer', format: 'mp3' },
  messages: [
    { role: 'system', content: 'You are a native Tamil speaker reading short messages aloud. Translate the user\'s message into natural conversational Tamil... ' },
    { role: 'user', content: 'You spent ₹450 on auto. Total this month: ₹4,250.' },
  ],
});
```

The response includes both text (the Tamil version) and audio (base64 MP3). We return both: text bubble first, voice note second.

Same sibling-script validation applies on the text side — if the model returns Malayalam-like Tamil, we drop the result and fall back to text-only.

## Advice — `services/ai/advice.ts`

Returns 3–5 ranked advice items.

- LLM path: `gpt-4o-mini`, temperature 0.3, with a context block built from this month's totals, top categories, recurring items, active goals.
- Fallback path: deterministic rules (high category spend, recurring with no use, goal at risk, savings rate trend).

Both paths return the same `AdviceItem[]` shape, distinguished by a `source: 'llm' | 'rules'` field for the UI badge.

## Copilot tools — `services/ai/copilotTools.ts`

The five tool functions exposed to the LLM during copilot turns. All run inside the API process, against the same Drizzle connection, scoped to the caller's `space_id`.

| Tool | Args | Returns |
| --- | --- | --- |
| `compute_total` | `{ category?, type?, from?, to? }` | `{ total: number, count: number, currency: string }` |
| `compute_category_breakdown` | `{ from?, to?, top?: number }` | `{ items: [{ category, total }], total: number }` |
| `compute_forecast` | `{ days?: number }` | the `ForecastResult` shape from `services/forecast/index.ts` |
| `find_recurring` | `{ status?: 'active'\|'dismissed', minAmount? }` | `{ items: RecurringItem[] }` |
| `compare_periods` | `{ a: { from, to }, b: { from, to }, by?: 'category'\|'merchant'\|'wallet' }` | `{ a, b, deltas: [...] }` |

Tools are defined as JSON-schema specs and dispatched via a switch. The LLM never sees raw amounts unless they came through a tool — that's how we structurally prevent number hallucination.

## Why these specific models

- **`gpt-5-mini` for parsing**: best accuracy/cost ratio for structured JSON. Strict null rule needs a model that follows instructions tightly.
- **`gpt-4o-mini` for chat / translate / NLU**: $0.15/1M input is the floor we can hit while still getting reliable JSON-mode responses and decent multilingual quality.
- **`gpt-4o` for vision**: receipts vary wildly in quality. The mini variant misses on faded thermal prints and angled photos.
- **`gpt-4o-transcribe` over `whisper-1`**: better for short voice notes (under 5s) and for code-switched Hinglish/Malglish/Tanglish — Whisper-1 sometimes mistranscribes the language label.
- **`gpt-4o-mini-tts` over `tts-1`**: the `instructions` field is the difference between native-accent Hindi and English-accented Hindi. tts-1 has no `instructions` parameter.
- **`gpt-4o-audio-preview` for ta/ml**: combined translate+speak in one turn is dramatically better than chained calls. Two API calls means two places for cross-script contamination to creep in.
- **`text-embedding-3-small` (1536-dim)**: enough resolution for our scale, half the price of large, half the storage in pgvector.

## Cost control measures

Every AI call has at least two of these:

1. **Cache** — intent classifier (60s), translate (5min), advice (per request), forecast (6h). Keys are deterministic.
2. **Regex shortcut** — parser, intent. Skip the LLM when a pattern catches everything.
3. **Stub mode** — without `OPENAI_API_KEY`, every service returns deterministic placeholders. CI / local dev for non-AI features stays free.
4. **Rate limit** — capture (60/min/user), copilot (20/min/user). Per-key buckets.
5. **Max tokens** — every chat call has `max_tokens` set explicitly. Copilot answers cap at ~800 output tokens.
6. **Background queue** — embedding is fire-and-forget so transaction creation never waits on it.

## Observability

Every AI call emits a log line:
```
{"ts":"...","level":"info","event":"AI_CALL_OK","label":"intent","ms":243}
```

Failed calls log warn or error:
```
{"ts":"...","level":"warn","event":"AI_CALL_FAIL","label":"transcribe.primary","ms":1209,"error":"503 service_unavailable"}
```

Latency is in `ms`; we don't sample tokens (per the security guardrails — no PII at info level).

## Failure modes & fallbacks

| Service | Primary fails | Fallback | If both fail |
| --- | --- | --- | --- |
| Transcribe | gpt-4o-transcribe | whisper-1 | mock (empty text) |
| Vision | gpt-4o | — | confidence=0 → confirmation flow |
| Intent | gpt-4o-mini | regex shortcut | `unknown` |
| Parser | gpt-5-mini | regex extractor | `{ amount, currency, date }` from regex only |
| Translate | gpt-4o-mini | sharper prompt retry | source text unchanged |
| Embed | text-embedding-3-small | — | zero vector (search returns nothing useful) |
| TTS en/hi/kn/te | gpt-4o-mini-tts | tts-1 | text-only reply |
| TTS ta/ml | gpt-4o-audio-preview | — | text-only reply |
| Advice | gpt-4o-mini | rule-based | rule-based |
| Copilot | gpt-4o-mini stream | — | 503 `UPSTREAM_AI` |

The whole stack degrades gracefully — no single AI failure can lock a user out of the app.
