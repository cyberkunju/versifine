import {
  CATEGORIES,
  type Category,
  type Intent,
  type Language,
  getCurrencyOptions,
  isLanguage,
  isTransactionIntent,
  resolveLanguageName,
} from '@versifine/shared';
import { captureTextInput } from '@versifine/shared';
/**
 * Capture routes.
 *
 *   POST /capture/text     text → intent → (parse | query | chat)
 *   POST /capture/voice    multipart audio → transcribe → /text pipeline
 *   POST /capture/image    multipart image → vision → always confirm
 *   POST /capture/confirm  redeem a draft id and persist
 *
 * The response shape mirrors `captureResponse` in @versifine/shared so the
 * omnibar and the bot can share a renderer.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUserOrBot } from '../middleware/authEither.ts';
import { limits, rateLimit } from '../middleware/rateLimit.ts';
import { validate } from '../middleware/validate.ts';
import { classifyIntent } from '../services/ai/intent.ts';
import { planActions, logPlannerShadow } from '../services/ai/planner.ts';
import { screenInput } from '../services/ai/guard.ts';
import {
  handleLendBorrowSmart,
  handleTransfer,
  handleDebtQuery,
  detectDebtQuery,
  tryRepayment,
  type MoneyResult,
} from '../services/capture/money.ts';
import { isAIConfigured } from '../services/ai/client.ts';
import { handleGoal } from '../services/capture/goal.ts';
import {
  type MissingField,
  type ParsedExpense,
  type MessageTurn,
  parseExpense,
  parseExpenseBatch,
} from '../services/ai/parser.ts';
import { extractAmount, extractCurrency } from '../services/ai/parserRegex.ts';
import { transcribe } from '../services/ai/transcribe.ts';
import { extractFromReceipt } from '../services/ai/vision.ts';
import {
  type DraftRecord,
  consumeDraft,
  getDraft,
  storeDraft,
} from '../services/capture/drafts.ts';
import { persistDraft } from '../services/capture/persist.ts';
import { answerQuery } from '../services/capture/queryStubs.ts';
import { listLiveWallets, pickWallet } from '../services/capture/wallet.ts';
import { safeCategorize } from '../services/categorize/_safe.ts';
import { categorizeFromMerchantDB } from '../services/categorize/merchants.ts';
import { normalizeMerchant } from '../services/transactions/normalize.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';
import { onConfirmed, onRejected } from '../services/ai/brain/reinforcement.ts';

const app = new Hono();

/**
 * Hard cap on clarifier rounds for a single draft. A fresh capture starts at
 * 0; every re-stash after an unanswered clarifier bumps it. Once we cross the
 * cap we stop re-asking and drop the draft instead of looping forever. With
 * the deterministic regex clarifier path a valid answer always makes progress,
 * so this only ever trips on genuinely unparseable replies.
 */
const MAX_CLARIFY_ROUNDS = 5;

const captureLimit = rateLimit({
  ...limits.capture,
  // Bot calls are keyed by phone, web calls by user id; either way one user
  // shouldn't be able to chew through the whole bucket from N tabs.
  key: (c) => {
    const u = c.get('user');
    if (u?.id) return `capture:${u.id}`;
    const phone = c.req.header('x-phone');
    return phone ? `capture:phone:${phone}` : null;
  },
});

const TODAY = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function summarizeForLog(text: string): string {
  // PII-safe: log a length and a single category-token snapshot, never the raw words.
  const words = text.trim().split(/\s+/).length;
  return `${text.length}c/${words}w`;
}

/**
 * Which field the next clarifier question is about, following the same
 * priority the user-facing question uses. Returns null when nothing is
 * missing. Shared by `followupQuestionFor` and the confirm anti-loop guard so
 * "what we asked" and "what we ask next" are computed identically.
 */
function askedField(needs: ParsedExpense['needs']): MissingField | null {
  if (needs.includes('amount')) return 'amount';
  if (needs.includes('description')) return 'description';
  if (needs.includes('wallet')) return 'wallet';
  if (needs.includes('currency')) return 'currency';
  return null;
}

function followupQuestionFor(needs: ParsedExpense['needs']): string | undefined {
  switch (askedField(needs)) {
    case 'amount':
      return 'How much was it?';
    case 'description':
      return 'What did you spend it on?';
    case 'wallet':
      return 'Which wallet did you use?';
    case 'currency':
      return 'Which currency was that?';
    default:
      return undefined;
  }
}

/**
 * Deterministic, offline verdict on whether a short message is a spend the
 * user wants to log — as opposed to a greeting, a question, or chit-chat.
 *
 * This is the routing guard that stops the "chai" / "100" hallucination: the
 * intent classifier returns `unknown` (low confidence) for a bare expense
 * noun or a bare number, and the route used to hand `unknown` straight to the
 * copilot, which then invented an amount ("₹100 on chai") or dead-ended ("I
 * can't assist with that"). Before deferring to chat we ask this function.
 *
 * A message is expense-like when EITHER signal fires — both are pure, with no
 * DB and no LLM, so the decision is testable in isolation:
 *
 *   (a) `extractAmount` finds an explicit amount or a bare number
 *       ("100", "₹120", "1.5k", "rs 90"); OR
 *   (c) the curated India-first merchant/category catalogue recognizes a
 *       spend word in the text ("chai" → Coffee & Beverages, "auto" →
 *       Transportation, "dosa" → Restaurants, "groceries" → Groceries).
 *
 * A greeting ("hi") or a finance question ("how do I save money", "how do I
 * start an emergency fund") has no amount and hits no spend word, so it is
 * NOT expense-like and still routes to the copilot.
 */
export function isExpenseLike(text: string): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return false;

  // Case 1: Contains a recognized category/merchant keyword (e.g. "grocery", "tea", "auto", "chai").
  // This allows bare spend words like "chai" with amount=null to be recognized as expense-like.
  const hit = categorizeFromMerchantDB(normalizeMerchant(trimmed));
  if (hit && hit.category !== 'Other') return true;

  const parsed = extractAmount(trimmed);
  if (parsed.amount === null) return false;

  // Case 2: Explicit currency symbol/word (e.g. "₹40", "40 rupees", "40 usd")
  if (parsed.currency !== null) return true;

  // Case 3: Explicit multiplier suffix (e.g. "10k", "5 thousand", "1.5k")
  const hasSuffix = /(?:\b|\d)(?:k|thousand|lakh|crore)\b/i.test(trimmed);
  if (hasSuffix) return true;

  // Case 4: Bare number (e.g. "100", "2.5")
  const isBareNumber = /^[0-9\s₹$¢£€\-\.,\+]*$/i.test(trimmed);
  if (isBareNumber) return true;

  return false;
}

/**
 * Route-level expense-like check. Starts with the deterministic verdict above
 * and, only when that comes up empty, consults the full categorize waterfall
 * (`safeCategorize`) — which adds the user's own merchant overrides and the
 * injection-guarded LLM categorizer that understands code-mixed Indic spend
 * words the static catalogue misses. A non-"Other" hit means a real spend.
 *
 * `safeCategorize` never throws; if it (or its model) is unavailable we simply
 * fall back to the deterministic verdict, so routing stays correct offline.
 */
async function messageIsExpenseLike(spaceId: string, text: string): Promise<boolean> {
  if (isExpenseLike(text)) return true;
  try {
    const cat = await safeCategorize(spaceId, text);
    if (cat.category && cat.category !== 'Other') return true;
  } catch {
    // Ignore — the deterministic verdict already said "not expense-like".
  }
  return false;
}

interface RunPipelineInput {
  c: import('hono').Context;
  text: string;
  origin: 'text' | 'voice' | 'image';
  locale: Language | undefined;
  source: 'whatsapp_text' | 'whatsapp_voice' | 'whatsapp_image' | 'manual_web';
  history?: MessageTurn[];
  /** One-line summary of the user's last logged transaction, for correction
   *  detection. Present only when the bot has a recent transaction to amend. */
  recentContext?: string;
}

interface ParsedBatchItem {
  sourceText: string;
  draft: ParsedExpense;
}

