# Requirements Document

## Introduction

Finehance is a personal finance manager that captures spending with **zero friction** and turns it into a real **AI co-pilot** that understands the user's money. Two killer surfaces: a **Svelte web dashboard** and a **WhatsApp bot** — both fed by the same brain. Indian-market-first (INR, UPI vocabulary, multilingual), single-user MVP, multi-tenant-ready schema.

This document defines the functional and non-functional requirements for the hackathon MVP.

## Requirements

### Vision

## Hackathon-grade success criteria

A judge cloning the repo can:

1. `docker compose up` and have Postgres running
2. `bun install && bun run dev` and have web + api + bot running
3. Open the web app, register, and immediately see seeded transactions
4. Type "spent 450 on auto" — it parses, categorizes, persists, and the dashboard updates live
5. Send the same message via WhatsApp from an allowlisted number — same result, replies in user's language with text + voice note
6. Open the AI Copilot panel and ask "where did my money go this month?" — get a streaming, grounded answer with real numbers
7. Toggle "🔒 Privacy Mode" and watch categorization continue working without sending text to the server

## Glossary

- **Space** — a workspace owning all financial data. MVP creates one personal space per user. Schema supports household/group spaces in v2 with no migration.
- **Wallet** — a money container (cash, bank account, UPI handle, credit card). Transactions belong to a wallet.
- **Transaction** — an income, expense, or transfer between wallets, owned by a space.
- **Capture channel** — how a transaction enters the system: web omnibar, WhatsApp text, voice note, receipt photo, CSV import.
- **Vivien** — the in-app AI co-pilot persona (chat, advice, narrative).
- **Privacy Mode** — client-side categorization using browser-loaded MiniLM. No transaction text leaves the device.

---

## R1. Authentication and identity

**User story:** As a new user, I register with email and password on the web app, then link my WhatsApp number so messages from that phone are recognized as mine.

### Acceptance criteria

1. WHEN a user submits valid email + password (12+ chars, mixed case, digit, special char) THEN the system creates an account, hashes the password with bcrypt, creates a personal space, creates a default INR wallet, returns access + refresh JWT tokens.
2. WHEN a user submits invalid registration input THEN the system returns 422 with field-level errors and no partial account is created.
3. WHEN a user logs in with correct credentials THEN the system returns access (1h) and refresh (30d) JWTs.
4. WHEN an access token expires THEN the web client uses the refresh token to mint a new access token; on refresh failure the user is redirected to login.
5. WHEN a user requests phone linking THEN the system generates a 6-digit OTP, persists it with 10-minute TTL, and instructs the user to send `LINK <code>` to the bot.
6. WHEN the bot receives `LINK <code>` from a phone THEN the system verifies the code, attaches the phone number to the user, and the bot replies confirming the link in the user's language.
7. WHEN the bot receives any message from a phone NOT linked to a user THEN it replies with a one-liner instructing how to register on the web and link.
8. WHEN a user's phone is on the developer allowlist (env var) THEN it bypasses the link requirement and is treated as the configured demo user. (Hackathon convenience.)
9. WHEN a JWT is missing or invalid on a protected route THEN the API returns 401.

---

## R2. Spaces (multi-tenant readiness)

**User story:** As a user, all my financial data lives in a "space" so that later I can share it with a household or business team without migration.

### Acceptance criteria

1. WHEN a user account is created THEN exactly one personal space is created and the user is set as `owner`.
2. EVERY owned entity (wallet, transaction, budget, goal, category override, recurring, ledger entry, attachment) MUST have a non-null `space_id` foreign key.
3. WHEN any data query runs THEN it MUST filter by the active space id derived from the JWT claim `active_space_id`.
4. WHEN a user has no `active_space_id` set THEN the system defaults to the user's personal space.
5. THE schema MUST include a `space_members` table with `(space_id, user_id, role)` even though MVP only inserts the owner row.

---

## R3. Wallets and accounts

**User story:** As a user, I track money across multiple containers (cash, HDFC, ICICI, GPay, credit cards) and move money between them.

### Acceptance criteria

