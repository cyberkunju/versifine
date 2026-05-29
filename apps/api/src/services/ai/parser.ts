/**
 * Expense parser.
 *
 * Two passes work in parallel and merge:
 *   - Regex extractors (sacrosanct on amount, currency, date, split).
 *   - LLM in JSON mode for the semantic fields (description, type,
 *     category hint, wallet hint).
 *
 * Strict null rule: every field the user did not state explicitly is
 * `null`. The capture pipeline asks one clarifying question per missing
 * field instead of guessing — guessing is how a finance app loses
 * trust on day one.
 *
 * Returns a `confidence` score and a `needs[]` list the route layer
 * uses to decide whether to confirm or persist directly.
 */
import { z } from 'zod';
import { type Currency, isCurrency } from '@versifine/shared';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, withLatency } from './client.ts';
import {
  extractAmount,
  extractCurrency,
  extractDate,
  extractSplitCount,
} from './parserRegex.ts';

export type ExpenseType = 'expense' | 'income' | 'transfer';
export type MissingField = 'amount' | 'description' | 'wallet' | 'currency';

export interface ParseInput {
  text: string;
  locale?: string;
}

export interface ParsedExpense {
  type: ExpenseType;
  amount: number | null;
  currency: string | null;
  description: string | null;
  categoryHint: string | null;
  walletHint: string | null;
  date: string | null;
  splitPeople: number | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  confidence: number;
  needs: MissingField[];
}

const SYSTEM_PROMPT = `You are the expense parser for an Indian-first finance app. The user
speaks English / Hindi / Malayalam / Tamil / Telugu / Kannada (often
code-mixed). Your output is always JSON.

Schema (every field MUST be present, with null for anything the user
did not explicitly state):
{
  "type": "expense" | "income" | "transfer",
  "amount": positive number or null,
  "currency": ISO 4217 alpha-3 (e.g. "INR", "USD") or null,
  "description": one short line about what was bought/paid for, or null,
  "categoryHint": one or two words hinting category (e.g. "groceries", "auto") or null,
  "walletHint": which wallet was used ("hdfc", "cash", "upi", "credit card") or null,
  "date": "YYYY-MM-DD" if explicit, otherwise null,
  "splitPeople": integer ≥ 2 if user mentioned splitting, otherwise null,
  "originalAmount": positive number if foreign currency was stated, otherwise null,
  "originalCurrency": ISO code if foreign currency was stated, otherwise null,
  "confidence": 0..1
}

Rules — read carefully:
- If the user did not state a number, amount = null. Never guess.
- If the user did not name a currency, currency = null. Default later.
- If the user did not name a wallet, walletHint = null.
- If the user did not give a date, date = null. Never use today.
- description is a SHORT noun phrase, not a sentence. e.g. "auto", "chai", "lunch with team".
- For transfers ("moved 500 from cash to hdfc") set type="transfer" and walletHint=destination.
- For income ("got salary 85000") set type="income".
- For foreign currency ("spent 50 dollars on lunch"), set currency="USD",
  originalAmount=50, originalCurrency="USD". Amount stays in the stated number.

Examples (input → JSON output, your model must match this style):

  "spent 450 on auto"
  → {"type":"expense","amount":450,"currency":null,"description":"auto","categoryHint":"transport","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.85}

  "200 chai pe kharch"   (Hindi)
  → {"type":"expense","amount":200,"currency":null,"description":"chai","categoryHint":"coffee","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.8}

  "Food-inu 200 spent aayi"  (Malayalam-English)
  → {"type":"expense","amount":200,"currency":null,"description":"food","categoryHint":"food","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.78}

  "Sapadu ku 180 spend panninen"  (Tamil-English)
  → {"type":"expense","amount":180,"currency":null,"description":"meal","categoryHint":"food","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.78}

  "spent 50 dollars on lunch"
  → {"type":"expense","amount":50,"currency":"USD","description":"lunch","categoryHint":"food","walletHint":null,"date":null,"splitPeople":null,"originalAmount":50,"originalCurrency":"USD","confidence":0.85}

  "dinner 3000 split with 4 people"
  → {"type":"expense","amount":3000,"currency":null,"description":"dinner","categoryHint":"restaurants","walletHint":null,"date":null,"splitPeople":4,"originalAmount":null,"originalCurrency":null,"confidence":0.8}`;

