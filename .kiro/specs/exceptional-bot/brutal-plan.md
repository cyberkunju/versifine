# Versifine — Brutal Plan (Layer 2.5: root-cause rebuild)

**Origin.** A second 5-subagent brutal review (chaos-user / frontier-iconoclast / production-SRE / retention-psychologist / code-switching-linguist) audited the live bot. They converged on ONE root cause:

> **The bot collapses to a single verdict too early and never expresses uncertainty.** It either silently commits (sometimes to money the user never spent) or coldly rejects. That binary IS the user's complaint: "it only does what it's told / we can't be sure in anything / why AI."

Every flaw below is a symptom of premature commitment + invisible uncertainty + no working memory of the user.

**Working agreement (unchanged, enforced).**
1. One implementation step at a time. No batching.
2. After each step, spawn a brutal-review subagent with the diff + failure-mode list + test plan. Any P0/P1 finding is fixed before the next step. If the subagent times out, do the review manually before commit.
3. Type-check both apps + run all tests at the end of every step. No regression to the baseline test count.
4. Live-smoke the specific failure the step fixes against the deployed bot. If smoke fails, the step isn't done.
5. Push to deploy (`git push origin main` → GH Actions) only after review is clean and smoke is green.

**Baselines (do not regress).** api: 487 pass / 4 fail (pre-existing: 3 DB email-linking, 1 LLM batch). wa-bot: 152 pass / 2 fail (pre-existing skip + expired-draft). Each new step ADDS tests.

---

## P0 — correctness & trust killers (code-confirmed)

| # | Flaw | Root cause (file) | Status |
|---|------|-------------------|--------|
| P0-1 | Compound message logs ONE leg, silently drops the rest | `planner.ts` built but shadow-only (`capture.ts:635` `void planActions().then(logPlannerShadow)`) | **TODO (item 2)** |
| P0-2 | Phantom money: negation/conditional/future/sarcasm with a number auto-logs | No epistemic layer anywhere; `extractAmount` treats any digit as an asserted amount | TODO (item 3) |
| P0-3 | Mixed-currency batch booked rupee item as foreign (80× error) | `parsedFromLlmData` ran foreign-token check on WHOLE message | **DONE `22b19f3`** |
| P0-4 | Multi-currency totals add across currencies ("$2,100" = $100+₹2000) | `query.ts` SUMs `base_amount` across wallets of different currencies; reply formatter sums naively | **TODO (item 1 — confirmed live)** |
| P0-5 | FX-outage rows store raw foreign amount as base forever (5 OMR = ₹5) | `needsFxResolution` written in `create.ts`, read by NOBODY (no worker) | TODO (item 4) |
| P0-6 | Cardinal sin still live: Manglish in → English out on lexicon miss | `langDetect` closed ~60-word set → null → falls back to `session.language='en'`; `transcribe.ts` uses Sarvam TRANSLATE endpoint, destroying native script + register | TODO (item 5) |
| P0-7 | Frame kinds with no resolver silently drop the question | only `currency_choice` wired in `bootstrapResolvers()` | TODO (item 7) |

## P1 — trust & reliability

| # | Flaw | Fix direction |
|---|------|---------------|
| P1-1 | Cold dead-ends (`unknown`, `captureFailed`, `error`, `engineError`) all end in RESET | Best-effort reflection + 2-3 next moves; never dead-end, never blame, reserve RESET for real corruption |
| P1-2 | Emotion stripped (`wasted 5000` → `✅ Logged ₹5,000`) | Affect-aware one-beat acknowledgment before the receipt |
| P1-3 | CONFIRM/EDIT/CANCEL friction on trivial logs while undo-tokens exist | Confidence-gated: act-with-undo high, peer-style one question low |
| P1-4 | Out-of-order delivery → bare `undo`/`delete` reverses wrong row; no idempotency key | End-to-end wamid idempotency key (claim-before-process) + send-time ordering |
| P1-5 | Code-switched math not multiplied (`4 chai 10 each`); self-correction (`500 no wait 600`) ungoverned; typo amounts (`5oo`) drop to chat | qty×unit scorer; repair-marker stream parse; amount-typo normalizer |
| P1-6 | "Future similar entries will use this category" promise not provably kept | Visible memory receipt on later override fire |

## Exceptional innovations (the moat — built after P0/P1 stable)

- **I-1 Epistemic layer** — clause-level `asserted/negated/future/hypothetical/quoted/interrogative`; only `asserted` mints money. (also fixes P0-2)
- **I-2 Belief-state, not verdict** — ranked interpretations; close top-2 → one tappable disambiguation message.
- **I-3 Per-user prior card** — currency-home, merchants, slang→category, typo fingerprint, language mix. Auto-resolves the picker for a Dammam user's "riyal"→SAR with a one-tap escape; biases language detection toward the user.
- **I-4 Continuous draft / co-bookkeeping** — staged draft every turn so fragments finish in one step.
- **I-5 Affect-aware + correction-as-teaching with visible memory receipt.**
- **I-6 Event-sourced ledger + reconciliation invariant** — "prove the books balance" job; mutation log is 80% of an event store.

---

## BUILD ORDER (execute top-down, brutal-review gate after each)

1. **Multi-currency totals correctness (P0-4)** — confirmed live ("$2,100 total"). A space has ONE base currency; every row stores `base_amount` in THAT currency; summaries + batch reply totals use it. Audit `query.ts`, `create.ts` baseAmount semantics, and the batch reply formatter.
2. **Flip the planner live for compound intents (P0-1)** — behind `allAmountsGrounded`; execute basket transactionally; per-line undo tokens; keep legacy path for single-action. The #1 "why AI" win.
3. **Epistemic layer (P0-2 / I-1)** — deterministic negation/conditional/future cues (multilingual) + LLM backstop; only asserted clauses mint money; hypothetical → advice; future+date → schedule.
4. **FX resolution worker (P0-5)** — background job resolves `needsFxResolution` rows with historical-pinned rates; until then flag clearly in reply.
5. **Cardinal sin, for real (P0-6)** — langDetect fails TOWARD the user (per-user dominant language prior), not English; native-script STT path so register/script survive; every outbound string respects turn language.
6. **Trust copy pass (P1-1/2/3)** — kill dead-ends; affect-aware acknowledgment; collapse the CONFIRM gate onto confidence + undo rail.
7. **Frame-resolver coverage (P0-7)** — register resolvers for every declared `FrameKind`; CI assertion that each kind has one.
8. **Idempotency key (P1-4)** — wamid claim-before-process; UNIQUE(space_id, request_key); send-time causal ordering.
9. **Repair-marker + qty×unit + typo normalizer (P1-5).**
10. **Innovations I-2 … I-6** as separate tracked efforts once 1-9 are green.

---

## Status log

- `22b19f3` — P0-3 per-item foreign-currency guard. DONE, live-verified.
- `79603c2` — P0-4 (display half / item 1a): multi-item log total never sums across currencies. DONE, live-verified ("$100 + ₹2,000 total"). Brutal-review P1s folded in (item-derived total, normalised currency key, per-item rounding).
- **item 1b (deferred)** — deeper P0-4: `create.ts` stores `baseAmount` in WALLET currency, not space base, so `query.ts`/`reports/summary.ts` sums are wrong for multi-currency-WALLET spaces. Needs space-base anchoring (+ intersects FX worker, item 4).
- (next) **item 2** — flip the planner live for compound intents.