1. WHEN a user creates a wallet THEN they provide a name, a type (`cash`, `bank`, `upi`, `credit_card`, `wallet`), an optional initial balance, and a currency (default INR).
2. WHEN a wallet is created THEN if initial balance > 0 the system records an opening-balance income transaction tagged `type=opening_balance`.
3. WHEN the user lists wallets THEN each row includes the live balance (sum of credits minus debits across non-deleted transactions).
4. WHEN a user creates a transfer THEN two transactions are created atomically: a debit on `from_wallet` and a credit on `to_wallet`, linked by a shared `transfer_id`.
5. IF a transfer fails partway THEN the entire operation rolls back; no orphaned transactions exist.
6. WHEN a user soft-deletes a wallet THEN it is hidden from lists but transactions remain queryable for history.
7. WHEN a user views a wallet THEN they see balance, last 50 transactions, and a 30-day spend chart.

---

## R4. Transactions (CRUD + multi-currency)

**User story:** As a user, I create, view, edit, and delete transactions across wallets and currencies, with the system handling FX conversion to my base currency (INR).

### Acceptance criteria

1. WHEN a user creates a transaction THEN they provide: type (`income`, `expense`, `transfer`), amount (positive number), currency (3-letter ISO), date, description, wallet_id, optional category, optional tags, optional notes.
2. WHEN currency != base currency (INR) THEN the system fetches an FX rate (cached 6h), stores `original_amount`, `original_currency`, `fx_rate`, and the converted INR amount.
3. WHEN FX lookup fails THEN the transaction is created with `original_*` only and a `needs_fx_resolution=true` flag; a background retry resolves it later.
4. WHEN a transaction is created without a category THEN the system runs the categorizer and stores both `category` and `confidence_score`.
5. WHEN a user lists transactions THEN supported filters: date range, type, category, wallet, search (full-text on description/notes), tag.
6. WHEN listing returns more than 50 results THEN it paginates with `limit` (default 50, max 200) and `offset`.
7. WHEN a user updates a transaction's category THEN the change is recorded as a `category_correction` event used to personalize categorization (R7).
8. WHEN a user soft-deletes a transaction THEN it sets `deleted_at` and is excluded from sums/lists by default but remains in audit history.
9. EVERY transaction includes `source` (one of: `manual_web`, `whatsapp_text`, `whatsapp_voice`, `whatsapp_image`, `csv_import`, `recurring_engine`).

---

## R5. Capture — Web omnibar (multimodal)

**User story:** As a user, I have one input on the web app that takes text, voice, or a dropped receipt image, and turns it into a transaction or routes it to the right action.

### Acceptance criteria

1. WHEN a user types into the omnibar and submits THEN the system classifies the intent (R7-R8) and either creates a transaction OR opens the corresponding flow (set budget, view summary, ask copilot).
2. WHEN a user clicks the mic button THEN the browser records audio using MediaRecorder, posts the blob to `/capture/voice`, the API runs Whisper, runs the parser, and returns the same response shape as text capture.
3. WHEN a user drops or pastes an image THEN the API runs receipt vision (gpt-4o), returns a parsed transaction draft, and the user confirms in a modal before persisting.
4. WHEN the parser returns multiple expenses from one input THEN all are persisted in a single transaction batch.
5. WHEN the parser detects a split bill (e.g., "dinner 3000 split with 4 people") THEN it persists the user's share as the transaction amount and creates a lend ledger entry for the rest (R13).
6. WHEN parsing returns a confidence below 0.6 OR amount is null THEN the system asks one clarifying question via the omnibar instead of guessing.
7. EVERY successful capture broadcasts a `transaction.created` event over the user's WebSocket channel so other open tabs update without refresh.

---

## R6. Capture — WhatsApp bot parity

**User story:** As a user, anything I can do in the web omnibar I can do from WhatsApp, in any of six languages, with text or voice replies.

### Acceptance criteria