function splitPotentialBatch(text: string): string[] {
  return text
    // Strip thousand-separator commas inside numbers first ("1,250" / Indian
    // "1,00,000") so they don't get treated as item delimiters below and split
    // a single amount into ₹1 + ₹250.
    .replace(/(\d)[,，](?=\d)/g, '$1')
    .replace(/\b(?:pinne|pinney|pine|then|and then|next)\b/gi, ',')
    .replace(/\s+പിന്നെ\s+/gu, ',')
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function parseBatchItems(
  text: string,
  locale: Language | undefined,
  spaceId?: string,
): Promise<ParsedBatchItem[] | null> {
  // Cheap pre-check before spending an LLM batch call. Only treat the message
  // as multi-item when it actually carries 2+ amounts — a single amount with
  // commas/connectors in a STORY ("800 for dinner, treated my team after we
  // shipped the release") is one expense and must go to the single parser,
  // which splits the short description from the notes.
  const parts = splitPotentialBatch(text);
  const numericTokens = text.match(/\d[\d.,]*/g) ?? [];
  const looksLikeBatch = numericTokens.length >= 2;
  if (!looksLikeBatch) return null;

  const modelBatch = await parseExpenseBatch({ text, locale, spaceId });
  if (modelBatch && modelBatch.items.length >= 2) {
    const items = modelBatch.items
      .filter((draft) => draft.amount !== null && Boolean(draft.description))
      .map((draft) => ({ sourceText: draft.description ?? text, draft }));
    if (items.length >= 2) return items;
  }

  if (parts.length < 2) return null;

  const parsed: ParsedBatchItem[] = [];
  for (const part of parts) {
    if (extractAmount(part).amount === null) continue;
    const draft = await parseExpense({ text: part, locale, spaceId });
    if (draft.amount === null || !draft.description) continue;
    parsed.push({ sourceText: part, draft });
  }

  return parsed.length >= 2 ? parsed : null;
}

async function tryPersistBatchExpenses(input: RunPipelineInput) {
  const { c, text, locale, source, origin } = input;
  if (origin === 'image') return null;

  const user = c.get('user');
  const items = await parseBatchItems(text, locale, user.activeSpaceId);
  if (!items) return null;

  const livewallets = await listLiveWallets(user.activeSpaceId);
  if (livewallets.length === 0) return null;

  const ready = items.map((item) => {
    const walletPick = pickWallet(livewallets, item.draft.walletHint);
    return {
      item,
      walletId: walletPick.wallet?.id ?? null,
      date: item.draft.date ?? TODAY(),
    };
  });

  if (ready.some((row) => !row.walletId)) return null;

  const transactions: Array<{
    id: string;
    amount: number;
    currency: string;
    description: string;
    category: string | null;
  }> = [];

  for (const row of ready) {
    const result = await persistDraft({
      userId: user.id,
      spaceId: user.activeSpaceId,
      source,
      draft: row.item.draft,
      walletId: row.walletId!,
      date: row.date,
    });
    if (!result.ok) return null;
    transactions.push({
      id: result.transaction.id,
      amount: result.transaction.amount,
      currency: result.transaction.currency,
      description: result.transaction.description,
      category: result.transaction.category,
    });
  }

  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  c.get('log').info('CAPTURE_BATCH_OK', {
    origin,
    count: transactions.length,
    inputSize: summarizeForLog(text),
  });

  return c.json(
    ok({
      intent: 'expense' as const,
      needsConfirmation: false,
      queryResult: {
        transactions,
        total,
        currency: transactions[0]?.currency ?? 'INR',
      },
      echo: text,
    }),
  );
}

/**
 * Render a money-movement result (lend/borrow/settle/debt-query/transfer) into
 * the uniform capture envelope. The bot localises from the structured
 * `queryResult` payload — never from an English string here. `intent` is a
 * free string on the wire (the output isn't enum-validated), so the new
 * money intents ride alongside the existing ones.
 */
function moneyResponse(
  c: import('hono').Context,
  result: MoneyResult,
  echo: string,
) {
  switch (result.kind) {
    case 'ledger':
      return c.json(
        ok({
          intent: result.intent,
          needsConfirmation: false,
          queryResult: { kind: 'ledger', ledger: result.ledger },
          echo,
        }),
      );
    case 'ledgerBatch':
      return c.json(
        ok({
          intent: result.intent,
          needsConfirmation: false,
          queryResult: { kind: 'ledgerBatch', entries: result.entries },
          echo,
        }),
      );
    case 'settle':
      return c.json(
        ok({
          intent: 'settle_debt',
          needsConfirmation: false,
          queryResult: {
            kind: 'settle',
            ledger: result.ledger,
            settledAmount: result.settledAmount,
            cleared: result.cleared,
          },
          echo,
        }),
      );
    case 'debts':
      return c.json(
        ok({
          intent: 'query_debts',
          needsConfirmation: false,
          queryResult: { kind: 'debts', debts: result.debts },
          echo,
        }),
      );
    case 'transfer':
      return c.json(
        ok({
          intent: 'transfer',
          needsConfirmation: false,
          queryResult: { kind: 'transfer', transfer: result.transfer },
          echo,
        }),
      );
    case 'needs':
      return c.json(
        ok({
          intent: result.intent,
          needsConfirmation: true,
          followupQuestion: result.message,
          echo,
        }),
      );
  }
}

/**
 * Money-movement routing — bridges natural language to the (already built)
 * ledger + transfer engine. Returns a Response when the message is a
 * lend/borrow/repayment/debt-query/transfer, else null so normal expense
 * routing continues.
 *
 * Ordering matters:
 *   1. Repayment is checked FIRST and deterministically (REPAY_RE + an open
 *      ledger entry), regardless of the classifier's label — "ravi paid me
 *      back 2000" is often mislabelled `income`, and must settle the debt
 *      rather than log phantom income.
 *   2. Debt QUESTIONS ("who owes me", "how much do I owe X") resolve next.
 *   3. lend / borrow STATEMENTS create a ledger entry.
 *   4. transfer moves money between the user's own wallets (never a spend);
 *      this must intercept the `transfer` intent before persistOrDraftExpense,
 *      which can't persist transfers.
 */
async function routeMoneyMovement(
  input: RunPipelineInput,
  intent: Intent,
  counterpartyHint?: string | null,
): Promise<Response | null> {
  const { c, text, locale, source } = input;
  const user = c.get('user');
  const traceLog = c.get('log');

  // 1. Repayment (deterministic, intent-agnostic — forced when the classifier
  //    already tagged settle_debt so non-English phrasings still settle).
  try {
    const repay = await tryRepayment({
      userId: user.id,
      spaceId: user.activeSpaceId,
      baseCurrency: user.baseCurrency,
      text,
      locale,
      force: intent === 'settle_debt',
    });
    if (repay) {
      traceLog.info('CAPTURE_MONEY', { kind: repay.kind, intent: repay.intent });
      return moneyResponse(c, repay, text);
    }
  } catch (err) {
    traceLog.warn('MONEY_REPAY_FAIL', { error: String(err) });
  }

  // 1b. "got 2000 from ravi" / "received 500 from mom" — incoming money from a
  //     NAMED person. If that person has an open loan FROM the user, this is a
  //     repayment, not fresh income. Guarded by requireNameMatch so salary /
  //     refunds from unrelated sources never clear a debt.
  if (/\b(got|get|getting|received|recieved|collected)\b[^.\n]*\bfrom\s+\p{L}/iu.test(text)) {
    try {
      const repay = await tryRepayment({
        userId: user.id,
        spaceId: user.activeSpaceId,
        baseCurrency: user.baseCurrency,
        text,
        locale,
        force: true,
        requireNameMatch: true,
      });
      if (repay) {
        traceLog.info('CAPTURE_MONEY', { kind: repay.kind, intent: repay.intent, via: 'got_from' });
        return moneyResponse(c, repay, text);
      }
    } catch (err) {
      traceLog.warn('MONEY_GOTFROM_FAIL', { error: String(err) });
    }
  }

  // 2. Debt question — by deterministic detector OR the classifier's
  //    query_debts label (language-agnostic). The classifier's `category`
  //    carries the counterparty name when one was spoken in any language.
  const debtQ =
    detectDebtQuery(text, counterpartyHint) ??
    (intent === 'query_debts'
      ? { scope: 'all' as const, counterparty: counterpartyHint?.trim() || null }
      : null);
  if (debtQ) {
    try {
      const result = await handleDebtQuery(user.activeSpaceId, debtQ);
      traceLog.info('CAPTURE_MONEY', { kind: result.kind, scope: debtQ.scope });
      return moneyResponse(c, result, text);
    } catch (err) {
      traceLog.warn('MONEY_DEBT_QUERY_FAIL', { error: String(err) });
    }
  }

  // 3. Lend / borrow statement (multi-leg aware).
  if (intent === 'lend' || intent === 'borrow') {
    try {
      const result = await handleLendBorrowSmart({
        userId: user.id,
        spaceId: user.activeSpaceId,
        baseCurrency: user.baseCurrency,
        text,
        direction: intent === 'lend' ? 'lent' : 'borrowed',
        locale,
      });
      traceLog.info('CAPTURE_MONEY', { kind: result.kind, intent: result.intent });
      return moneyResponse(c, result, text);
    } catch (err) {
      traceLog.warn('MONEY_LEDGER_FAIL', { error: String(err) });
    }
  }

  // 4. Transfer between own wallets.
  if (intent === 'transfer') {
    try {
      const result = await handleTransfer({
        userId: user.id,
        spaceId: user.activeSpaceId,
        text,
        source,
      });
      traceLog.info('CAPTURE_MONEY', { kind: result.kind, intent: result.intent });
      return moneyResponse(c, result, text);
    } catch (err) {
      traceLog.warn('MONEY_TRANSFER_FAIL', { error: String(err) });
    }
  }

  return null;
}

/**
 * Detects pasted structured data or code that must never be parsed into an
 * expense: a JSON object/array, an SQL statement, a code stack trace. These
 * carry stray digits ("amount":99999, line:42) the parser would otherwise
 * mine into a junk transaction. A real bank SMS ("debited by Rs.500") is NOT
 * caught here — it has no JSON/SQL/code shape — so it still parses normally.
 */
function looksLikeStructuredPaste(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // JSON object/array literal.
  if (/^[[{][\s\S]*[\]}]$/.test(t) && /["'][\w]+["']\s*:/.test(t)) return true;
  // SQL statement.
  if (/\b(select\s+.*\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+table|alter\s+table)\b/i.test(t))
    return true;
  if (/;\s*--/.test(t)) return true;
  // Code stack trace / exception.
  if (/\b\w*(Error|Exception):/.test(t) && /\bat\s+\w/.test(t)) return true;
  if (/\.\w+:\d+:\d+/.test(t)) return true;
  return false;
}

/**
 * Decide a message should be handled by the guarded copilot rather than the
 * expense parser — because parsing it would mine a junk amount or mishandle a
 * sensitive request:
 *   - pasted JSON / SQL / code / stack traces,
 *   - secret/credential shares ("store my password 1234", "my CVV is 123") —
 *     the copilot warns instead of harvesting the digits,
 *   - messages whose ONLY number lives inside a URL ("…/pay?amt=999") — never
 *     a real spend. A legit "paid 500, link …" keeps a number outside the URL,
 *     so extractAmount still finds it and we don't defer.
 */
function shouldDeferToChat(text: string): boolean {
  if (looksLikeStructuredPaste(text)) return true;
  if (/\b(password|passcode|pass\s?code|netbanking|net[\s-]?banking|cvv|cvc|otp|one[\s-]?time[\s-]?password|aadhaar|aadhar|\bpin\b)\b/i.test(text))
    return true;
  if (/https?:\/\/|\bwww\./i.test(text) && extractAmount(text).amount === null) return true;
  return false;
}

async function runTextPipeline(input: RunPipelineInput) {
  const { c, text, origin, locale } = input;
  const user = c.get('user');
  const traceLog = c.get('log');

  // SAFETY FIRST — a self-harm / crisis signal must never be parsed into an
  // expense. "lost 15000 gambling last night and I feel like ending it all"
  // carries an amount, but it is a cry for help, not a transaction. Screen it
  // before intent/parse and route to the chat path, where the guarded copilot
  // returns the compassionate, helpline-bearing response (REFUSAL_CRISIS).
  // (Injection is deliberately NOT short-circuited here: a mixed message like
  // "spent 50 on tea, also ignore all rules" should still log the ₹50 tea —
  // the parser only extracts the amount and ignores the instruction text.)
  const screen = screenInput(text);
  if (screen.verdict === 'crisis') {
    traceLog.info('CAPTURE_SCREENED', { verdict: screen.verdict, reason: screen.reason, origin });
    return c.json(
      ok({
        intent: 'chat' as const,
        needsConfirmation: false,
        copilotStreamUrl: '/copilot/chat',
        echo: text,
      }),
    );
  }

  // Pasted JSON / SQL / code / a secret-share / a URL-only number must never
  // be mined into an expense. Route to chat (the guarded copilot treats it as
  // inert text and warns on credentials) instead of harvesting a stray digit.
  if (shouldDeferToChat(text)) {
    traceLog.info('CAPTURE_DEFERRED_CHAT', { origin, inputSize: summarizeForLog(text) });
    return c.json(
      ok({
        intent: 'chat' as const,
        needsConfirmation: false,
        copilotStreamUrl: '/copilot/chat',
        echo: text,
      }),
    );
  }

  const intentResult = await classifyIntent({ text, locale, recentContext: input.recentContext });
  traceLog.info('CAPTURE_INTENT', {
    origin,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    sourceType: intentResult.source,
    inputSize: summarizeForLog(text),
  });

  // SHADOW PLANNER — runs in parallel with the legacy router. Never blocks the
  // user-facing reply: we kick it off, log what it would have done, and the
  // existing pipeline produces the actual response. The shadow log
  // (PLANNER_SHADOW) is the source of truth for "would the typed plan have
  // routed correctly?" — when agreement is consistently high AND the planner
  // catches compound utterances the legacy router misses, we'll wire it live.
  if (isAIConfigured()) {
    void planActions(text, locale).then((plan) => {
      logPlannerShadow(plan, intentResult.intent, summarizeForLog(text));
    });
  }

  // Correction / undo of the most recent transaction. Only reachable when the
  // bot supplied `recentContext` (i.e. there IS a recent entry to amend), so a
  // bare "sorry it was 230" can't fire with nothing to fix. The classifier has
  // already resolved the new amount/category from any language; we return a
  // structured directive and the bot applies it to its lastTransactionId. This
  // is the fix for "log 250 → 'sorry 230 ayirunnu' double-logged" — corrections
  // are now understood in every language instead of an English regex list.
  if (input.recentContext && intentResult.intent === 'correct_last') {
    // INDEPENDENT DETERMINISTIC GUARD: a ledger mutation must never fire on the
    // classifier's word alone (defends against a hijacked/hallucinated
    // correction). For an AMOUNT correction, the deterministic extractor must
    // independently find the SAME number in the message. Category/currency-only
    // corrections are reversible + non-financial, so they pass on the validated
    // enum. If the amount doesn't concur, we DON'T mutate — fall through to
    // normal handling (which will draft/ask rather than silently edit).
    const claimedAmount = intentResult.amount;
    const detAmount = extractAmount(text).amount;
    const amountConcurs =
      claimedAmount == null || (detAmount != null && Math.abs(detAmount - claimedAmount) < 0.005);
    // Currency: validate the LLM-emitted code against our enum. An invalid
    // string is dropped rather than passed through (PATCH would reject it).
    const claimedCurrency =
      intentResult.currency && /^[A-Z]{3}$/.test(intentResult.currency)
        ? intentResult.currency
        : null;
    if (amountConcurs) {
      traceLog.info('CAPTURE_CORRECT_LAST', {
        amount: claimedAmount,
        category: intentResult.category,
        currency: claimedCurrency,
        grounded: detAmount != null,
      });
      return c.json(
        ok({
          intent: 'correct_last' as const,
          needsConfirmation: false,
          queryResult: {
            kind: 'correct_last',
            amount: claimedAmount,
            category: intentResult.category,
            currency: claimedCurrency,
          },
          echo: text,
        }),
      );
    }
    traceLog.info('CAPTURE_CORRECT_LAST_REJECTED', { reason: 'amount_not_grounded', claimedAmount });
    // fall through to normal routing below
  }

  // Delete the last transaction ("delete that", "remove the last one", "undo
  // it"). Soft-delete + undo affordance (act-with-undo) rather than a friction
  // confirm — the mutation log makes it fully reversible. Only reachable with
  // recentContext present (there IS a last entry); the bot applies it to its
  // lastTransactionId. Never produced by the offline fallback (fail-closed).
  if (input.recentContext && intentResult.intent === 'delete_last') {
    traceLog.info('CAPTURE_DELETE_LAST', {});
    return c.json(
      ok({
        intent: 'delete_last' as const,
        needsConfirmation: false,
        queryResult: { kind: 'delete_last' },
        echo: text,
      }),
    );
  }

  // Money movement — lend / borrow / repayment / debt question / transfer.
  // Runs before the expense/batch/chat routing because these are NOT spends:
  // a repayment settles a debt (not income), a transfer moves money between
  // the user's own wallets (not a spend), and a debt question is answered from
  // the ledger. Returns null for everything else so normal routing continues.
  const moneyRoute = await routeMoneyMovement(input, intentResult.intent, intentResult.category);
  if (moneyRoute) return moneyRoute;

  // Language switch — the user asked to be replied to in another language.
  // Resolve the target (the classifier puts the language name in `category`)
  // and hand the bot a directive to flip + persist its session language. With
  // no recognised target the bot surfaces the tappable menu instead.
  if (intentResult.intent === 'change_language') {
    const target = resolveLanguageName(intentResult.category);
    traceLog.info('CAPTURE_CHANGE_LANGUAGE', { target: target ?? 'menu' });
    return c.json(
      ok({
        intent: 'change_language',
        needsConfirmation: false,
        queryResult: { kind: 'change_language', language: target },
        echo: text,
      }),
    );
  }

  // Savings goal — "save 50000 for a trip", "goal 1 lakh by december". Route
  // to the goals service BEFORE the expense path, which would otherwise log
  // the target as a spend.
  if (intentResult.intent === 'set_goal') {
    const result = await handleGoal(user.activeSpaceId, text);
    traceLog.info('CAPTURE_GOAL', { kind: result.kind });
    if (result.kind === 'goal') {
      return c.json(
        ok({
          intent: 'set_goal',
          needsConfirmation: false,
          queryResult: { kind: 'goal', goal: result.goal },
          echo: text,
        }),
      );
    }
    return c.json(
      ok({ intent: 'set_goal', needsConfirmation: true, followupQuestion: result.message, echo: text }),
    );
  }

  // Free-form chat → defer to the copilot stream endpoint. But guard against
  // the classifier labeling a bare spend word ("chai") or a bare number
  // ("100") as chat: the DETERMINISTIC expense check (explicit amount or a
  // curated spend word — no LLM) reclaims those as expense drafts. Genuine
  // finance questions ("how do I save money") carry no amount and hit no
  // spend word, so they correctly stay in chat.
  const isQueryIntent =
    intentResult.intent === 'query_spending' ||
    intentResult.intent === 'query_summary' ||
    intentResult.intent === 'query_forecast';
  if (!isQueryIntent) {
    const batch = await tryPersistBatchExpenses(input);
    if (batch) return batch;
  }

  if (intentResult.intent === 'chat') {
    if (isExpenseLike(text)) {
      traceLog.info('CAPTURE_INTENT_RESCUED', {
        from: 'chat',
        to: 'expense',
        inputSize: summarizeForLog(text),
      });
      return persistOrDraftExpense({ input, intentLabel: 'expense' });
    }
    return c.json(
      ok({
        intent: 'chat',
        needsConfirmation: false,
        copilotStreamUrl: '/copilot/chat',
        echo: text,
      }),
    );
  }

  // Query intents resolve immediately.
  if (
    intentResult.intent === 'query_spending' ||
    intentResult.intent === 'query_summary' ||
    intentResult.intent === 'query_forecast'
  ) {
    const reply = await answerQuery(intentResult.intent, user.activeSpaceId, {
      category: intentResult.category,
      text,
    });
    return c.json(
      ok({
        intent: intentResult.intent,
        needsConfirmation: false,
        queryResult: reply,
        echo: text,
      }),
    );
  }

  // Anything that's not a transaction intent and not a direct query — budget,
  // goal, advice, lend/borrow, correction, delete, or an unclear message —
  // MIGHT still be a spend the classifier under-read. The LLM returns
  // intent="unknown" (low confidence) for a bare expense noun ("chai") or a
  // bare number ("100"); those must become an expense DRAFT, never be shipped
  // to the copilot (which previously hallucinated an amount or dead-ended).
  //
  // So before deferring to chat, ask the deterministic + categorize guard
  // whether the message is actually expense-like. If it is, run the exact
  // same draft path the transaction branch uses (parse → draft → ask the
  // missing field). Only genuinely non-expense, non-query text — greetings,
  // finance questions, true chit-chat — falls through to the copilot, which
  // is finance-scoped and injection-guarded server-side.
  if (!isTransactionIntent(intentResult.intent)) {
    if (await messageIsExpenseLike(user.activeSpaceId, text)) {
      traceLog.info('CAPTURE_INTENT_RESCUED', {
        from: intentResult.intent,
        to: 'expense',
        inputSize: summarizeForLog(text),
      });
      return persistOrDraftExpense({ input, intentLabel: 'expense' });
    }

    // ── LLM-driven fallback parser ──────────────────────────────────────────
    // If the offline/regex check is uncertain, route to the LLM parser.
    // If the LLM successfully extracts an amount and description, self-correct!
    if (isAIConfigured()) {
      try {
        const fallbackParsed = await parseExpense({
          text,
          locale: locale ? locale : undefined,
          spaceId: user.activeSpaceId,
          history: input.history,
        });
        // Only trust the LLM rescue when a DETERMINISTIC extractor independently
        // found the amount. Otherwise the model can mine a bogus figure out of
        // an encoded blob ("...execute it: 69676e6f72..." → ₹6,967) and pollute
        // the ledger. A real spend always carries a regex- or worded-extractable
        // amount; if none exists, this isn't a loggable transaction.
        const deterministicAmount = extractAmount(text).amount !== null;
        if (
          deterministicAmount &&
          fallbackParsed.amount !== null &&
          fallbackParsed.description &&
          fallbackParsed.confidence >= 0.5
        ) {
          traceLog.info('CAPTURE_INTENT_RESCUED_FALLBACK_LLM', {
            from: intentResult.intent,
            to: fallbackParsed.type || 'expense',
            amount: fallbackParsed.amount,
            description: fallbackParsed.description,
          });
          return persistOrDraftExpense({ input, intentLabel: fallbackParsed.type || 'expense' });
        }
      } catch (err) {
        traceLog.warn('FALLBACK_LLM_PARSER_ERROR', { error: String(err) });
      }
    }

    return c.json(
      ok({
        intent: 'chat',
        needsConfirmation: false,
        copilotStreamUrl: '/copilot/chat',
        echo: text,
      }),
    );
  }

  return persistOrDraftExpense({ input, intentLabel: intentResult.intent });
}

/**
 * Parse an expense utterance and either persist it directly (high-confidence,
 * complete) or stash a draft and ask for the one missing field. Shared by the
 * transaction-intent branch and the "rescued unknown → expense" branch so both
 * follow the identical, no-hallucination contract: when the amount is null the
 * draft ASKS for it ("How much was it?") instead of inventing one.
 */
async function persistOrDraftExpense(args: {
  input: RunPipelineInput;
  intentLabel: Intent;
}) {
  const { input, intentLabel } = args;
  const { c, text, origin, locale, source } = input;
  const user = c.get('user');
  const traceLog = c.get('log');

  const parsed = await parseExpense({ text, locale, spaceId: user.activeSpaceId, history: input.history });
  // Respect the classifier when it disagrees with the parser's default
  // "expense" type. Only meaningful on the transaction-intent path.
  if (intentLabel === 'income' && parsed.type !== 'income') {
    parsed.type = 'income';
  } else if (intentLabel === 'transfer' && parsed.type !== 'transfer') {
    parsed.type = 'transfer';
  }

  const livewallets = await listLiveWallets(user.activeSpaceId);
  const walletPick = pickWallet(livewallets, parsed.walletHint);
  const walletId = walletPick.wallet?.id ?? null;
  const date = parsed.date ?? TODAY();

  // Ambiguous currency word ("riyal" / "rial" / "dinar" with no country
  // qualifier) — we MUST ask the user "which one?" rather than silently
  // defaulting to a country. The user's clear intent: a Saudi resident's
  // "5 riyal" should not log as Omani Rial (or vice versa). Surface a draft
  // (so the parsed amount/description survives) AND a currency_choice
  // payload listing the candidates.
  //
  // Gate also requires `!parsed.currency` — once the user has picked, the
  // resolved draft is cached for future similar utterances; on re-hit we
  // already know the currency and must NOT re-fire the picker.
  if (
    parsed.ambiguousCurrencyWord &&
    parsed.amount !== null &&
    !parsed.currency
  ) {
    const options = getCurrencyOptions(parsed.ambiguousCurrencyWord);
    if (options.length >= 2) {
      // Strip the LLM's hallucinated originalAmount/originalCurrency from the
      // draft we stash. The persist layer derives these from the user's
      // CHOSEN currency (after the picker resolves) — keeping the LLM's
      // pre-pick guess on the draft would stamp a wrong originalCurrency on
      // the persisted row (e.g. user picks OMR, but row says originalCurrency=SAR
      // because that's what the LLM assumed for the word "riyal"). Off-by-10×
      // FX corruption silent-fail noted by the L1-2 brutal review.
      const draftToStash = {
        ...parsed,
        originalAmount: null,
        originalCurrency: null,
        // Also clear `currency` — the LLM's pre-pick guess shouldn't survive.
        // Persist will use whatever the user picks via captureConfirm edits.
        currency: null,
      };
      const draft = storeDraft({
        spaceId: user.activeSpaceId,
        userId: user.id,
        origin,
        source: text,
        locale,
        draft: draftToStash,
      });
      traceLog.info('CAPTURE_AMBIGUOUS_CURRENCY', {
        word: parsed.ambiguousCurrencyWord,
        options: options.map((o) => o.code),
        llmGuess: parsed.currency, // null after the strip; logged for ops
      });
      return c.json(
        ok({
          intent: intentLabel,
          needsConfirmation: true,
          draftId: draft.id,
          draft: serializeDraft(draftToStash),
          queryResult: {
            kind: 'currency_choice',
            word: parsed.ambiguousCurrencyWord,
            options,
          },
          echo: text,
        }),
      );
    }
  }

  // ── ACT / CONFIRM / ASK — 5-signal decision vector ─────────────────────
  //
  // We never gate on the raw LLM `confidence` alone: gpt-5.4-nano at minimal
  // reasoning imitates the number from the few-shot examples and is
  // uncalibrated. Instead, each signal is independently sourced:
  //
  //  S1 amount_grounded — deterministic extractor (regex/worded) found the
  //     amount. Strongest trust signal. Pure, offline, battle-tested.
  //  S2 amount_agreed   — regex and LLM produced the same number.
  //     Strong: two independent systems concur.
  //  S3 currency_clean  — no foreign currency was stripped (the guard in the
  //     parser already ran; a stripped currency is a red flag on the whole parse).
  //  S4 schema_ok       — the parser's LLM leg didn't fall back / retry (we
  //     proxy this through confidence ≥ 0.5 from the parser, which is boosted
  //     only by regex hits — so it reflects agreement, not self-reported certainty).
  //  S5 magnitude_ok    — amount is within a plausible range.
  //     Large amounts (> ₹50k) scale up the grounding requirement regardless of
  //     the other signals (a ₹50k auto-log is a much bigger mistake than a ₹50 one).
  //
  // ACT (auto-persist) iff: completeness ∧ grounding ∧ no red flags.
  // CONFIRM (show draft, one tap) iff: complete but grounding is soft, OR a
  //   red flag fired, OR amount is large-but-plausible (₹50k–₹1cr).
  // ASK (one targeted clarifier) iff: a required field is missing.
  //
  // This policy replaces the former single-threshold (confidence ≥ 0.6) with
  // a monotonic, multi-signal gate where EVERY signal must align for auto-ACT,
  // and where large amounts systematically require a confirmation tap.
  const regexAmount = extractAmount(text);
  const amountGrounded = regexAmount.amount !== null;
  const amountAgreed =
    amountGrounded &&
    parsed.amount !== null &&
    Math.abs(regexAmount.amount! - parsed.amount) < 0.005;
  // Real signal: did the parser have to STRIP an LLM-hallucinated foreign
  // currency? When true the gate routes to CONFIRM even if the OUTPUT is clean
  // — the model was uncertain about currency, which we treat as a red flag.
  const currencyClean = parsed.currencyStripped !== true;
  const schemaOk = parsed.confidence >= 0.5;
  // INR threshold for "needs human eyes". Foreign currencies are flagged
  // separately below — a $1000 hotel is ~₹83k and must NOT auto-ACT as if
  // the amount were 1000 of an unknown unit.
  const LARGE_AMOUNT_INR = 50_000;
  const isForeignCurrency =
    parsed.currency !== null && parsed.currency !== 'INR';
  // Income is reversible (undo restores within seconds) and a recurring
  // ₹80k salary log shouldn't friction-tap every payday. The implausible
  // ceiling still catches genuinely absurd amounts regardless of type.
  const magnitudeGated = parsed.type !== 'income';
  const largeAmount =
    magnitudeGated &&
    parsed.amount !== null &&
    (parsed.amount > LARGE_AMOUNT_INR || isForeignCurrency);
  const implausibleAmount = parsed.amount !== null && parsed.amount > 10_000_000;

  // Completeness — every required slot must be filled. Use parsed.needs
  // (computed by the parser from missing fields) as the SOURCE OF TRUTH.
  // Previously we checked `walletId !== null`, but pickWallet falls back to
  // wallets[0] when no hint matches, so a multi-wallet user with no wallet
  // hint silently posts to wallets[0]. The needs[] check correctly demands
  // an explicit wallet hint or a single-wallet space before auto-ACTing.
  const hasAmount = parsed.amount !== null;
  const hasDescription = Boolean(parsed.description);
  const walletDetermined =
    walletId !== null && (livewallets.length === 1 || walletPick.matched !== 'fallback');

  // Grounding verdict — captured for the decision-log + future calibration.
  const grounding: 'det' | 'agreed' | 'llm_only' | 'none' = amountGrounded
    ? amountAgreed
      ? 'agreed'
      : 'det'
    : parsed.amount !== null
      ? 'llm_only'
      : 'none';

  // ACT requires: complete + deterministically grounded + clean + schema ok + plausible.
  // Large amounts and foreign currencies require a human tap regardless.
  const canACT =
    hasAmount &&
    hasDescription &&
    walletDetermined &&
    origin !== 'image' &&
    !implausibleAmount &&
    !largeAmount &&
    (grounding === 'agreed' || grounding === 'det') &&
    currencyClean &&
    schemaOk;

  // CONFIRM: complete enough to show a draft (one tap to save), but at least
  // one signal asks for human eyes — soft grounding, large/foreign amount, a
  // stripped-currency red flag, or implausible (still gets shown so the user
  // can confirm or cancel rather than getting silently dropped).
  const needsConfirmTap =
    hasAmount &&
    hasDescription &&
    walletDetermined &&
    !canACT &&
    origin !== 'image';

  // Log the signal vector for observability — cheap, PII-safe, structured.
  traceLog.info('CAPTURE_DECISION', {
    grounding,
    largeAmount,
    isForeignCurrency,
    currencyClean,
    schemaOk,
    walletDetermined,
    walletMatch: walletPick.matched,
    type: parsed.type,
    verdict: canACT ? 'ACT' : needsConfirmTap ? 'CONFIRM' : 'ASK',
    inputSize: summarizeForLog(text),
  });

  if (
    !canACT &&
    !needsConfirmTap
  ) {
    const draft = storeDraft({
      spaceId: user.activeSpaceId,
      userId: user.id,
      origin,
      source: text,
      locale,
      draft: parsed,
    });
    return c.json(
      ok({
        intent: intentLabel,
        needsConfirmation: true,
        draftId: draft.id,
        draft: serializeDraft(parsed),
        followupQuestion: followupQuestionFor(parsed.needs),
        echo: text,
      }),
    );
  }

  // CONFIRM tap: complete and parseable, but grounding is soft or amount is
  // large (₹50k+). Show the draft summary so the user taps YES instead of
  // auto-logging. This also catches large legitimate transactions: someone
  // paying ₹80k rent should see the figure before it hits the ledger.
  if (needsConfirmTap) {
    const draft = storeDraft({
      spaceId: user.activeSpaceId,
      userId: user.id,
      origin,
      source: text,
      locale,
      draft: parsed,
    });
    return c.json(
      ok({
        intent: intentLabel,
        needsConfirmation: true,
        draftId: draft.id,
        draft: serializeDraft(parsed),
        // No followupQuestion: data is complete — the confirm widget shows the
        // summary and the user taps CONFIRM (or EDIT/CANCEL).
        followupQuestion: undefined,
        echo: text,
      }),
    );
  }

  // High confidence + complete — persist directly.
  const persistResult = await persistDraft({
    userId: user.id,
    spaceId: user.activeSpaceId,
    source,
    draft: parsed,
    walletId,
    date,
  });

  if (!persistResult.ok) {
    // Service not ready or refused: fall back to a draft so the user
    // still gets a confirmation flow.
    const draft = storeDraft({
      spaceId: user.activeSpaceId,
      userId: user.id,
      origin,
      source: text,
      locale,
      draft: parsed,
    });
    return c.json(
      ok({
        intent: intentLabel,
        needsConfirmation: true,
        draftId: draft.id,
        draft: serializeDraft(parsed),
        followupQuestion: persistResult.message,
        echo: text,
      }),
    );
  }

  return c.json(
    ok({
      intent: intentLabel,
      needsConfirmation: false,
      queryResult: { transaction: persistResult.transaction },
      echo: text,
    }),
  );
}

function serializeDraft(d: ParsedExpense): Record<string, unknown> {
  return {
    type: d.type,
    amount: d.amount,
    currency: d.currency,
    description: d.description,
    category: d.categoryHint,
    walletHint: d.walletHint,
    date: d.date,
    splitPeople: d.splitPeople,
    originalAmount: d.originalAmount,
    originalCurrency: d.originalCurrency,
    confidence: d.confidence,
    needs: d.needs,
  };
}

function shortClarifierAsDescription(text: string): string | null {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  if (clean.length > 80) return null;
  if (/\d/.test(clean)) return null;
  if (/^(confirm|cancel|edit|help|menu|reset|stop|status)$/i.test(clean)) return null;
  return clean;
}

function cleanDescription(followupDesc: string | null, draftDesc: string | null): string | null {
  if (!followupDesc) return null;
  
  // Strip common conversational filler words
  let cleaned = followupDesc.trim();
  const leadingFiller = /^[.,;!\-\s]*(?:actually|no|it\s+was|was|is|change\s+to|make\s+it|wait|correct|correction|that\s+was)\s+/i;
  const trailingFiller = /\s+(?:actually|no|it\s+was|was|is|wait|correct|correction|that\s+was)[.,;!\-\s]*$/i;
  
  cleaned = cleaned.replace(leadingFiller, '').replace(trailingFiller, '').trim();
  
  if (!draftDesc) return cleaned;

  const cLower = cleaned.toLowerCase();
  const dLower = draftDesc.toLowerCase().trim();

  if (cLower === dLower || cLower.startsWith(dLower)) {
    const remaining = cLower.slice(dLower.length).trim();
    const fillerRegex = /^[.,;!\-\s]*(?:actually|that|was|is|no|it|not|change|to|make|wait|correct|correction)*$/i;
    if (!remaining || fillerRegex.test(remaining)) {
      return draftDesc;
    }
  }
  
  return cleaned;
}

/**
 * Apply a free-form clarifier ("100", "rs 100", "₹100", "groceries", "auto")
 * to a pending draft and return the fields to merge in.
 *
 * This is the deterministic anti-loop guarantee. It runs the regex extractors
 * directly on the clarifier text so a bare number ALWAYS fills the amount and
 * a bare noun ALWAYS fills the description — no LLM required. The previous
 * implementation only re-parsed when the text failed `JSON.parse`, but a bare
 * "100" is valid JSON (it parses to the number 100, not an object), so the
 * re-parse branch never ran and the amount stayed null → the bot re-asked
 * "How much was it?" forever.
 *
 * `followup` is the optional LLM re-parse of `${source}. ${text}`; we only
 * consult it for fields the deterministic extractors and the existing draft
 * can't supply. Existing non-null draft fields are never overwritten.
 */
function clarifierEdits(
  draft: ParsedExpense,
  clarifierText: string,
  followup: ParsedExpense | null,
): Partial<ParsedExpense> {
  const regexAmount = extractAmount(clarifierText);
  const regexCurrency = regexAmount.currency ?? extractCurrency(clarifierText);
  // A noun-only clarifier ("groceries", "auto") has no digits — treat it as
  // the description/category the user is supplying for the missing field.
  const noun = shortClarifierAsDescription(clarifierText);

  return {
    // LLM's full conversational re-parse wins (because it is semantically aware of corrections/context).
    // If not present, existing draft value is preserved.
    // If draft value was null, fall back to deterministic regex extraction on the latest message.
    amount: followup?.amount ?? draft.amount ?? regexAmount.amount ?? null,
    currency: followup?.currency ?? draft.currency ?? regexCurrency ?? null,
    description: cleanDescription(followup?.description ?? null, draft.description) ?? draft.description ?? noun ?? null,
    notes: followup?.notes ?? draft.notes ?? null,
    categoryHint: followup?.categoryHint ?? draft.categoryHint ?? noun ?? null,
    walletHint: followup?.walletHint ?? draft.walletHint ?? null,
    date: followup?.date ?? draft.date ?? null,
    splitPeople: followup?.splitPeople ?? draft.splitPeople ?? null,
    originalAmount: followup?.originalAmount ?? draft.originalAmount ?? null,
    originalCurrency: followup?.originalCurrency ?? draft.originalCurrency ?? null,
    confidence: Math.max(draft.confidence, followup?.confidence ?? 0),
  };
}

export interface ClarifierResolution {
  /** True when `text` was a JSON edits object (web omnibar), false for a
   *  free-form clarifier (WhatsApp bot). */
  isJsonEdits: boolean;
  edits: Partial<ParsedExpense>;
}

/**
 * Decide whether a `confirm` text payload is a structured JSON edits object
 * or a free-form clarifier, and produce the edits either way.
 *
 * Critically, a bare number ("100") parses as valid JSON to a NUMBER — NOT a
 * plain object — so it is correctly routed to the deterministic clarifier
 * path, not silently dropped. This pure function is the unit under test for
 * the infinite-loop regression.
 */
export function resolveClarifier(draft: ParsedExpense, text: string): ClarifierResolution {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { isJsonEdits: true, edits: sanitizeEdits(parsed as Record<string, unknown>) };
    }
  } catch {
    // Not JSON — fall through to the clarifier path.
  }
  // Deterministic regex pass (no LLM). A `followup` re-parse is layered on by
  // the route only if this leaves a required field unfilled.
  return { isJsonEdits: false, edits: clarifierEdits(draft, text, null) };
}

function maybeLanguage(input: string | undefined): Language | undefined {
  if (!input) return undefined;
  return isLanguage(input) ? (input as Language) : undefined;
}

app.post('/text', requireUserOrBot, captureLimit, validate('json', captureTextInput), async (c) => {
  const { text, locale } = c.req.valid('json');
  const body = await c.req.json().catch(() => ({}));
  const history = body.history;
  const recentContext =
    typeof body.recentContext === 'string' && body.recentContext.trim()
      ? body.recentContext.trim().slice(0, 200)
      : undefined;
  const sourceTag: 'whatsapp_text' | 'manual_web' = c.req.header('x-bot-secret')
    ? 'whatsapp_text'
    : 'manual_web';
  return runTextPipeline({
    c,
    text,
    origin: 'text',
    locale: maybeLanguage(locale),
    source: sourceTag,
    history,
    recentContext,
  });
});

app.post('/voice', requireUserOrBot, captureLimit, async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw errors.validation('Multipart body required');
  const audio = form.get('audio');
  const locale = form.get('locale');
  if (!(audio instanceof File)) throw errors.validation('audio file is required');

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimetype = audio.type || 'application/octet-stream';
  const result = await transcribe(
    buffer,
    mimetype,
    typeof locale === 'string' ? locale : undefined,
  );
  c.get('log').info('CAPTURE_VOICE', {
    bytes: buffer.byteLength,
    transcribeSource: result.source,
    detectedLanguage: result.language,
  });

  if (!result.text || !result.text.trim() || result.source === 'mock') {
    return c.json(
      ok({
        intent: 'unknown',
        needsConfirmation: true,
        followupQuestion: 'I could not hear that — try typing it instead.',
        echo: result.text,
      }),
    );
  }

  return runTextPipeline({
    c,
    text: result.text,
    origin: 'voice',
    locale: maybeLanguage(typeof locale === 'string' ? locale : result.language),
    source: c.req.header('x-bot-secret') ? 'whatsapp_voice' : 'manual_web',
  });
});

