# Versifine — Exceptional Bot Plan

**Origin.** Five subagent critiques (cognitive theorist / red-teamer / production veteran / iconoclast / empath) reviewed real production failure screenshots and converged on the same diagnosis: the bot **performs intelligence without expressing uncertainty**, **commits prematurely** at every tier, and **has no working memory of its own open questions**. It works for inputs that match the patterns we coded; it cracks the moment input deviates.

**The user's directive.** "Exceptional. Top notch. Absolutely flawless. Even insane exceptional innovations." Three layers, shipped in order. Each layer assumes the previous one is live.

**Verification rule.** After every single implementation step (one file change, one feature), a brutal review subagent is spawned to scrutinize the change. Any issue raised is fixed before moving on. Build is type-checked + tests run + live-smoked at the end of each step. Push to deploy is gated on a clean review.

**Test count baseline before this plan.** 461 pass / 4 fail (api), 49 pass / 2 fail (wa-bot). The 4+2 fails are pre-existing (DB-dependent + LLM-dependent). New code MUST NOT regress this number.

---

## Layer 1 — Stop the bleeding (1 working day)

Six surgical fixes that kill the screenshots' specific failures. No architecture change. Each is small. Each is independently shippable.

### L1-1 — Open-frame state machine in `pending`

**The failure it kills.** User taps the "which riyal?" picker, types `Omr`, bot shows the onboarding language menu. State lost across turns.

**Root cause.** `state` lives in a single column (`session.state`), and the picker can't change it without breaking the existing `CAPTURE_CONFIRM` interlock with `handleConfirm`. So we leave state at `LINKED_MAIN` and put `currencyChoice` in `pending`. But the engine has many earlier branches (settings detection, language switch, copilot fallback) that fire before our `tryResolveCurrencyChoice`. Any of them can capture the `Omr` reply and reset state.

**The fix.** Introduce a generalized `pending.openFrame` slot:

```ts
interface OpenFrame {
  kind: 'currency_choice' | 'wallet_choice' | 'category_choice' | 'amount_clarify' | ...;
  prompt: string;            // exact text we asked
  options?: Array<{ id: string; label: string; payload: unknown }>;
  draftId?: string;
  ts: number;                // 5-min TTL by default
  ttlMs?: number;            // override per frame
  context: Record<string, unknown>;  // arbitrary data the resolver needs
}
```

Engine ordering becomes:

```
state-handlers (CAPTURE_CONFIRM, etc.)
  → openFrame resolver  ←  NEW: runs FIRST after state-handlers,
                            BEFORE settings/copilot/capture
  → reference command
  → correction shortcut
  → capture flow
```

The openFrame resolver tries to consume the user's reply. Returns `{handled, text}` if it did, `null` to fall through. Fall-through clears the frame so a stale prompt can't lurk.

**Module touched.** `apps/wa-bot/src/conversations/openFrame.ts` (new), `engine.ts` (insert resolver call earlier), all flows that currently set `pending.currencyChoice` (just `currencyPick.ts` today) migrate to `pending.openFrame`.

**Done = test.** Live smoke: `5 riyal coffee` → picker → `Omr` → bot responds with `✅ Logged ₹X (originally OMR 5)`. Greeting menu appears nowhere.

**Brutal review prompt.** Audit for: (a) frame leaks across unrelated flows; (b) TTL race conditions; (c) "stale frame swallows fresh expense" scenarios; (d) interaction with the existing `CAPTURE_CONFIRM` interlock; (e) what happens when user sends both a brand-new expense AND a frame-applicable answer in the same message.

### L1-2 — Picker no-bypass rule

**The failure it kills.** Voice "ഞാൻ രണ്ട് റിയാലിന് ഒരു ചപ്പാത്തിയും പൊറോട്ടയും കഴിച്ചു" → bot says "ഉറപ്പിക്കൂ: SAR 2 — lunch (food)". The picker we built didn't fire because the LLM autonomously filled `currency=SAR` from the word "riyal". Our merge layer cleared the ambiguity flag because `guardedCurrency` was truthy.

**Root cause.** `parser.ts` line setting `ambiguousCurrencyWord` clears it whenever the LLM provided a currency, even when that currency is just the LLM guessing one variant of the same ambiguous word.

**The fix.** Two-part:

1. The deterministic ambiguity detector runs UNCONDITIONALLY on the raw text. If `riyal/rial/dinar` is present without a country qualifier, the flag is set.
2. The flag is cleared ONLY when the user explicitly typed a country qualifier (resolved by `resolveQualifiedCurrency`) OR when the user typed an unambiguous ISO code (`OMR`, `SAR`, etc.) verbatim. The LLM's guess does NOT clear it.