const llmSchema = z
  .object({
    type: z.enum(['expense', 'income', 'transfer']).default('expense'),
    amount: z.union([z.number(), z.string(), z.null()]).optional(),
    currency: z.union([z.string(), z.null()]).optional(),
    description: z.union([z.string(), z.null()]).optional(),
    categoryHint: z.union([z.string(), z.null()]).optional(),
    walletHint: z.union([z.string(), z.null()]).optional(),
    date: z.union([z.string(), z.null()]).optional(),
    splitPeople: z.union([z.number(), z.string(), z.null()]).optional(),
    originalAmount: z.union([z.number(), z.string(), z.null()]).optional(),
    originalCurrency: z.union([z.string(), z.null()]).optional(),
    confidence: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function coerceInt(v: unknown, min: number, max: number): number | null {
  const n = coerceNumber(v);
  if (n === null) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

function coerceString(v: unknown, max = 240): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function coerceCurrency(v: unknown): string | null {
  const s = coerceString(v, 5);
  if (!s) return null;
  const upper = s.toUpperCase();
  return isCurrency(upper) ? upper : null;
}

function coerceConfidence(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0.5;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function emptyParse(): ParsedExpense {
  return {
    type: 'expense',
    amount: null,
    currency: null,
    description: null,
    categoryHint: null,
    walletHint: null,
    date: null,
    splitPeople: null,
    originalAmount: null,
    originalCurrency: null,
    confidence: 0,
    needs: ['amount', 'description'],
  };
}

function computeNeeds(p: Omit<ParsedExpense, 'needs'>): MissingField[] {
  const needs: MissingField[] = [];
  if (p.amount === null) needs.push('amount');
  if (!p.description) needs.push('description');
  if (!p.walletHint) needs.push('wallet');
  if (!p.currency && !p.originalCurrency) needs.push('currency');
  return needs;
}

async function callLLM(input: ParseInput): Promise<Partial<ParsedExpense> | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const completion = await withLatency('parser.expense', () =>
      client.chat.completions.create({
        model: env.OPENAI_PARSE_MODEL,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: input.locale ? `[locale=${input.locale}] ${input.text}` : input.text,
          },
        ],
      }),
    );
    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    const parsed = llmSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      type: parsed.data.type,
      amount: coerceNumber(parsed.data.amount),
      currency: coerceCurrency(parsed.data.currency),
      description: coerceString(parsed.data.description),
      categoryHint: coerceString(parsed.data.categoryHint, 40),
      walletHint: coerceString(parsed.data.walletHint, 40),
      date: coerceString(parsed.data.date, 10),
      splitPeople: coerceInt(parsed.data.splitPeople, 2, 50),
      originalAmount: coerceNumber(parsed.data.originalAmount),
      originalCurrency: coerceCurrency(parsed.data.originalCurrency),
      confidence: coerceConfidence(parsed.data.confidence),
    };
  } catch (err) {
    log.warn('AI_PARSE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return null;
  }
}

/**
 * Parse a free-form expense utterance into a structured draft.
 *
 * Resolution order per field:
 *   amount      → regex first, then LLM
 *   currency    → regex (attached to amount) first, then LLM
 *   date        → regex first, then LLM (regex understands today/yesterday)
 *   splitPeople → regex first, then LLM
 *   type/description/categoryHint/walletHint → LLM (regex won't help)
 */
export async function parseExpense(input: ParseInput): Promise<ParsedExpense> {
  const text = input.text?.trim() ?? '';
  if (!text) return emptyParse();

  const regexAmount = extractAmount(text);
  const regexCurrency = regexAmount.currency ?? extractCurrency(text);
  const regexDate = extractDate(text);
  const regexSplit = extractSplitCount(text);

  const llm = isAIConfigured() ? await callLLM(input) : null;

  // Merge with regex priority on the deterministic fields.
  const mergedAmount = regexAmount.amount ?? llm?.amount ?? null;
  const mergedCurrency = (regexCurrency as Currency | null) ?? llm?.currency ?? null;
  const mergedDate = regexDate ?? llm?.date ?? null;
  const mergedSplit = regexSplit ?? llm?.splitPeople ?? null;

  // For type and the descriptive fields the LLM is the source of truth.
  // If the LLM didn't run we make conservative guesses from the text.
  const llmType = llm?.type ?? null;
  const fallbackType: ExpenseType = /\b(received|got|earned|salary|credited)\b/i.test(text)
    ? 'income'
    : /\b(transfer|moved|sent to|to my)\b/i.test(text)
      ? 'transfer'
      : 'expense';

  const mergedType: ExpenseType = (llmType as ExpenseType | null) ?? fallbackType;
  const mergedDescription = llm?.description ?? null;
  const mergedCategoryHint = llm?.categoryHint ?? null;
  const mergedWalletHint = llm?.walletHint ?? null;

  // Foreign-currency mirroring: if the LLM didn't surface originalCurrency
  // but the regex caught a non-INR currency, mirror it.
  let originalAmount = llm?.originalAmount ?? null;
  let originalCurrency = llm?.originalCurrency ?? null;
  if (!originalAmount && !originalCurrency && mergedCurrency && mergedCurrency !== 'INR') {
    originalAmount = mergedAmount;
    originalCurrency = mergedCurrency;
  }

  const baseConfidence = llm?.confidence ?? 0;
  // Regex hits boost confidence even when the LLM missed; this is the
  // signal the route layer trusts to skip confirmation.
  const regexBoost =
    (regexAmount.amount !== null ? 0.15 : 0) +
    (regexCurrency ? 0.05 : 0) +
    (regexDate ? 0.05 : 0);
  const confidence = Math.min(1, Math.max(0, baseConfidence + regexBoost));

  const draft: Omit<ParsedExpense, 'needs'> = {
    type: mergedType,
    amount: mergedAmount,
    currency: mergedCurrency,
    description: mergedDescription,
    categoryHint: mergedCategoryHint,
    walletHint: mergedWalletHint,
    date: mergedDate,
    splitPeople: mergedSplit,
    originalAmount,
    originalCurrency,
    confidence,
  };

  return { ...draft, needs: computeNeeds(draft) };
}