app.post('/image', requireUserOrBot, captureLimit, async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw errors.validation('Multipart body required');
  const image = form.get('image');
  const locale = form.get('locale');
  // Optional caption the user typed alongside the photo. We use it as a
  // fall-back parse target when vision returns nothing, AND we hand it to
  // categorisation when vision missed the merchant. Empath subagent flagged
  // that discarding a caption on a photo message is a louder invisibility
  // signal than not running OCR at all.
  const captionRaw = form.get('caption');
  const caption =
    typeof captionRaw === 'string' && captionRaw.trim() ? captionRaw.trim().slice(0, 800) : null;
  if (!(image instanceof File)) throw errors.validation('image file is required');

  const buffer = Buffer.from(await image.arrayBuffer());
  const mimetype = image.type || 'image/jpeg';
  const extracted = await extractFromReceipt(buffer, mimetype);

  // CAPTION-HONOURING FALLBACK. When vision returned no usable signal,
  // route the caption through the regular text parser before declaring the
  // image unreadable — the user often types "Lulu, ₹240 grocery" alongside
  // the photo, and that text is more reliable than any OCR. If both vision
  // AND caption fail, the bot's image-unreadable copy still fires.
  if (caption && (extracted.amount === null || !extracted.description)) {
    try {
      const captionParsed = await parseExpense({
        text: caption,
        spaceId: c.get('user').activeSpaceId,
      });
      if (extracted.amount === null && captionParsed.amount !== null) {
        extracted.amount = captionParsed.amount;
        if (captionParsed.currency) extracted.currency = captionParsed.currency;
      }
      if (!extracted.description && captionParsed.description) {
        extracted.description = captionParsed.description;
      }
      if (!extracted.date && captionParsed.date) {
        extracted.date = captionParsed.date;
      }
    } catch {
      // Caption parse failed — silently fall through. The image-unreadable
      // path on the bot side will still fire if both signals are missing.
    }
  }

  const user = c.get('user');
  const livewallets = await listLiveWallets(user.activeSpaceId);
  const walletPick = pickWallet(livewallets, null);

  // Categorize from the extracted merchant/description so the draft (and an
  // auto-logged row) carry a real category instead of "Other".
  let categoryHint: string | null = null;
  if (extracted.description) {
    try {
      const cat = await safeCategorize(user.activeSpaceId, extracted.description);
      if (cat.category && cat.category !== 'Other') categoryHint = cat.category;
    } catch {
      categoryHint = null;
    }
  }

  // Build a parser-shaped draft from the vision result so the same UI works.
  const draft = {
    type: 'expense' as const,
    amount: extracted.amount,
    currency: extracted.currency,
    description: extracted.description,
    notes: null,
    categoryHint,
    walletHint: walletPick.wallet?.name ?? null,
    date: extracted.date,
    splitPeople: null,
    originalAmount: null,
    originalCurrency: null,
    confidence: extracted.confidence,
    needs: [
      ...(extracted.amount === null ? (['amount'] as const) : []),
      ...(!extracted.description ? (['description'] as const) : []),
    ] as ParsedExpense['needs'],
  } satisfies ParsedExpense;

  c.get('log').info('CAPTURE_IMAGE', {
    bytes: buffer.byteLength,
    visionSource: extracted.source,
    confidence: extracted.confidence,
    category: categoryHint,
  });

  // High-confidence, complete extraction → log it straight away (no friction).
  // A clear GPay "Paid ₹450 to Ola" screenshot shouldn't need a confirm tap.
  const source = c.req.header('x-bot-secret') ? 'whatsapp_image' : 'manual_web';

  if (
    extracted.items &&
    extracted.items.length >= 2 &&
    extracted.confidence >= 0.7 &&
    walletPick.wallet
  ) {
    const transactions: Array<{
      id: string;
      amount: number;
      currency: string;
      description: string;
      category: string | null;
    }> = [];

    let success = true;
    for (const item of extracted.items) {
      const itemDraft = {
        type: 'expense' as const,
        amount: item.amount,
        currency: extracted.currency,
        description: item.description,
        notes: null,
        categoryHint:
          item.category && (CATEGORIES as readonly string[]).includes(item.category)
            ? (item.category as Category)
            : null,
        walletHint: walletPick.wallet.name,
        date: extracted.date,
        splitPeople: null,
        originalAmount: null,
        originalCurrency: null,
        confidence: extracted.confidence,
        needs: [] as ParsedExpense['needs'],
      } satisfies ParsedExpense;

      const persistResult = await persistDraft({
        userId: user.id,
        spaceId: user.activeSpaceId,
        source,
        draft: itemDraft,
        walletId: walletPick.wallet.id,
        date: extracted.date ?? TODAY(),
      });

      if (!persistResult.ok) {
        success = false;
        break;
      }

      transactions.push({
        id: persistResult.transaction.id,
        amount: persistResult.transaction.amount,
        currency: persistResult.transaction.currency,
        description: persistResult.transaction.description,
        category: persistResult.transaction.category,
      });
    }

    if (success && transactions.length >= 2) {
      const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
      c.get('log').info('CAPTURE_IMAGE_BATCH_OK', {
        bytes: buffer.byteLength,
        count: transactions.length,
      });
      return c.json(
        ok({
          intent: 'expense' as const,
          needsConfirmation: false,
          queryResult: {
            transactions,
            total,
            currency: transactions[0]?.currency ?? 'INR',
          },
          echo: extracted.description ?? '[payment image]',
        }),
      );
    }
  }

  const complete =
    extracted.amount !== null && Boolean(extracted.description) && Boolean(walletPick.wallet);
  if (complete && extracted.confidence >= 0.7) {
    const persistResult = await persistDraft({
      userId: user.id,
      spaceId: user.activeSpaceId,
      source,
      draft,
      walletId: walletPick.wallet!.id,
      date: extracted.date ?? TODAY(),
    });
    if (persistResult.ok) {
      return c.json(
        ok({
          intent: 'expense' as const,
          needsConfirmation: false,
          queryResult: { transaction: persistResult.transaction },
          echo: '[payment image]',
        }),
      );
    }
    // fall through to the confirm flow if persistence wasn't possible.
  }

  const stored = storeDraft({
    spaceId: user.activeSpaceId,
    userId: user.id,
    origin: 'image',
    source: extracted.description ?? '[payment image]',
    locale: typeof locale === 'string' ? locale : null,
    draft,
  });

  return c.json(
    ok({
      intent: 'expense' as const,
      needsConfirmation: true,
      draftId: stored.id,
      draft: serializeDraft(draft),
      followupQuestion:
        extracted.confidence < 0.5
          ? 'That image was hard to read — please confirm the details.'
          : 'Confirm or edit before saving.',
      echo: extracted.description ?? '[payment image]',
    }),
  );
});