1. WHEN the bot starts THEN it loads `whatsapp-web.js` with `LocalAuth`, exposes a QR page at `GET /qr` and `GET /qr.png` on its internal HTTP server, and prints the QR to the terminal.
2. WHEN a session is paired once THEN it persists in `.wwebjs_auth/` and survives bot restarts without re-pairing.
3. WHEN the bot receives a message from a phone NOT in `ALLOWED_TEST_NUMBERS` AND `DEMO_MODE=true` THEN the message is logged and ignored.
4. WHEN the bot receives a text message from an allowed phone THEN it forwards to the same parser used by the web omnibar via `POST {api}/capture/text` with the user's locale.
5. WHEN the bot receives a voice note THEN it downloads the audio, transcribes it via Whisper using the user's language hint when known, then routes to the same parser.
6. WHEN the bot receives an image THEN it downloads, posts to `POST {api}/capture/image`, and replies with the parsed draft for confirmation.
7. WHEN the API returns a parsed result THEN the bot composes a reply, translates if needed (R14), synthesizes voice (R14), and sends both the text bubble first and voice as a Push-To-Talk note in a second pass.
8. WHEN any failure happens (transcription, parsing, network) THEN the bot replies with an empathetic error message in the user's language and never crashes.
9. WHEN the bot's WhatsApp page disconnects, ready timeout, or watchdog probe fails 3× consecutively THEN the process exits and the supervisor restarts it cleanly with orphan-Chrome cleanup and lockfile removal.
10. WHEN any of these universal commands arrive THEN they work in every state and language: `MENU`, `BACK`, `RESET`, `HELP`, `LANGUAGE`, `HUMAN`, `STOP`, `LINK <code>`, `STATUS`.

---

## R7. Categorization (hybrid: MiniLM + overrides + Privacy Mode)

**User story:** As a user, my expenses are categorized accurately and learn from my corrections, without sending raw transaction text to a third party when I enable Privacy Mode.

### Acceptance criteria

1. WHEN the API starts THEN it loads `CyberKunju/finehance-categorizer-minilm` (ONNX-converted) into memory via `@huggingface/transformers` for CPU inference.
2. WHEN a transaction needs categorization THEN the system checks in order:
   a. User-specific override table `category_overrides(merchant_normalized, category)` for an exact match
   b. Curated India-first global merchant database (~300 entries, regex + alias)
   c. MiniLM inference (top label with score)
   d. Fallback `Other` with confidence 0
3. WHEN the user corrects a transaction's category THEN the system inserts a `category_correction` row AND upserts the (merchant_normalized → corrected_category) mapping into `category_overrides`. Future transactions with the same normalized merchant get the corrected category instantly.
4. WHEN categorization runs in Privacy Mode (web only) THEN the same ONNX model runs in the browser via Transformers.js. The transaction is sent to the server only for storage, after categorization is done client-side. Server records `categorized_by='client'`.
5. WHEN the user toggles Privacy Mode off THEN server-side categorization resumes for new transactions; existing data is unaffected.
6. THE categorizer MUST handle the 23 categories defined in `packages/shared/src/categories.ts` matching the trained model's output classes.

---

## R8. Intent classification

**User story:** As a user, when I type or speak something that isn't a transaction, the system understands what I want.

### Acceptance criteria

1. WHEN a captured input is parsed THEN intent is one of: `expense`, `income`, `transfer`, `set_budget`, `query_spending`, `ask_advice`, `view_summary`, `set_goal`, `lend`, `borrow`, `correct_last`, `delete_last`, `chat`, `unknown`.
2. WHEN an intent is `expense` / `income` / `transfer` THEN the parser also extracts: amount, currency, description, category-hint, wallet-hint, date, split-people, original-amount/currency.
3. WHEN an intent is `query_spending` with a category THEN the system computes and returns the answer; the bot phrases it naturally ("You spent ₹1,240 on groceries this month, 2 transactions").
4. WHEN an intent is `chat` THEN the input is routed to the Copilot RAG flow (R11).
5. WHEN intent confidence is below 0.5 THEN the system asks one clarifying question instead of guessing.
6. THE intent classifier uses `gpt-4o-mini` with `response_format=json_object`, temperature 0, max 200 tokens, with the same JSON schema across web and bot pipelines.

