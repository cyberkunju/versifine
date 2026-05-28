# 11 · WhatsApp Bot

> Status: foundation in place (config, types, AI services, utils). Conversation engine, openwa client, and message packs are the remaining work. This doc captures the design + what's done + what's next.

## What's done

```
apps/wa-bot/src/
├── config.ts                         ✅ Zod-validated env, mirrors api/env.ts
├── types.ts                          ✅ ConversationState, Session, OutgoingReply, ApiCaptureResponse
├── services/ai/
│   ├── client.ts                     ✅ lazy OpenAI singleton + withLatency
│   ├── transcribe.ts                 ✅ gpt-4o-transcribe → whisper-1 fallback
│   ├── tts.ts                        ✅ gpt-4o-mini-tts (en/hi/kn/te) + tts-1 fallback
│   ├── indicSpeech.ts                ✅ gpt-4o-audio-preview combined translate+speak (ta/ml)
│   └── translate.ts                  ✅ gpt-4o-mini for ta/te/kn + sibling-script validation
├── utils/
│   ├── logger.ts                     ✅ structured JSON, phone masking
│   ├── phone.ts                      ✅ normalize + allowlist
│   ├── retry.ts                      ✅ exponential backoff helper
│   └── text.ts                       ✅ universal commands (6 langs), parseLink, chunkText
├── package.json                      ✅
├── tsconfig.json                     ✅
└── .env.example                      ✅
```

## What's planned

```
apps/wa-bot/src/
├── index.ts                          ⛔ entry: spawn supervisor or boot direct
├── supervisor.ts                     ⛔ crash-loop detection, orphan-Chrome cleanup
├── openwa/
│   ├── createClient.ts               ⛔ whatsapp-web.js client + LocalAuth + browser path detection
│   ├── handlers.ts                   ⛔ message dispatch, allowlist, LID resolution, two-pass send
│   ├── media.ts                      ⛔ image/audio download with placeholder fallback
│   └── sharedClient.ts               ⛔ late-bound client accessor for the internal HTTP server
├── server/
│   └── internalServer.ts             ⛔ Hono :5001 — /health /qr /qr.png /sessions /send /broadcast/*
├── services/apiClient.ts             ⛔ typed wrapper around apps/api with X-Bot-Secret + X-Phone
├── conversations/
│   ├── engine.ts                     ⛔ top-level dispatcher
│   ├── state.ts                      ⛔ in-memory session map, getSession/updateSession/resetSession
│   ├── messages/
│   │   ├── en.ts                     ⛔ hand-translated copy
│   │   ├── hi.ts                     ⛔ hand-translated copy
│   │   ├── ml.ts                     ⛔ hand-translated copy
│   │   └── index.ts                  ⛔ getMessages(lang) router
│   └── flows/
│       ├── identity.ts               ⛔ GREETING → AWAITING_LANGUAGE → linked check
│       ├── link.ts                   ⛔ LINK <code> handler
│       ├── capture.ts                ⛔ posts to /capture/* on the API
│       ├── confirm.ts                ⛔ CONFIRM/EDIT/CANCEL flow
│       ├── query.ts                  ⛔ "how much on X" fast-pattern handler
│       ├── budget.ts                 ⛔ multi-step "set budget for groceries 5000"
│       ├── correct.ts                ⛔ "that should be Transport not Food"
│       └── help.ts                   ⛔ universal HELP command renderer
└── tests/                            ⛔ flow harness, simulator transport
```

## Architecture

```
┌──────────────────────┐
│  Personal WhatsApp   │   user pairs once, session in .wwebjs_auth/
│  number (the bot)    │
└──────────┬───────────┘
           │ whatsapp-web.js (browser automation, demo-grade)
           ▼
┌──────────────────────┐         ┌────────────────────────────┐
│  apps/wa-bot         │  HTTP   │  apps/api                  │
│  Bun + Hono :5001    │ ──────► │  X-Bot-Secret + X-Phone    │
│                      │         │  /capture, /transactions   │
│  ┌────────────────┐  │         │  /budgets, /copilot, etc.  │
│  │ Conversation   │  │         └────────────────────────────┘
│  │ engine + flows │  │
│  ├────────────────┤  │
│  │ AI services    │  │  OpenAI SDK
│  │ transcribe/TTS │  │  ───────► Whisper, gpt-4o-mini-tts,
│  │ translate/audio│  │           gpt-4o-audio-preview
│  └────────────────┘  │
│                      │
│  ┌────────────────┐  │
│  │ Internal HTTP  │  │  ◄── /broadcast/budget-alert (from api)
│  │ /qr /send etc. │  │
│  └────────────────┘  │
└──────────────────────┘
```

## Flow: text message