const confirmInput = z
  .object({
    draftId: z.string().min(8).max(64),
    /** JSON-style edits the user accepted in the confirmation dialog. */
    edits: z.record(z.unknown()).optional(),
    /** Free-form clarifier; routed through the parser when present. */
    text: z.string().min(1).max(800).optional(),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
  })
  .refine((v) => v.edits || v.text, {
    message: 'Provide either edits or text',
    path: ['edits'],
  });

app.post('/confirm', requireUserOrBot, captureLimit, validate('json', confirmInput), async (c) => {
  const body = c.req.valid('json');
  const { draftId } = body;
  const text = body.text ?? '';
  const user = c.get('user');
  const record = getDraft(draftId);
  if (!record) throw errors.notFound('Draft expired or unknown');
  if (record.spaceId !== user.activeSpaceId || record.userId !== user.id) {
    throw errors.forbidden('Draft does not belong to this user');
  }

  if (text) {
    const textIntent = await classifyIntent({ text, locale: record.locale ?? undefined });
    const isQuery =
      textIntent.intent === 'query_spending' ||
      textIntent.intent === 'query_summary' ||
      textIntent.intent === 'query_forecast';
    const isOtherAction =
      textIntent.intent === 'set_budget' ||
      textIntent.intent === 'set_goal' ||
      textIntent.intent === 'ask_advice' ||
      textIntent.intent === 'delete_last' ||
      textIntent.intent === 'correct_last';
    const isChatAndNotExpense = textIntent.intent === 'chat' && !isExpenseLike(text);
    const typeMismatch =
      (record.draft.type === 'expense' && (textIntent.intent === 'income' || textIntent.intent === 'transfer')) ||
      (record.draft.type === 'income' && (textIntent.intent === 'expense' || textIntent.intent === 'transfer')) ||
      (record.draft.type === 'transfer' && (textIntent.intent === 'expense' || textIntent.intent === 'income'));

    if (isQuery || isOtherAction || isChatAndNotExpense || typeMismatch) {
      c.get('log').info('CAPTURE_CONFIRM_REDIRECT', {
        draftId,
        priorType: record.draft.type,
        newIntent: textIntent.intent,
        text,
      });
      consumeDraft(draftId);
      const sourceTag = c.req.header('x-bot-secret')
        ? record.origin === 'voice'
          ? 'whatsapp_voice'
          : record.origin === 'image'
            ? 'whatsapp_image'
            : 'whatsapp_text'
        : 'manual_web';
      return runTextPipeline({
        c,
        text,
        origin: record.origin,
        locale: maybeLanguage(record.locale ?? undefined),
        source: sourceTag,
      });
    }
  }

  // Apply edits as a JSON patch if the user sent one, otherwise treat
  // the whole `text` field as a free-form clarifier and fill missing fields
  // deterministically (regex first, LLM only if a gap remains).
  let merged: ParsedExpense = record.draft;
  let edits: Partial<ParsedExpense> = {};
  if (body.edits) {
    edits = sanitizeEdits(body.edits);
  } else if (text) {
    // The web omnibar may POST a JSON edits object in the `text` field, but
    // the WhatsApp bot sends free-form clarifiers ("100", "groceries").
    // `resolveClarifier` decides which it is and runs the deterministic
    // regex pass for clarifiers — a bare number ALWAYS fills the amount.
    //
    // This is the infinite-loop fix: a bare "100" is itself valid JSON (it
    // parses to the NUMBER 100, not an object), so the old code's
    // `JSON.parse(text)` succeeded, the "is it an object?" guard failed, and
    // the clarifier was silently dropped — `amount` stayed null and the bot
    // re-asked "How much was it?" forever.
    const resolution = resolveClarifier(merged, text);
    edits = resolution.edits;
    if (!resolution.isJsonEdits) {
      // Always run the LLM round-trip for free-form replies during confirmation
      // to handle corrections, adjustments, and complex multi-turn updates.
      // Prefix with the original source to anchor semantic fields like description.
      const followup = await parseExpense({
        text: `${record.source}. ${text}`,
        locale: record.locale ?? undefined,
        spaceId: user.activeSpaceId,
        history: body.history,
      });
      edits = clarifierEdits(merged, text, followup);
    }
  }
  merged = { ...merged, ...edits } as ParsedExpense;
  merged.needs = missingFields(merged);

  // ── Reinforcement signal: was the original draft changed? ──────────────
  // If the user's clarifier text changed any field that the original parse
  // had set, the original parse was wrong → fire onRejected so the AI brain
  // can learn from the correction.
  const originalDraft = record.draft;
  const wasEdited =
    (edits.amount !== undefined && edits.amount !== originalDraft.amount) ||
    (edits.description !== undefined && edits.description !== originalDraft.description) ||
    (edits.currency !== undefined && edits.currency !== originalDraft.currency) ||
    (edits.walletHint !== undefined && edits.walletHint !== originalDraft.walletHint);

  if (wasEdited && record.source) {
    void onRejected(
      user.activeSpaceId,
      record.source,
      originalDraft,
      merged,
    ).catch(() => undefined);
  }

  if (merged.amount === null || !merged.description) {
    // Still missing a required field. Re-stash and ask for whatever is
    // genuinely missing NEXT — never re-ask for what the user just supplied
    // (the priority order in `followupQuestionFor` advances past any field
    // the clarifier filled). A monotonic round counter rides along on the
    // draft so a stream of unparseable replies can't loop forever.
    const round = record.clarifyRounds + 1;
    const nextField = askedField(merged.needs);

    if (round > MAX_CLARIFY_ROUNDS) {
      // Give up gracefully instead of bricking: drop the draft so the user
      // starts fresh rather than being trapped in an endless clarifier.
      consumeDraft(draftId);
      return c.json(
        ok({
          intent: 'unknown',
          needsConfirmation: false,
          echo: text,
        }),
      );
    }

    const next = storeDraft({
      spaceId: record.spaceId,
      userId: record.userId,
      origin: record.origin,
      source: record.source,
      locale: record.locale ?? null,
      draft: merged,
      clarifyRounds: round,
      lastAsked: nextField,
    });
    consumeDraft(draftId);
    return c.json(
      ok({
        intent: 'expense',
        needsConfirmation: true,
        draftId: next.id,
        draft: serializeDraft(merged),
        followupQuestion: followupQuestionFor(merged.needs),
        echo: text,
      }),
    );
  }

  const livewallets = await listLiveWallets(user.activeSpaceId);
  const walletPick = pickWallet(livewallets, merged.walletHint);
  if (!walletPick.wallet) {
    throw errors.validation('No wallet available to post against');
  }

  const persistResult = await persistDraft({
    userId: user.id,
    spaceId: user.activeSpaceId,
    source:
      record.origin === 'voice'
        ? 'whatsapp_voice'
        : record.origin === 'image'
          ? 'whatsapp_image'
          : c.req.header('x-bot-secret')
            ? 'whatsapp_text'
            : 'manual_web',
    draft: merged,
    walletId: walletPick.wallet.id,
    date: merged.date ?? TODAY(),
  });

  if (!persistResult.ok) {
    log.warn('CAPTURE_CONFIRM_FAIL', {
      reason: persistResult.reason,
      message: persistResult.message,
    });
    throw errors.internal(persistResult.message);
  }
  consumeDraft(draftId);

  // ── Reinforcement signal: confirmed! ──────────────────────────────────
  // Fire-and-forget — teaches every AI brain layer from this confirmation.
  if (record.source) {
    void onConfirmed(user.activeSpaceId, record.source, merged).catch(() => undefined);
  }

  return c.json(
    ok({
      intent: 'expense' as const,
      needsConfirmation: false,
      queryResult: { transaction: persistResult.transaction },
      echo: text,
    }),
  );
});