---

## R9. Budgets and goals

**User story:** As a user, I set monthly budgets per category and savings goals with deadlines, and the system tracks progress and warns me before I overspend.

### Acceptance criteria

1. WHEN a user creates a budget THEN they provide: name, period (`monthly` recurring or fixed start/end), allocations as `{category: amount}` JSONB.
2. WHEN a transaction is created in a budgeted category THEN the running progress for the active budget is recomputed.
3. WHEN spending in a category crosses 80% of its allocation THEN a `budget.warning` notification is emitted (in-app toast + WhatsApp message if enabled).
4. WHEN spending in a category exceeds 100% THEN a `budget.exceeded` notification is emitted with the overage amount.
5. WHEN a user creates a goal THEN they provide: name, target amount, optional deadline, optional category link (transactions in that category auto-progress the goal).
6. WHEN a user updates a goal's `current_amount` THEN the system recomputes progress percentage and projected completion date based on average contribution rate.
7. WHEN a goal is at risk (projected completion > deadline) THEN the goal returns `risk: true` in the API and the UI flags it.

---

## R10. Recurring detection and forecast

**User story:** As a user, the system tells me which charges repeat (subscriptions, EMI, rent), separates them from variable spending, and forecasts my next 30 days realistically.

### Acceptance criteria

1. WHEN the recurring detector runs (on demand and nightly) THEN it groups transactions by normalized merchant and detects entries that repeat at intervals of 28-32, 6-8, or 88-92 days with amount variance < 15%.
2. EACH detected recurring item stores: merchant, average_amount, frequency_days, next_expected_date, occurrences, confidence.
3. WHEN the forecast endpoint is called THEN the system:
   a. Computes the recurring base = sum of all active recurring items expected in the next 30 days
   b. Builds a daily series from the last 90 days of NON-recurring expenses
   c. Fits ARIMA(1,1,1) on the variable component, forecasts the next 30 days
   d. Returns `recurring_base`, `variable_forecast` array, `total_forecast`, `confidence_band`, `anomalies`
4. WHEN forecast cannot fit ARIMA (insufficient data, < 10 days) THEN it falls back to a trend-aware moving average and returns `method='trend_fallback'`.
5. WHEN any day's actual spend exceeds the forecast confidence band by > 2 sigma THEN it's flagged as an anomaly with reason ("highest in 90 days", "3× last week's average", etc.).
6. THE forecast response is cached for 6 hours per user, invalidated by any new transaction.

---

## R11. AI Copilot (RAG chat + advice)

**User story:** As a user, I ask Vivien questions about my money in plain language and get answers grounded in my actual data, with streaming responses that feel alive.

### Acceptance criteria

1. WHEN a user asks a question via the Copilot (web chat panel or WhatsApp) THEN the system:
   a. Embeds the question (OpenAI text-embedding-3-small)
   b. Runs PgVector cosine search on `transaction_embeddings` for top-20 relevant transactions in the user's space
   c. Computes a structured context: monthly totals, category breakdown, top merchants, active budgets, goals, recurring items
   d. Calls `gpt-4o-mini` with the question + context, streaming the response
2. WHEN streaming, the web client renders tokens as they arrive via Vercel AI SDK; the bot waits for full response then sends in two chunks if > 1500 chars.
3. THE Copilot MUST refuse to fabricate numbers. Its system prompt enforces "If the data does not contain the answer, say so honestly and offer to fetch it."
4. WHEN the Copilot needs precise math (totals, averages, projections) THEN it MUST call a tool function instead of computing inline. Implemented tools: `compute_total(filters)`, `compute_category_breakdown(filters)`, `compute_forecast(period)`, `find_recurring()`, `compare_periods(a, b)`.
5. WHEN a transaction is created or updated THEN its embedding is computed asynchronously and upserted into `transaction_embeddings`.
6. THE advice endpoint (`GET /advice`) returns 3-5 personalized, ranked suggestions based on spending patterns, recurring vampire-charges, and unrealized goal progress.