```
1. whatsapp-web.js client emits 'message' on inbound text.
2. handlers.ts:
   a. extract sender phone, normalize.
   b. allowlist check (config.ALLOWED_TEST_NUMBERS); silent skip if not allowed.
   c. resolve LID (group-aware ids) to real phone if needed.
3. engine.dispatch(session, message):
   a. parse universal commands (parseUniversal in utils/text.ts).
      - MENU, BACK, RESET, HELP, LANGUAGE, HUMAN, STOP, STATUS, UNDO,
        CONFIRM, CANCEL, EDIT — all 6 langs.
   b. parse LINK 482917 → flows/link.ts.
   c. otherwise route by session.state:
      - GREETING / AWAITING_LANGUAGE → flows/identity.ts
      - LINKED_MAIN + non-command → flows/capture.ts
      - CAPTURE_CONFIRM → flows/confirm.ts
      - SET_BUDGET_* → flows/budget.ts
      - COPILOT_THREAD → flows/capture.ts (chat intent)
4. flows/capture.ts:
   a. POST to apps/api /capture/text with X-Bot-Secret + X-Phone.
   b. apiClient.ts wraps the call; surfaces typed CaptureResponse.
   c. Map intent to a localized reply via getMessages(session.language).
5. translate.ts (if session.language is ta/te/kn) translates the reply.
6. tts.ts or indicSpeech.ts synthesizes voice (skipped if replyMode='text').
7. handlers.ts two-pass send:
   a. text bubble first (instant gratification)
   b. await voice promise, send as voice note (whatsapp-web.js sendMessage with audio mimetype)
```

## Flow: voice note

```
1. whatsapp-web.js downloads the audio buffer.
2. transcribe.ts (gpt-4o-transcribe → whisper-1 fallback).
3. result.text + detected language → engine.dispatch as if it were a text message.
4. response loop is identical.
```

## Flow: image (receipt)

```
1. whatsapp-web.js downloads the image buffer.
2. POST /capture/image multipart on apps/api.
3. API returns a draft (always confirmation flow for images).
4. Bot renders draft as a confirmation bubble in user's language.
5. User replies CONFIRM / EDIT / CANCEL.
6. flows/confirm.ts → POST /capture/confirm.
```

## Pairing (`/qr` page)

The bot's internal HTTP server (port 5001) exposes:

- `GET /qr` — auto-refreshing HTML page that polls for a QR.
- `GET /qr.png` — bare PNG image.

When `whatsapp-web.js` emits a `qr` event, we render it to:
1. The terminal (via `qrcode-terminal`).
2. A PNG file (via `qrcode`).
3. The HTML page (auto-refresh every 5s until paired).

After the user scans, the session persists in `.wwebjs_auth/` (gitignored). Subsequent restarts skip the QR step.

For demo: the user opens `http://localhost:5001/qr` on the bot machine, scans with the personal WhatsApp number that will act as the bot.

## Allowlist + demo mode

`config.DEMO_MODE=true` + `ALLOWED_TEST_NUMBERS=919876543210,...` means the bot only replies to listed numbers. Every other inbound message is silently dropped (logged at debug level for traceability).

For the hackathon: the user uses their personal number as the bot, paired once. They use a SECOND phone (typed digits-only into `ALLOWED_TEST_NUMBERS`) to test. Other incoming messages from real contacts get ignored, so the bot doesn't accidentally reply to a friend.

## Multilingual strategy

| Language | Pack | Translation | TTS path |
| --- | --- | --- | --- |
| en | hand-translated | none | gpt-4o-mini-tts |
| hi | hand-translated | none | gpt-4o-mini-tts (Hindi accent) |
| ml | hand-translated | none | gpt-4o-audio-preview (combined) |
| ta | English pack + runtime translate | gpt-4o-mini + sibling validation | gpt-4o-audio-preview (combined) |
| te | English pack + runtime translate | gpt-4o-mini + sibling validation | gpt-4o-mini-tts (Telugu accent) |
| kn | English pack + runtime translate | gpt-4o-mini + sibling validation | gpt-4o-mini-tts (Kannada accent) |

The pack-or-translate decision happens at every outgoing message. If the user picked Tamil, every message goes:

```
en source → translate.ts (en→ta with retries) → indicSpeech.ts (combined)
```

The first message after a language switch is slow (~2s) because translate isn't cached yet. Subsequent messages with the same English source are instant from the 5-min LRU cache.

## Reply modes

`session.replyMode = 'text' | 'voice' | 'auto'`:

- `text` — never synthesize voice.
- `voice` — always synthesize voice (text bubble always sent first as fallback).
- `auto` — mirror the input modality. User sends voice → bot sends voice. User sends text → bot sends text.

Default: `auto`. User can switch via natural commands ("voice off", "speak to me"). Multilingual coverage in `utils/text.ts`.

## Two-pass send

WhatsApp's voice note rendering is heavier than text. To keep the chat feeling responsive:

```ts
// Pass 1: send text bubble immediately
await client.sendMessage(phone, replyText);

// Pass 2: await voice synthesis, send as voice note
const voice = await voicePromise;
if (voice) {
  await client.sendMessage(phone, new MessageMedia(voice.mimetype, voice.buffer.toString('base64')), {
    sendAudioAsVoice: true,
  });
}
```

Total perceived latency: ~300ms for the text, +1-3s for the voice. Without two-pass, the user stares at WhatsApp's typing indicator for the full 3s.

## Supervisor

`supervisor.ts` (planned) wraps the bot process to handle:

1. **Orphan Chromium cleanup**: whatsapp-web.js spawns headless Chromium. Crashes can leave orphan processes consuming RAM. Before each respawn, scan `ps -ef | grep chromium` (or Windows equivalent) and kill any with our session id.
2. **Crash-loop backoff**: 1s → 5s → 15s → 1m → 5m. Reset on a clean run of >5 minutes.
3. **Health probe**: hit `/health` on `:5001` every 30s. If unresponsive for 3 consecutive probes, kill and respawn.
4. **PID file**: `.wabot.pid` so `bun run --cwd apps/wa-bot stop` can find the right process.

## Internal HTTP API (port 5001)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | none | liveness |
| GET | `/qr` | none | HTML pairing page |
| GET | `/qr.png` | none | PNG QR |
| GET | `/sessions` | bot secret | active session count + last-seen per phone |
| POST | `/send` | bot secret | `{ phone, text, voice? }` — push a message (e.g., budget alert from api) |
| POST | `/broadcast/budget-alert` | bot secret | typed alert structure |
| POST | `/broadcast/forecast-anomaly` | bot secret | typed anomaly notification |
| POST | `/simulator/message` | bot secret | drive the conversation engine without WhatsApp (for tests) |

## Conversation states (planned)

```
GREETING                      first inbound from an unlinked number
AWAITING_LANGUAGE             user picking en/hi/ml/ta/te/kn
AWAITING_LINK_CODE            pairing flow ("send LINK 482917 to link")
LINKED_MAIN                   default state for a linked user
CAPTURE_CONFIRM               draft pending CONFIRM/EDIT/CANCEL
SET_BUDGET_CATEGORY           "set budget for ___"
SET_BUDGET_AMOUNT             "set budget for groceries ___"
QUERY_AWAITING_RANGE          "how much on food in ___"
COPILOT_THREAD                multi-turn chat
ERROR                         catch-all; surfaces RESET option
```

## Testing strategy

`apps/wa-bot/tests/flow.test.ts` (planned) drives the engine with simulator transport:

```ts
const session = await simulator.start({ phone: '919876543210', language: 'en' });
await session.send('hi');                                  // → greeting reply
await session.send('1');                                   // → language pick
await session.send('LINK 482917');                         // → link confirm
await session.send('spent 450 on auto');                   // → capture confirm
await session.send('confirm');                             // → ✓
await session.expectTransaction({ amount: 450, category: 'Transportation' });
```

Each `send` call reuses the same engine + state code that production uses, but skips the whatsapp-web.js layer entirely. Lets us run the full suite in CI without a paired phone.

## Production note: official Cloud API

For production we'd swap whatsapp-web.js for the official WhatsApp Business Cloud API. The conversation engine, AI services, and message packs stay identical — only `openwa/{createClient,handlers,media}.ts` and `supervisor.ts` get replaced with a Cloud API webhook handler.

The bot's `apiClient.ts` (server-to-server calls into apps/api) and the engine itself are transport-agnostic.

## Why a personal number is acceptable for the demo

Per the user's note: "I will use my personal number as the bot and another number to send message and test." Allowlist gating means non-test numbers can't trigger the bot. Risks:

- Pairing locks WhatsApp Web for that account on the bot's browser session — the user can still use WhatsApp on their phone but not on a second WhatsApp Web tab.
- whatsapp-web.js is a browser automation library, technically against WhatsApp's terms. Demo use only; production deploys must use the Cloud API.
- The personal number's contacts can still message the bot account; the allowlist silently swallows those messages without a reply. Their inbox shows blue ticks (read) but no response — slightly confusing if a friend messages while the bot is running. Mitigation: pair-then-pause pattern for non-demo hours.

## Effort estimate to finish

Based on the spec and what's already done:

- `index.ts` + `supervisor.ts`: ~2h
- `openwa/{createClient,handlers,media,sharedClient}.ts`: ~6h (whatsapp-web.js has rough edges, needs careful error handling)
- `server/internalServer.ts`: ~2h (mostly Hono boilerplate)
- `services/apiClient.ts`: ~1h (thin typed wrapper)
- `conversations/state.ts`: ~1h
- `conversations/engine.ts`: ~3h (the main dispatcher)
- `conversations/messages/{en,hi,ml,index}.ts`: ~4h (each pack is 50-80 strings)
- `conversations/flows/*.ts` (8 files): ~6h
- Tests: ~3h

Total: ~28 hours of focused work. Could be split across two sweeps.