Effect: ambiguity wins over LLM optimism. The user picks.

**Module touched.** `apps/api/src/services/ai/parser.ts` (the merge layer's `ambiguousCurrencyWord` setter). Also tighten `extractAmountWithMeta` to ignore LLM-derived currency when computing the flag.

**Done = test.** Voice/text "rendu riyal" → picker fires every time, regardless of LLM behaviour.

**Brutal review.** Audit for: (a) over-firing — does the picker fire even when the user clearly meant Saudi (e.g. "saudi 5 riyal", "sar 5")? (b) the corollary case — what about "5 dollars"? "dollar" auto-resolves to USD and that's CORRECT, don't break that; (c) compound input like "5 riyal coffee, sent it via OMR" — what should win?

### L1-3 — Language + register lock (the cardinal sin fix)

**The failure it kills.** User: `eda kazhveri njan last chelavakkiyath enthine aan ethara ayi` (Manglish, casual abuse + Malayalam grammar: "hey weirdo what did I spend on last and how much"). Bot replied with a long English-translated lecture about restaurant spending. Cardinal sin.

**Root cause.** The user's session language is set on first onboarding, but error/clarifier/copilot paths render in English when the message pack falls back. Specifically: copilot answers are generated in English then `translateChatAnswer` runs them through the model — but if the user's session language is `en`, no translation happens. Many casual Manglish/Hinglish users have session language `en` because they typed `English` to skip the picker.

**The fix.** Three parts:

1. **Detect input language on every inbound message** with a deterministic 11-language script + romanized-pattern detector (already partially exists). Persist the DETECTED language on each turn alongside the session language.
2. **Mirror rule**: if `detectedLanguage !== en`, every response on this turn (including errors and copilot output) is generated/translated to the detected language. The session language is still authoritative for first-contact onboarding, but the per-turn detected language wins for replies on this turn.
3. **Banned-phrase CI lint**: lint that blocks PRs containing English fallback strings like "I'm not sure what you mean", "I cannot help with that", "Could you rephrase" inside code paths that can fire for non-English users. Replace with localized + actionable templates (offer 2-3 next moves).

**Module touched.** `apps/wa-bot/src/utils/langDetect.ts` (new — deterministic + LLM-backstop), `apps/wa-bot/src/conversations/engine.ts` (set `turnLanguage`), `apps/wa-bot/src/services/ai/translate.ts` (translate copilot output to `turnLanguage`), `apps/wa-bot/src/conversations/messages/*.ts` (fallback strings).

**Done = test.** Live smoke: send `eda kazhveri...` → bot replies in Manglish, never English. Send `aakhri kya tha?` → bot replies in Hindi. Send `english msg` → bot replies in English.

**Brutal review.** Audit for: (a) language detection on a 4-word message with 2 English borrowings — does it stay Hindi or flip to English? (b) the user typed `english` to onboard — do they get stuck in English forever? (c) what happens when the language detector fails open vs fail closed? (d) is romanized Hindi vs Tamil distinguishable from text alone, or do we need user-history priors?

### L1-4 — Image-acknowledge-first contract

**The failure it kills.** User uploads a receipt photo. Bot replies: "എത്ര രൂപയായിരുന്നു?" — never references the image. The user feels invisible.

**Root cause.** Image route always runs vision; if vision fails to extract amount, the route falls into the same clarifier that text would. The clarifier asks "how much?" with no acknowledgment that an image was even sent.

**The fix.** The image route's reply contract:

- Always lead with an acknowledgment of the image (in user's language). E.g. "Photo kandu" / "रसीद देखी" / "Receipt seen".
- Then attempt vision. On success → confirm the extraction. On partial → say what was readable + ask the gap. On failure → "Couldn't read it clearly — could you type the total?" Never silent.
- If multiple line items detected → offer to log them all (we already have batch capture).

**Module touched.** `apps/api/src/routes/capture.ts` (image branch), `apps/wa-bot/src/conversations/messages/*.ts` (new strings), `apps/api/src/services/ai/vision.ts` (return per-field confidences instead of flat result).

**Done = test.** Live smoke: upload a clear receipt → bot acknowledges + extracts. Upload a blurry photo → bot acknowledges + says it couldn't read. Upload a non-receipt → bot acknowledges + asks what we're looking at.

**Brutal review.** Audit for: (a) receipt with multiple totals (subtotal, tax, total) — which wins? (b) multi-currency receipts; (c) user uploads receipt + types caption with amount — caption wins, but does the bot still acknowledge the image? (d) screenshot of a banking app — different shape; (e) memes / non-financial images — graceful path.

### L1-5 — Quantity-vs-price scorer for Indian pre/post-positions

**The failure it kills.** Voice "ഞാൻ രണ്ട് റിയാലിൽ നാല് തപ്പാത്തി അയച്ച്" (4 chappathis at 2 riyal each). Parser extracted `4 riyal`. Picker showed options for "4 riyal" — wrong amount, wrong proposition.

**Root cause.** `pickBareAmount` scores numbers by surrounding context but only knows English markers ("for", "@", "spent"). Indian languages mark the price with a postposition: "X riyalil Y chappathi" — X is the price (postposition `-il` = "in/at"), Y is the quantity. We don't see that.

**The fix.** Extend the price-marker regex with Indian-language postpositions:

- Malayalam: `-il` / `-inu` / `-inte` after a number-currency token = price-side
- Hindi: `-ke` / `-mein` / `-mey` after a number-currency token = price-side
- Tamil: `-il` / `-ku`
- Romanized variants: `riyalil`, `roopayil`, `rupaye mein`, etc.

Effect: in "rendu riyalil naal chappathi", "rendu" (2) is recognized as price, "naal" (4) as quantity. Same scoring logic, more languages.

**Module touched.** `apps/api/src/services/ai/parserRegex.ts` — extend `PRICE_MARKER` and `QUANTITY_UNIT` with Indian-script + romanized postpositional markers. Add deterministic tests.

**Done = test.** Unit + live: "rendu riyalil naal chappathi" → 2 + ambiguous riyal + picker fires.

**Brutal review.** Audit for: (a) the existing English tests must still pass; (b) Hindi inverse word order ("naal chappathi rendu riyal mein"); (c) does the postposition get attached to the number-WORD ("randu" with no digit)?; (d) is the postposition inside a verb conjugation that we're falsely treating as a marker?

### L1-6 — "Last entry" first-class fast path

**The failure it kills.** User: `enthayirunnu ente last transaction` → bot returns this month's summary (₹8,261 total, top: Restaurants ₹4,577). Wrong question, wrong currency, extra info.

**Root cause.** The intent classifier maps anything containing "month / total / how much" patterns to `query_summary`. There's no `query_last` intent, so any phrasing of "what was my last entry" routes to a summary or to chat.

**The fix.** Two parts:

1. Add a new intent `query_last` to the classifier enum, with examples in 11 languages: `last entry`, `last transaction`, `what did I just log`, `aakhri kharch`, `enthayirunnu ente last`, `kadaisi kharch`. Returns the actual last row(s).
2. Deterministic regex fast-path in the bot for the highest-volume phrasings (so we don't pay an LLM round-trip for the most common case): `last (one|entry|transaction|kharch|chelavu|expense)`, `aakhri (entry|kharch)`, `prev/previous`, `recent (one|expense)`. The fast-path shortcuts straight to a "show last 1" handler.

The handler returns: amount in user's base currency, original currency if foreign, category, description, time, and offers "show last 3" / "edit it" / "delete it" as next moves.

**Module touched.** `packages/shared/src/intents.ts` (add `query_last`), `apps/api/src/services/ai/intent.ts` (prompt + examples), `apps/api/src/routes/capture.ts` (handle `query_last`), new `apps/api/src/services/capture/queryLast.ts`, `apps/wa-bot/src/conversations/flows/queryLast.ts` (deterministic fast-path), localized messages.

**Done = test.** Live smoke in 11 languages → bot returns the actual last row, never a summary.

**Brutal review.** Audit for: (a) ambiguous "last" — last month? last entry? Disambiguate by the noun that follows; (b) what if no transaction exists yet?; (c) "show last 3" should also be supported — extend with N parser; (d) interaction with reference resolver — should "the last one" route to last-tx fast path or reference resolver? Probably both can resolve, with last-tx winning for explicit "last".

---

## Layer 2 — Feels-alive upgrades (2-3 weeks)

Three architectural changes that elevate the whole bot. They preserve the current pipeline shape but make every module confidence-aware.

### L2-1 — Best-effort parser contract

The parser never returns null. It always returns:

```ts
{
  amount: { value: number | null; alternatives: number[]; confidence: number };
  currency: { value: Currency | null; alternatives: Currency[]; confidence: number };
  description: { value: string | null; confidence: number };
  // ...
  open_questions: Array<'country_for_riyal' | 'amount_disambig' | ...>;
  partial: boolean;       // true when any field has confidence < 0.7
  reasoning: string;      // one line for traceability
}
```

The gate uses the field-level confidence instead of the current 5-signal vector. Open questions become dialogue frames automatically.

### L2-2 — Confidence-gated UX with mutation tokens

Replace the 5-signal ACT/CONFIRM/ASK gate with one float (overall parse confidence) and two thresholds:

- ≥0.85 → silent execute, reply includes a 6-char mutation token
- 0.55-0.85 → tap-to-confirm with prefilled draft
- <0.55 → ask one targeted question (the highest-leverage field)

The mutation token in the reply: `✅ ₹4 — coffee. (undo: K7P2)`. Sending `K7P2` reverses. No state, no draft id, just a token.

### L2-3 — Banned-phrases lint + mandatory sayback templates

CI lint scans for forbidden English fallback strings outside English-only paths. Every error response must include:

- What the bot understood (or didn't)
- One line of what it did about it
- 2-3 next moves

Templates per modality (text/voice/image) and per error type (low confidence / classifier failed / handler errored / vision failed).

---

## Layer 3 — The bold rebuild (60-90 days)

A continuous-draft, tool-calling LLM brain that replaces the intent classifier + parser + handler dispatcher with a single loop. Six phases.

### L3-P1 — Brain skeleton, parallel deployment (days 1-10)

Build the brain endpoint alongside the existing capture pipeline. It receives the same input but doesn't touch the database. It logs its decisions to a `brain_shadow` table. We compare its decisions to the live pipeline daily.

The brain receives every turn:

- Last 30 turns of conversation (verbatim, no summarization)
- Last 20 transactions (structured)
- Open dialogue frames
- User's style card (initially empty)
- Current modality (text / voice + raw audio summary / image + vision summary)
- Tool catalog (12 tools)

It returns:

```ts
{
  reasoning: string;
  tool: ToolName;
  args: Record<string, unknown>;
  confidence: number;
  draft_event?: DraftEvent;  // a transaction it thinks the user might commit
  reply: string;             // in user's language and register
}
```

### L3-P2 — Context lift (days 11-25)

Today the API hands the LLM ~200 chars of recent context. By the end of this phase, every LLM-touching module gets the full envelope (~10K tokens). Latency budget: stay under 2s p95.

### L3-P3 — Tool catalog complete + classifier kill at 25% traffic (days 26-45)

The 12 tools:

- `record_money_event(side, amount, currency, description, ...)`  - replaces expense, income, transfer, lend, borrow, settle_debt
- `update_last_event(field, value)` - replaces correct_last
- `delete_event(id?)` - replaces delete_last; id optional, default is last
- `query_ledger(scope, period?, category?, ...)` - replaces query_*, reference resolver
- `get_balances(wallet?)` - new, exposes a feature we never had
- `set_budget(category, amount, period)` - replaces set_budget
- `set_goal(name, amount, deadline)` - replaces set_goal
- `schedule_recurring(...)` - replaces recurring engine
- `ask_picker(prompt, options)` - new, formalizes the L1-1 frames
- `ask_user(prompt)` - free-form clarifier
- `set_user_preference(key, value)` - replaces change_language, currency-default, etc.
- `emit_reply(text, modality?)` - the final response

Once the brain matches the legacy pipeline on 95% of decisions for 2 weeks, switch 25% of traffic to it.

### L3-P4 — Style cards + native multilingual replies + voice replies at 60% (days 46-60)

Each user gets an 800-token style card regenerated every 50 turns. Captures their language mix, register, common counterparties, common merchants, time-of-day patterns, etc. Fed to the brain as context. Brain generates replies natively in the user's voice — no runtime translation needed.

### L3-P5 — Continuous draft + multimodal unification at 100% (days 61-75)

Every turn, the brain produces a `draft_event` even when the user wasn't logging a transaction. The draft is staged but not shown. When the user references something ("no actually 50 not 40"), the draft is already prepared. The bot is keeping books WITH the user.

Multimodal unification: image + voice + text are all one input to the brain. No separate routes.

### L3-P6 — Delete the old pipeline (days 76-90)

Target end state: ~3K LOC of TypeScript. The brain + the tool implementations + the WhatsApp adapter + the database. Everything else — the intent enum, the parser, the merge guards, the gate, the typed handlers, the runtime translate fallback, the planner, the reference resolver as a tier — is deleted.

---

## Working agreement

1. **One implementation step at a time.** No batching.
2. **After each step, spawn a brutal review subagent.** They get the diff + the failure-mode list + the test plan. They produce a ranked critique. ANY P0/P1 issue is fixed before the next step.
3. **Type-check both apps + run all tests** at the end of every step.
4. **Live smoke** the specific failure mode the step claims to fix, against the deployed bot. If the smoke fails, the step isn't done.
5. **Push to deploy** only after the brutal review is clean and the smoke is green.
6. **No regressions** to the test count. 461/4 (api), 49/2 (wa-bot).

Begin Layer 1 immediately. Layer 2 starts when all Layer 1 steps are green and live-verified. Layer 3 starts when Layer 2 is green.