---

## R12. Reports

**User story:** As a user, I export my data and view financial reports for any date range.

### Acceptance criteria

1. WHEN a user requests a report THEN they provide start_date, end_date, optional categories filter.
2. THE report response includes: summary (income, expense, savings_rate), income_breakdown, expense_breakdown, budget_adherence, top_merchants, top_categories.
3. WHEN a user exports CSV THEN the file includes all transactions in the range with columns: date, description, amount, currency, category, type, wallet, source, notes, tags.
4. WHEN a user exports PDF (stretch) THEN the PDF contains a styled summary, charts (rendered server-side from chart data JSON), and a transaction table.
5. THE CSV import endpoint accepts the same column set, validates rows, returns `{imported, skipped, errors[]}`, skips duplicates by `(date, amount, description)` hash by default.

---

## R13. Lend / borrow ledger

**User story:** As a user, I track money I lent or borrowed from named people, settle them, and never forget who owes whom.

### Acceptance criteria

1. WHEN a user creates a lend entry THEN they provide: counterparty_name, amount, currency, date, optional note, optional linked_transaction_id.
2. WHEN a borrow entry is created THEN same fields, opposite direction.
3. WHEN listing the ledger THEN entries return with status (`open`, `settled`), age in days, and per-counterparty totals.
4. WHEN a user settles an entry partially or fully THEN the system records the settlement, updates the open balance, and optionally creates a linked transaction (incoming/outgoing) on a wallet.
5. WHEN parsing detects a split-bill ("dinner 3000 split with 4 people") THEN the system creates the user's transaction at ₹750 AND auto-creates lend entries for ₹2,250 across "split-counterparty" if no names given (placeholder), or named individuals if extracted.

---

## R14. Multilingual experience

**User story:** As a user, the system speaks my language end-to-end: capture, replies, voice notes, charts.

### Acceptance criteria

1. THE supported languages are: `en`, `hi`, `ml`, `ta`, `te`, `kn`.
2. WHEN a user picks `en`, `hi`, or `ml` THEN replies use the hand-translated message pack (zero-cost, instant).
3. WHEN a user picks `ta`, `te`, or `kn` THEN replies are translated at runtime via `gpt-4o-mini` with sibling-script contamination detection (reject Tamil leaking into Malayalam, etc.) and a one-retry policy.
4. WHEN a user picks `ta` or `ml` AND TTS is enabled THEN voice synthesis uses `gpt-4o-audio-preview` (combined translate+speak, native accents).
5. WHEN a user picks `en`, `hi`, `kn`, or `te` AND TTS is enabled THEN voice synthesis uses `gpt-4o-mini-tts` with explicit per-language `instructions` field.
6. THE web app's UI shell uses the same `en/hi/ml` packs (sidebar labels, buttons, headers); other languages fall back to English UI shell with translated dynamic content.
7. WHEN voice transcription runs on the bot THEN it passes the user's language as a hint to Whisper for accuracy on short voice notes.

---

## R15. Real-time updates

**User story:** As a user, when something happens anywhere (WhatsApp, another tab, recurring engine), my open dashboards reflect it within 1 second.

### Acceptance criteria

1. WHEN a user opens the web app THEN it opens a WebSocket connection to `/ws` authenticated with the JWT.
2. WHEN ANY of these events occur THEN the API broadcasts to the user's WS channel: `transaction.created`, `transaction.updated`, `transaction.deleted`, `budget.warning`, `budget.exceeded`, `goal.updated`, `recurring.detected`, `forecast.invalidated`.
3. WHEN the web client receives an event THEN it updates the relevant TanStack Query cache and animates the change (slide-in row, count-up number).
4. WHEN the WS connection drops THEN the client reconnects with exponential backoff (1s, 2s, 4s, max 30s).
5. WHEN WS is unavailable for any reason THEN the client falls back to polling key endpoints every 15s.

---

## R16. PWA + offline capture

**User story:** As a user, I capture an expense on my phone even when offline; it syncs when I reconnect.

### Acceptance criteria