/* -----------------------------------------------------------------------
 * Reference test cases (50). These are documentation only — the Phase 17
 * test runner exercises them. Each line is { input → expected highlights }.
 *
 *  1. "spent 450 on auto"                        → expense, 450, null, "auto"
 *  2. "200 chai pe kharch"                        → expense, 200, "chai"
 *  3. "Food-inu 200 spent aayi"                   → expense, 200, "food"
 *  4. "Sapadu ku 180 spend panninen"              → expense, 180, "meal"
 *  5. "Tindi gaagi 250 spend maadide"             → expense, 250, "snacks"
 *  6. "lunch ki 350 kharch"                       → expense, 350, "lunch"
 *  7. "dinner 3000 split with 4 people"           → expense, 3000, splitPeople 4
 *  8. "spent 50 dollars on lunch"                 → expense, 50, USD, "lunch"
 *  9. "got salary 85000 today"                    → income, 85000, today
 * 10. "moved 500 from cash to hdfc"               → transfer, 500
 * 11. "auto 80"                                   → expense, 80, "auto"
 * 12. "swiggy 425"                                → expense, 425, "swiggy"
 * 13. "₹120 coffee"                               → expense, 120, INR, "coffee"
 * 14. "Rs. 95 metro"                              → expense, 95, INR, "metro"
 * 15. "1500 for groceries yesterday"              → expense, 1500, "groceries", yesterday
 * 16. "spent 1.5k on shoes"                       → expense, 1500, "shoes"
 * 17. "uber 250 from hdfc"                        → expense, 250, walletHint "hdfc"
 * 18. "paid 12000 rent"                           → expense, 12000, "rent"
 * 19. "lent Aman 2000"                            → 2000  (intent decided upstream)
 * 20. "borrowed 500 from sister"                  → 500   (intent decided upstream)
 * 21. "10 USD coffee at airport"                  → expense, 10, USD, "coffee"
 * 22. "pizza 600 split with 3 friends"            → expense, 600, splitPeople 3
 * 23. "spent 80 on chai with team"                → expense, 80, "chai"
 * 24. "petrol 1200 last monday"                   → expense, 1200, last monday
 * 25. "₹2000 medicines"                           → expense, 2000, INR, "medicines"
 * 26. "rs 90 sandwich"                            → expense, 90, INR, "sandwich"
 * 27. "amazon 1499"                               → expense, 1499, "amazon"
 * 28. "netflix 649"                               → expense, 649, "netflix"
 * 29. "kitne paise — chai 30"                     → expense, 30, "chai"
 * 30. "rent paid 18000 on 01/06/2026"             → expense, 18000, "rent", 2026-06-01
 * 31. "dinner cost about 700 each between 4 of us"→ expense, 700 (or total)
 * 32. "₹1L bonus"                                 → income, 100000 (k/lakh handling)
 * 33. "10 lakh emergency fund deposit"            → 1_000_000
 * 34. "1.5 lakh investment"                       → 150000
 * 35. "spent ₹3,200 dinner with 4 people"         → expense, 3200, splitPeople 4
 * 36. "movie ticket 250"                          → expense, 250, "movie"
 * 37. "vegetable 60 from local market"            → expense, 60, "vegetables"
 * 38. "groceries 4500 dmart"                      → expense, 4500, "groceries"
 * 39. "spotify 119"                               → expense, 119, "spotify"
 * 40. "icici credit card bill 14500"              → expense, 14500, walletHint "icici"
 * 41. "today 250 cab"                             → expense, 250, today
 * 42. "yesterday biryani 320"                     → expense, 320, yesterday
 * 43. "club 4500 split with 5 of us"              → expense, 4500, splitPeople 5
 * 44. "haircut 350 saloon"                        → expense, 350, "haircut"
 * 45. "milk 60 daily"                             → expense, 60, "milk"
 * 46. "interest received 1200"                    → income, 1200
 * 47. "GBP 80 hotel in london"                    → expense, 80, GBP, "hotel"
 * 48. "AED 25 taxi airport"                       → expense, 25, AED, "taxi"
 * 49. "300 yen tea"                               → expense, 300, JPY, "tea"
 * 50. "snacks 45"                                 → expense, 45, "snacks"
 *
 * Cases 1, 2, 3, 4 mirror the system prompt examples. The full set covers
 * every codepath in the merge: amount-only, amount+currency, dates, splits,
 * income, transfer, k/lakh suffixes, walletHint, and code-mixed Indic input.
 * ---------------------------------------------------------------------- */