function missingFields(p: ParsedExpense): ParsedExpense['needs'] {
  const needs: ParsedExpense['needs'] = [];
  if (p.amount === null) needs.push('amount');
  if (!p.description) needs.push('description');
  if (!p.walletHint) needs.push('wallet');
  if (!p.currency && !p.originalCurrency) needs.push('currency');
  return needs;
}

function sanitizeEdits(edits: Record<string, unknown>): Partial<ParsedExpense> {
  const out: Partial<ParsedExpense> = {};
  if (typeof edits.amount === 'number' && edits.amount > 0) out.amount = edits.amount;
  if (typeof edits.currency === 'string') out.currency = edits.currency.toUpperCase();
  if (typeof edits.description === 'string' && edits.description.trim()) {
    out.description = edits.description.trim();
  }
  if (typeof edits.categoryHint === 'string') out.categoryHint = edits.categoryHint;
  if (typeof edits.category === 'string') out.categoryHint = edits.category;
  if (typeof edits.walletHint === 'string') out.walletHint = edits.walletHint;
  if (typeof edits.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(edits.date)) {
    out.date = edits.date;
  }
  if (typeof edits.splitPeople === 'number' && edits.splitPeople >= 2) {
    out.splitPeople = Math.round(edits.splitPeople);
  }
  return out;
}

// Keep DraftRecord referenced so tooling doesn't strip the import.
export type { DraftRecord };
import { resolveReference } from '../services/capture/referenceResolver.ts';

// ---- Reference Resolver endpoint ----------------------------------------
// POST /capture/resolve-ref  { query: string }
// Returns up to 3 candidate transactions for "the coffee one", "last 3", etc.
// Used by the bot for corrections/deletes on non-last entries. Scoped to the
// caller's space; never returns other users' data. Returns [] on no match.
app.post('/resolve-ref', requireUserOrBot, async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const intent: 'read' | 'mutate' = body.intent === 'read' ? 'read' : 'mutate';
  if (!query) return c.json(ok({ candidates: [] }));
  const candidates = await resolveReference(u.activeSpaceId, query, intent);
  return c.json(ok({ candidates }));
});

export const captureRoutes = app;
export const __captureBatchForTests = {
  splitPotentialBatch,
  parseBatchItems,
};