1. THE web app installs as a PWA with service worker, manifest, icons, theme colors.
2. WHEN the user submits the omnibar offline THEN the capture is stored in IndexedDB with status `pending_sync`.
3. WHEN connectivity returns THEN the service worker drains the queue, posts each capture to the API, and updates local cache with the persisted result.
4. WHEN sync fails (validation error) THEN the entry is marked `sync_failed` with the error and surfaced in a "Pending captures" UI.
5. THE app shell, last-seen dashboard data, and basic charts are visible offline (read-only).

---

## R17. Privacy Mode (browser-side categorization)

**User story:** As a privacy-conscious user, I toggle Privacy Mode and the system stops sending transaction descriptions to the server for AI processing.

### Acceptance criteria

1. WHEN the user toggles Privacy Mode ON for the first time THEN the browser downloads the ONNX MiniLM model and tokenizer (~30 MB) to IndexedDB cache.
2. WHEN Privacy Mode is ON THEN every web-side capture runs categorization in the browser via Transformers.js BEFORE sending to the API.
3. WHEN Privacy Mode is ON THEN the omnibar disables receipt-photo capture and voice transcription (server-bound) and informs the user via tooltip.
4. WHEN Privacy Mode is ON THEN server-stored transactions get `categorized_by='client'`.
5. WHEN Privacy Mode is OFF THEN nothing changes server-side; existing data is untouched.

---

## R18. Security and observability

**User story:** As an operator, the system is reasonable about security and easy to debug.

### Acceptance criteria

1. ALL API routes except `/auth/*`, `/health`, `/qr*` MUST require a valid JWT.
2. JWT contains `user_id`, `active_space_id`, `iat`, `exp`. Refresh token rotates on use; old refresh is blacklisted in Postgres until expiry.
3. THE bot internal HTTP server requires `X-Bot-Secret` header on all non-health routes.
4. PASSWORD policy: ≥12 chars, ≥1 uppercase, ≥1 lowercase, ≥1 digit, ≥1 special char.
5. RATE LIMITING: web auth routes 10/min/IP; capture routes 60/min/user; copilot 20/min/user.
6. ALL logs MUST be structured JSON with `request_id`, `user_id` (when available), `event`, `level`, `ts`. PII (full phone, email) MUST be masked except in DEBUG.
7. SECRETS (API keys, JWT secrets) MUST come from `.env` files that are gitignored.
8. BOT and API MUST NOT log raw transaction descriptions at INFO level (only at DEBUG).

---

## R19. Demo readiness

**User story:** As a hackathon judge, I clone the repo and have a working demo within 5 minutes.

### Acceptance criteria

1. THE repo root README MUST contain a 60-second setup recipe.
2. `bun install` from root MUST install all three workspaces.
3. `docker compose up postgres -d && bun run db:migrate && bun run db:seed` MUST seed a demo user (`demo@finehance.app` / `Finehance#2026!`) with 90 days of realistic Indian transactions across 8 categories.
4. `bun run dev` from root MUST start `web` (5173), `api` (5000), `wa-bot` (5001) concurrently.
5. THE seed data MUST include subscriptions (Netflix, Spotify, Zerodha SIP), salary credits, UPI to common merchants (Swiggy, Zomato, BPCL, Uber, BigBasket), at least one split-bill scenario, and a few entries in different currencies.
6. THE web app at `/` MUST be one click from a useful dashboard, no tutorial walkthrough required.
7. THE WhatsApp bot QR page at `http://localhost:5001/qr` MUST render in a browser, refresh every 5s, and show a clear "scan with WhatsApp" instruction.

---

## Out of scope (explicitly deferred)

- Real bank/UPI sync (Setu/Plaid)
- Multi-user shared spaces UI (schema is ready, UI is v2)
- Mobile-native apps (Tauri/Capacitor)
- iCal recurring import
- Investment portfolio tracking
- Tax-aware reporting
- WhatsApp Business Cloud API migration (whatsapp-web.js only for hackathon)
- Sarvam AI integration (locked to OpenAI for this build)
- Admin/operator console
