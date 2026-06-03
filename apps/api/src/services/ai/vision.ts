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
import { getOpenAI, isAIConfigured, normalizeChatParams, withLatency } from './client.ts';

export interface ReceiptItem {
  description: string;
  amount: number;
  category: string | null;
}

export interface ReceiptExtraction {
  amount: number | null;
  currency: string | null;
  description: string | null;
  date: string | null;
  confidence: number;
  source: 'gpt-4o' | 'mock';
  items?: ReceiptItem[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const visionSchema = z
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
    items: z
      .array(
        z.object({
          description: z.string().transform((v) => v.trim().slice(0, 240)),
          amount: z.coerce.number().positive(),
          category: z.string().nullable().optional(),
        }),
      )
      .optional()
      .default([]),
  })
  .passthrough();

const SYSTEM_PROMPT = `You read ONE image related to a payment and extract a structured record.
The image may be:
- a paper/printed RECEIPT or invoice,
- a UPI / payment-app SCREENSHOT (Google Pay / GPay, PhonePe, Paytm, BHIM,
  Amazon Pay, bank app) showing "Paid ₹X to <merchant>" / "Payment successful",
- a bank/credit-card SMS or notification screenshot ("debited by ₹X at <merchant>").

Return JSON with these keys, no commentary:
{
  "amount": positive number or null,
  "currency": ISO 4217 alpha-3 code (e.g. INR, USD) or null,
  "description": one short line naming the merchant/payee and what it was for, or null,
  "date": "YYYY-MM-DD" if visible, otherwise null,
  "confidence": 0..1,
  "items": [
    {
      "description": the line item name or description (e.g. "Panadol 500mg"),
      "amount": positive number (the price/cost of this specific item),
      "category": string or null (classify the item into one of the valid categories: 'Bills & Utilities', 'Childcare', 'Coffee & Beverages', 'Convenience', 'Education', 'Entertainment', 'Fast Food', 'Food Delivery', 'Gas & Fuel', 'Giving', 'Groceries', 'Healthcare', 'Housing', 'Insurance', 'Other', 'Restaurants', 'Shopping & Retail', 'Subscriptions', 'Transportation', 'Travel')
    }
  ]
}

Hard rules:
- For UPI/payment screenshots, the amount is the big "₹X" near "Paid"/"Sent"/
  "Payment successful"/"Debited". Use that. Ignore balances, cashback, and
  "requesting" amounts.
- The payee/merchant name (e.g. "Paid to Reliance Fresh", "to SWIGGY",
  "UPI to ola") is the description. Prefer the human name over a UPI handle;
  if only a handle/VPA is shown (e.g. q12@ybl), use it as the description.
- If the total/paid amount is unreadable, set amount = null and confidence < 0.5.
- If no date is printed/shown, set date = null. Never invent today's date.
- For currency, identify the standard 3-letter ISO 4217 code from standard codes, symbols, or abbreviations (e.g., "₹"/"Rs" -> "INR", "$" -> "USD", "€" -> "EUR", "£" -> "GBP", "RM" -> "MYR", "S$" -> "SGD", "A$" -> "AUD", "C$" -> "CAD", "¥" -> "JPY").
- Default currency is INR when it's clearly an Indian app/receipt. Otherwise, try to infer the local currency from location clues (e.g., "Selangor", "Kuala Lumpur", "RM" is Malaysia/MYR). If unsure, set currency = null.
- description is one line, no markdown, no emojis, e.g. "Swiggy — food order",
  "Reliance Fresh — groceries", "Ola — ride".
- confidence reflects how sure you are about amount + merchant. If you can't
  read the image at all, return null fields and confidence ~ 0.1.
- For itemized receipts, make sure to extract EVERY purchase item listed in the receipt, and categorize them accurately. For instance, medications should be 'Healthcare', groceries as 'Groceries', dining/meals as 'Restaurants', etc. Do not include summary/tax lines like "GST", "Round", "Total", "Discount" as items; only list the actual individual items purchased.`;

function dataUrlFor(image: Buffer, mimetype: string): string {
  const safe = mimetype?.startsWith('image/') ? mimetype : 'image/jpeg';
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
      items: [],
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
      items: [],
    };
  }

  try {
    const completion = await withLatency('vision.extract', () =>
      client.chat.completions.create(
        normalizeChatParams({
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
                {
                  type: 'image_url',
                  image_url: { url: dataUrlFor(image, mimetype), detail: 'auto' },
                },
              ],
            },
          ],
        }),
      ),
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
        items: [],
      };
    }

    return {
      amount: parsed.data.amount ?? null,
      currency: parsed.data.currency ?? null,
      description: parsed.data.description ?? null,
      date: parsed.data.date ?? null,
      confidence: parsed.data.confidence ?? 0.5,
      source: 'gpt-4o',
      items: (parsed.data.items ?? []).map((item) => ({
        description: item.description,
        amount: item.amount,
        category: item.category ?? null,
      })),
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
      items: [],
    };
  }
}
