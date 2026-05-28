/**
 * Receipt vision. Sends the bytes to gpt-4o with a tight schema-matching
 * prompt and asks for a structured JSON envelope.
 *
 * STRICT NULL RULE: every field the model is unsure about must be null.
 * The system asks one clarifying question instead of fabricating dates
 * or amounts. The Zod parser below enforces this — anything that isn't
 * a positive number or a valid YYYY-MM-DD date is coerced to null.
 */
import { z } from 'zod';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';

export interface ReceiptExtraction {
  amount: number | null;
  currency: string | null;
  description: string | null;
  date: string | null;
  confidence: number;
  source: 'gpt-4o' | 'mock';
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const visionSchema = z
  .object({
    amount: z
      .union([z.number(), z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      }),
    currency: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (!v) return null;
        const trimmed = v.trim().toUpperCase();
        return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
      }),
    description: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (!v) return null;
        const trimmed = v.trim();
        return trimmed ? trimmed.slice(0, 240) : null;
      }),
    date: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (!v) return null;
        const trimmed = v.trim();
        return ISO_DATE_RE.test(trimmed) ? trimmed : null;
      }),
    confidence: z
      .union([z.number(), z.string()])
      .optional()
      .transform((v) => {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) return 0.5;
        return Math.min(1, Math.max(0, n));
      }),
  })
  .passthrough();

const SYSTEM_PROMPT = `You read a single receipt photograph and extract a structured record.

Return JSON with these keys, no commentary:
{
  "amount": positive number or null,
  "currency": ISO 4217 alpha-3 code (e.g. INR, USD) or null,
  "description": one short line that names the merchant and what was bought, or null,
  "date": "YYYY-MM-DD" if visible on the receipt, otherwise null,
  "confidence": 0..1
}

Hard rules:
- If the total/grand amount is unreadable, set amount = null and confidence < 0.5.
- If no date is printed on the receipt, set date = null. Never invent today's date.
- Default currency is INR ONLY when the symbol "₹" is visible or the receipt is clearly Indian. Otherwise null.
- Description is one line: "<merchant> — <item or category>". No markdown, no emojis.
- confidence reflects how sure you are about amount + merchant. If you can't see the receipt at all, return null fields and confidence ~ 0.1.`;

function dataUrlFor(image: Buffer, mimetype: string): string {
  const safe = mimetype && mimetype.startsWith('image/') ? mimetype : 'image/jpeg';
  return `data:${safe};base64,${image.toString('base64')}`;
}

/**
 * Extract a transaction draft from a receipt image. Always returns a
 * defined shape — on any failure we emit nulls plus a low confidence so
 * the capture flow can ask the user instead of silently mislabelling.
 */
export async function extractFromReceipt(
  image: Buffer,
  mimetype: string,
): Promise<ReceiptExtraction> {
  if (!isAIConfigured()) {
    log.warn('AI_VISION_MOCK', { reason: 'no_api_key', bytes: image.byteLength });
    return {
      amount: null,
      currency: null,
      description: null,
      date: null,
      confidence: 0,
      source: 'mock',
    };
  }

  const client = getOpenAI();
  if (!client) {
    return {
      amount: null,
      currency: null,
      description: null,
      date: null,
      confidence: 0,
      source: 'mock',
    };
  }

  try {
    const completion = await withLatency('vision.extract', () =>
      client.chat.completions.create({
        model: env.OPENAI_VISION_MODEL,
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract the receipt fields. Return only JSON with the schema given.',
              },
              { type: 'image_url', image_url: { url: dataUrlFor(image, mimetype), detail: 'auto' } },
            ],
          },
        ],
      }),
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }

    const parsed = visionSchema.safeParse(payload);
    if (!parsed.success) {
      log.warn('AI_VISION_PARSE_FAIL', {
        issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
      });
      return {
        amount: null,
        currency: null,
        description: null,
        date: null,
        confidence: 0.1,
        source: 'gpt-4o',
      };
    }

    return {
      amount: parsed.data.amount ?? null,
      currency: parsed.data.currency ?? null,
      description: parsed.data.description ?? null,
      date: parsed.data.date ?? null,
      confidence: parsed.data.confidence ?? 0.5,
      source: 'gpt-4o',
    };
  } catch (err) {
    log.error('AI_VISION_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return {
      amount: null,
      currency: null,
      description: null,
      date: null,
      confidence: 0,
      source: 'mock',
    };
  }
}
