import {
  CATEGORIES,
  type Category,
  type Intent,
  type Language,
  isLanguage,
  isTransactionIntent,
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
import { isAIConfigured } from '../services/ai/client.ts';
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
}

interface ParsedBatchItem {
  sourceText: string;
  draft: ParsedExpense;
}

function splitPotentialBatch(text: string): string[] {
  return text
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
  const modelBatch = await parseExpenseBatch({ text, locale, spaceId });
  if (modelBatch && modelBatch.items.length >= 2) {
    const items = modelBatch.items
      .filter((draft) => draft.amount !== null && Boolean(draft.description))
      .map((draft) => ({ sourceText: draft.description ?? text, draft }));
    if (items.length >= 2) return items;
  }

  const parts = splitPotentialBatch(text);
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

async function runTextPipeline(input: RunPipelineInput) {
  const { c, text, origin, locale } = input;
  const user = c.get('user');
  const traceLog = c.get('log');

  const intentResult = await classifyIntent({ text, locale });
  traceLog.info('CAPTURE_INTENT', {
    origin,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    sourceType: intentResult.source,
    inputSize: summarizeForLog(text),
  });

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
        if (fallbackParsed.amount !== null && fallbackParsed.description && fallbackParsed.confidence >= 0.5) {
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

  const enoughConfidence = parsed.confidence >= 0.6;
  const hasAmount = parsed.amount !== null;
  const hasDescription = Boolean(parsed.description);

  if (!enoughConfidence || !hasAmount || !hasDescription || !walletId || origin === 'image') {
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
    // Regex wins on amount/currency; only fall back to the LLM when the
    // deterministic pass found nothing.
    amount: draft.amount ?? regexAmount.amount ?? followup?.amount ?? null,
    currency: draft.currency ?? regexCurrency ?? followup?.currency ?? null,
    description: draft.description ?? noun ?? followup?.description ?? null,
    categoryHint: draft.categoryHint ?? followup?.categoryHint ?? noun ?? null,
    walletHint: draft.walletHint ?? followup?.walletHint ?? null,
    date: draft.date ?? followup?.date ?? null,
    splitPeople: draft.splitPeople ?? followup?.splitPeople ?? null,
    originalAmount: draft.originalAmount ?? followup?.originalAmount ?? null,
    originalCurrency: draft.originalCurrency ?? followup?.originalCurrency ?? null,
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
  if (!(image instanceof File)) throw errors.validation('image file is required');

  const buffer = Buffer.from(await image.arrayBuffer());
  const mimetype = image.type || 'image/jpeg';
  const extracted = await extractFromReceipt(buffer, mimetype);

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
      const afterDeterministic = { ...merged, ...edits } as ParsedExpense;
      const stillMissing = afterDeterministic.amount === null || !afterDeterministic.description;
      // Only spend an LLM round-trip when the deterministic pass left a gap
      // (e.g. a wordy clarifier whose description the regex can't see).
      if (stillMissing) {
        const followup = await parseExpense({
          text: `${record.source}. ${text}`,
          locale: record.locale ?? undefined,
          spaceId: user.activeSpaceId,
          history: body.history,
        });
        edits = clarifierEdits(merged, text, followup);
      }
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
export const captureRoutes = app;
export const __captureBatchForTests = {
  splitPotentialBatch,
  parseBatchItems,
};
