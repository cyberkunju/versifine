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
import { isLanguage, isTransactionIntent, type Language } from '@versifine/shared';
import { captureTextInput } from '@versifine/shared';
import { requireUserOrBot } from '../middleware/authEither.ts';
import { limits, rateLimit } from '../middleware/rateLimit.ts';
import { validate } from '../middleware/validate.ts';
import { classifyIntent } from '../services/ai/intent.ts';
import { parseExpense, type ParsedExpense } from '../services/ai/parser.ts';
import { transcribe } from '../services/ai/transcribe.ts';
import { extractFromReceipt } from '../services/ai/vision.ts';
import { storeDraft, getDraft, consumeDraft, type DraftRecord } from '../services/capture/drafts.ts';
import { persistDraft } from '../services/capture/persist.ts';
import { answerQuery } from '../services/capture/queryStubs.ts';
import { listLiveWallets, pickWallet } from '../services/capture/wallet.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';

const app = new Hono();

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

function followupQuestionFor(needs: ParsedExpense['needs']): string | undefined {
  if (needs.length === 0) return undefined;
  if (needs.includes('amount')) return 'How much was it?';
  if (needs.includes('description')) return 'What did you spend it on?';
  if (needs.includes('wallet')) return 'Which wallet did you use?';
  if (needs.includes('currency')) return 'Which currency was that?';
  return undefined;
}

interface RunPipelineInput {
  c: import('hono').Context;
  text: string;
  origin: 'text' | 'voice' | 'image';
  locale: Language | undefined;
  source: 'whatsapp_text' | 'whatsapp_voice' | 'whatsapp_image' | 'manual_web';
}

async function runTextPipeline(input: RunPipelineInput) {
  const { c, text, origin, locale, source } = input;
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

  // Free-form chat → defer to the copilot stream endpoint.
  if (intentResult.intent === 'chat') {
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

  // Anything that's not a transaction intent → respond with the unknown
  // shape so the client can prompt the user.
  if (!isTransactionIntent(intentResult.intent)) {
    return c.json(
      ok({
        intent: intentResult.intent,
        needsConfirmation: true,
        followupQuestion: 'Could you rephrase that as an expense, income, or transfer?',
        echo: text,
      }),
    );
  }

  // Transaction intent: parse the details.
  const parsed = await parseExpense({ text, locale });
  // Override the parser's default "expense" type with the intent classifier
  // when the latter said "income" — rare but worth respecting.
  if (intentResult.intent === 'income' && parsed.type !== 'income') {
    parsed.type = 'income';
  } else if (intentResult.intent === 'transfer' && parsed.type !== 'transfer') {
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
        intent: intentResult.intent,
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
        intent: intentResult.intent,
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
      intent: intentResult.intent,
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

function maybeLanguage(input: string | undefined): Language | undefined {
  if (!input) return undefined;
  return isLanguage(input) ? (input as Language) : undefined;
}

app.post(
  '/text',
  requireUserOrBot,
  captureLimit,
  validate('json', captureTextInput),
  async (c) => {
    const { text, locale } = c.req.valid('json');
    const sourceTag: 'whatsapp_text' | 'manual_web' = c.req.header('x-bot-secret')
      ? 'whatsapp_text'
      : 'manual_web';
    return runTextPipeline({
      c,
      text,
      origin: 'text',
      locale: maybeLanguage(locale),
      source: sourceTag,
    });
  },
);

app.post('/voice', requireUserOrBot, captureLimit, async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw errors.validation('Multipart body required');
  const audio = form.get('audio');
  const locale = form.get('locale');
  if (!(audio instanceof File)) throw errors.validation('audio file is required');

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimetype = audio.type || 'application/octet-stream';
  const result = await transcribe(buffer, mimetype, typeof locale === 'string' ? locale : undefined);
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

  // Build a parser-shaped draft from the vision result so the same UI works.
  const draft = {
    type: 'expense' as const,
    amount: extracted.amount,
    currency: extracted.currency,
    description: extracted.description,
    categoryHint: null,
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

  const stored = storeDraft({
    spaceId: user.activeSpaceId,
    userId: user.id,
    origin: 'image',
    source: '[receipt photo]',
    locale: typeof locale === 'string' ? locale : null,
    draft,
  });

  c.get('log').info('CAPTURE_IMAGE', {
    bytes: buffer.byteLength,
    visionSource: extracted.source,
    confidence: extracted.confidence,
  });

  return c.json(
    ok({
      intent: 'expense' as const,
      needsConfirmation: true,
      draftId: stored.id,
      draft: serializeDraft(draft),
      followupQuestion:
        extracted.confidence < 0.5
          ? 'Receipt was hard to read — please confirm the details.'
          : 'Confirm or edit the receipt before saving.',
      echo: '[receipt photo]',
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
  })
  .refine((v) => v.edits || v.text, {
    message: 'Provide either edits or text',
    path: ['edits'],
  });

app.post(
  '/confirm',
  requireUserOrBot,
  captureLimit,
  validate('json', confirmInput),
  async (c) => {
    const body = c.req.valid('json');
    const { draftId } = body;
    const text = body.text ?? '';
    const user = c.get('user');
    const record = getDraft(draftId);
    if (!record) throw errors.notFound('Draft expired or unknown');
    if (record.spaceId !== user.activeSpaceId || record.userId !== user.id) {
      throw errors.forbidden('Draft does not belong to this user');
    }

    // Apply edits as a JSON patch if the user sent one, otherwise treat
    // the whole `text` field as a new clarifier and re-run the parser.
    let merged: ParsedExpense = record.draft;
    let edits: Partial<ParsedExpense> = {};
    if (body.edits) {
      edits = sanitizeEdits(body.edits);
    } else if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          edits = sanitizeEdits(parsed as Record<string, unknown>);
        }
      } catch {
        // Not JSON — re-parse to fill missing fields. We keep the originals
        // for fields the user already had and only replace nulls.
        const followup = await parseExpense({
          text: `${record.source}. ${text}`,
          locale: record.locale ?? undefined,
        });
        const clarifierDescription = shortClarifierAsDescription(text);
        edits = {
          amount: merged.amount ?? followup.amount,
          currency: merged.currency ?? followup.currency,
          description: merged.description ?? clarifierDescription ?? followup.description,
          categoryHint: merged.categoryHint ?? followup.categoryHint ?? clarifierDescription,
          walletHint: merged.walletHint ?? followup.walletHint,
          date: merged.date ?? followup.date,
          splitPeople: merged.splitPeople ?? followup.splitPeople,
          originalAmount: merged.originalAmount ?? followup.originalAmount,
          originalCurrency: merged.originalCurrency ?? followup.originalCurrency,
          confidence: Math.max(merged.confidence, followup.confidence),
        };
      }
    }
    merged = { ...merged, ...edits } as ParsedExpense;
    merged.needs = missingFields(merged);

    if (merged.amount === null || !merged.description) {
      // Still missing — re-stash and ask again.
      const next = storeDraft({
        spaceId: record.spaceId,
        userId: record.userId,
        origin: record.origin,
        source: record.source,
        locale: record.locale ?? null,
        draft: merged,
      });
      consumeDraft(draftId);
      return c.json(
        ok({
          intent: 'expense',
          needsConfirmation: true,
          draftId: next.id,
          draft: serializeDraft(merged),
          followupQuestion: followupQuestionFor(missingFields(merged)),
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
      source: record.origin === 'voice'
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

    return c.json(
      ok({
        intent: 'expense' as const,
        needsConfirmation: false,
        queryResult: { transaction: persistResult.transaction },
        echo: text,
      }),
    );
  },
);

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
