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
import { CURRENCY_ALIASES, type Currency, isCurrency } from '@versifine/shared';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, normalizeChatParams, withLatency } from './client.ts';
import { extractAmount, extractCurrency, extractDate, extractSplitCount } from './parserRegex.ts';
import { tryParseLearnedPattern, learnPatternFromParse } from './patternLearner.ts';
import {
  lookupSimilar,
  recordUtterance,
} from './brain/utteranceMemory.ts';
import { buildDynamicSystemPrompt } from './brain/promptEvolver.ts';

export type ExpenseType = 'expense' | 'income' | 'transfer';
export type MissingField = 'amount' | 'description' | 'wallet' | 'currency';

export interface MessageTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ParseInput {
  text: string;
  locale?: string;
  spaceId?: string;
  history?: MessageTurn[];
}

export interface ParsedExpense {
  type: ExpenseType;
  amount: number | null;
  currency: string | null;
  description: string | null;
  /** Extra context/story the user gave beyond the item (who, why, occasion,
   *  place) — stored as the transaction's notes. Null when none. */
  notes: string | null;
  categoryHint: string | null;
  walletHint: string | null;
  date: string | null;
  splitPeople: number | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  confidence: number;
  needs: MissingField[];
}

export interface ParsedExpenseBatch {
  items: ParsedExpense[];
  confidence: number;
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
  "notes": any extra context/story the user gave beyond the item — who they were with, why, the occasion, place details — as a short clean phrase, or null,
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
- The user is in India and the base currency is INR. Treat rupee/taka words in
  any Indian language — "rupee", "rupees", "rupaye", "rupaya", "rupiya",
  "taka", "tanka", "paisa", "₹", "रुपये", "টাকা", "ৰূপ", "રૂપિયા", "ਰੁਪਏ",
  "ଟଙ୍କା", "రూపాయలు", "ரூபாய்", "ರೂಪಾಯಿ", "രൂപ" — as INR, i.e. currency = null
  (NOT BDT/NPR/PKR/LKR). Only set a foreign currency for clearly non-Indian
  money: dollar/USD/$, euro/EUR/€, pound/GBP/£, dirham/AED, yen/JPY, etc.
- If the user did not name a currency, currency = null. Default later.
- If the user did not name a wallet, walletHint = null.
- If the user did not give a date, date = null. Never use today.
- description is a SHORT noun phrase, not a sentence. e.g. "auto", "chai", "lunch with team".
- notes captures the EXTRA story/context the user volunteered — who they were with,
  why, the occasion, the place, what happened — as a short clean phrase. Keep it
  faithful to what they said; do NOT invent it. If they gave no extra context,
  notes = null. Never duplicate the amount or date into notes, and never put the
  whole story into description (description stays short for the category).
- For transfers ("moved 500 from cash to hdfc") set type="transfer" and walletHint=destination.
- For income ("got salary 85000") set type="income".
- For foreign currency ("spent 50 dollars on lunch"), set currency="USD",
  originalAmount=50, originalCurrency="USD". Amount stays in the stated number.

Examples (input → JSON output, your model must match this style):

  "spent 450 on auto"
  → {"type":"expense","amount":450,"currency":null,"description":"auto","notes":null,"categoryHint":"transport","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.85}

  "had chai with my college friend at the station while waiting for the train, 50"
  → {"type":"expense","amount":50,"currency":null,"description":"chai","notes":"with college friend at the station while waiting for the train","categoryHint":"coffee","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.85}

  "800 for dinner, treated my team after we shipped the release"
  → {"type":"expense","amount":800,"currency":null,"description":"dinner","notes":"treated the team after shipping the release","categoryHint":"restaurants","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.82}

  "200 chai pe kharch"   (Hindi)
  → {"type":"expense","amount":200,"currency":null,"description":"chai","notes":null,"categoryHint":"coffee","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.8}

  "Food-inu 200 spent aayi"  (Malayalam-English)
  → {"type":"expense","amount":200,"currency":null,"description":"food","notes":null,"categoryHint":"food","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.78}

  "Sapadu ku 180 spend panninen"  (Tamil-English)
  → {"type":"expense","amount":180,"currency":null,"description":"meal","notes":null,"categoryHint":"food","walletHint":null,"date":null,"splitPeople":null,"originalAmount":null,"originalCurrency":null,"confidence":0.78}

  "spent 50 dollars on lunch"
  → {"type":"expense","amount":50,"currency":"USD","description":"lunch","notes":null,"categoryHint":"food","walletHint":null,"date":null,"splitPeople":null,"originalAmount":50,"originalCurrency":"USD","confidence":0.85}

  "dinner 3000 split with 4 people"
  → {"type":"expense","amount":3000,"currency":null,"description":"dinner","notes":null,"categoryHint":"restaurants","walletHint":null,"date":null,"splitPeople":4,"originalAmount":null,"originalCurrency":null,"confidence":0.8}`;

const BATCH_SYSTEM_PROMPT = `You are the transaction extractor for an Indian-first finance app.
Users speak English, Hindi, Malayalam, Tamil, Telugu, Kannada, or code-mixed/romanised variants.

Return JSON only:
{
  "items": [
    {
      "type": "expense" | "income" | "transfer",
      "amount": positive number or null,
      "currency": ISO 4217 alpha-3 or null,
      "description": one short noun phrase for THIS item, or null,
      "notes": extra context/story for THIS item (who/why/occasion/place), or null,
      "categoryHint": one or two words hinting category, or null,
      "walletHint": wallet/payment source if explicitly stated, otherwise null,
      "date": "YYYY-MM-DD" if explicit, otherwise null,
      "splitPeople": integer >= 2 if this item was split, otherwise null,
      "originalAmount": positive number if foreign currency was stated, otherwise null,
      "originalCurrency": ISO code if foreign currency was stated, otherwise null,
      "confidence": 0..1
    }
  ],
  "confidence": 0..1
}

Rules:
- Extract EACH purchase/payment as a separate item. Do not collapse multiple purchases into one total.
- Words like "pinne", "oru", "motham", "vangiyath", "roopa", "രൂപ", "പിന്നെ", "വാങ്ങിയത്" are normal phrasing/fillers.
- "2 porotta beef motham oru 453 ayi pinne oru kaappi oru 54roopa" => TWO items: porotta beef 453, kaappi 54.
- "പൊറോട്ട വാങ്ങിയത് 40 രൂപ, കേക്ക് വാങ്ങിയത് 30 രൂപ, ചായ വാങ്ങിയത് 45 രൂപ" => THREE items: amounts 40, 30, 45.
- Never invent missing amount, currency, wallet, or date. Use null.
- Keep each "description" a SHORT noun phrase; put any extra story/context for
  that item (who/why/occasion/place) in its "notes", or null if none.
- A leading quantity ("2 porotta") is not the amount when a later price exists.`;

const llmSchema = z
  .object({
    type: z.enum(['expense', 'income', 'transfer']).default('expense'),
    amount: z.union([z.number(), z.string(), z.null()]).optional(),
    currency: z.union([z.string(), z.null()]).optional(),
    description: z.union([z.string(), z.null()]).optional(),
    notes: z.union([z.string(), z.null()]).optional(),
    categoryHint: z.union([z.string(), z.null()]).optional(),
    walletHint: z.union([z.string(), z.null()]).optional(),
    date: z.union([z.string(), z.null()]).optional(),
    splitPeople: z.union([z.number(), z.string(), z.null()]).optional(),
    originalAmount: z.union([z.number(), z.string(), z.null()]).optional(),
    originalCurrency: z.union([z.string(), z.null()]).optional(),
    confidence: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const batchLlmSchema = z
  .object({
    items: z.array(llmSchema).default([]),
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
    notes: null,
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

const DESCRIPTION_STOPWORDS = new Set([
  'i',
  'me',
  'my',
  'we',
  'us',
  'had',
  'have',
  'got',
  'get',
  'bought',
  'buy',
  'paid',
  'pay',
  'spent',
  'spend',
  'expense',
  'expenses',
  'cost',
  'costs',
  'for',
  'on',
  'at',
  'to',
  'from',
  'in',
  'of',
  'the',
  'a',
  'an',
  'and',
  'with',
  'pe',
  'par',
  'ka',
  'ki',
  'ke',
  'ko',
  'oru',
  'inu',
  'ku',
  'aayi',
  'ayi',
  'aay',
  'pinne',
  'pine',
  'pinney',
  'motham',
  'motho',
  'mottham',
  'total',
  'vangiyath',
  'vangiyathu',
  'vangi',
  'roopa',
  'rupa',
  'rupay',
  'panninen',
  'maadide',
  'kharch',
  'rs',
  'rupee',
  'rupees',
  'inr',
  'വാങ്ങിയത്',
  'വാങ്ങിയതു',
  'വാങ്ങി',
  'കുടിച്ചു',
  'കഴിച്ചു',
  'രൂപ',
  'രൂപാ',
  'രൂപായ്',
  'പിന്നെ',
  'ഒരു',
  'ആയി',
  'മൊത്തം',
]);

const DESCRIPTION_NORMALIZATIONS: Record<string, string> = {
  coffe: 'coffee',
  cofee: 'coffee',
  coffie: 'coffee',
  caffee: 'coffee',
};

const CURRENCY_WORDS = new Set(
  Object.keys(CURRENCY_ALIASES)
    .flatMap((key) =>
      key
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .split(/\s+/),
    )
    .filter(Boolean),
);
const CURRENCY_TOKEN_PATTERN = Object.keys(CURRENCY_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

function normalizeDescriptionToken(token: string): string {
  return DESCRIPTION_NORMALIZATIONS[token] ?? token;
}

function inferDescriptionFallback(text: string): string | null {
  const amountPattern = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:k|thousand|lakh|crore)?`;
  const cleaned = text
    .toLowerCase()
    .replace(
      new RegExp(
        String.raw`(?:^|[^\p{L}\p{M}])(?:${CURRENCY_TOKEN_PATTERN})\s*${amountPattern}\b`,
        'giu',
      ),
      ' ',
    )
    .replace(
      new RegExp(
        String.raw`\b${amountPattern}\s*(?:${CURRENCY_TOKEN_PATTERN})(?:[^\p{L}\p{M}]|$)`,
        'giu',
      ),
      ' ',
    )
    .replace(new RegExp(String.raw`\b${amountPattern}`, 'gi'), ' ')
    .replace(/[^\p{L}\p{M}]+/gu, ' ');

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => normalizeDescriptionToken(token.trim()))
    .filter((token) => {
      if (!token) return false;
      if (token.length <= 1) return false;
      if (DESCRIPTION_STOPWORDS.has(token)) return false;
      if (CURRENCY_WORDS.has(token)) return false;
      return true;
    });

  if (tokens.length === 0) return null;
  return Array.from(new Set(tokens)).slice(0, 5).join(' ');
}

function computeNeeds(p: Omit<ParsedExpense, 'needs'>): MissingField[] {
  const needs: MissingField[] = [];
  if (p.amount === null) needs.push('amount');
  if (!p.description) needs.push('description');
  if (!p.walletHint) needs.push('wallet');
  // Currency is intentionally NOT a blocking need. This is an India-first app:
  // when the user didn't name a currency we default to INR at persist time
  // rather than derailing into a confusing "Which currency was that?" prompt
  // (which used to fire on transfers and "phonepe to ola 287/-"-style logs).
  // An explicitly stated foreign currency is captured by the parser regardless.
  return needs;
}

/**
 * True when the text carries a long encoded/alphanumeric token — a hex stream,
 * base64 payload, or opaque id (≥16 chars). Used to reject an LLM-mined amount
 * when no deterministic amount exists, so a smuggled payload can't be turned
 * into a bogus transaction.
 */
function hasEncodedBlobToken(text: string): boolean {
  for (const token of text.split(/\s+/)) {
    if (token.length < 16) continue;
    if (/^[A-Za-z0-9+/=_-]+$/.test(token) && /[A-Za-z]/.test(token) && /[0-9]/.test(token)) {
      return true;
    }
    // A long pure-hex run is also a payload (it may be all-digit in places).
    if (token.length >= 24 && /^[0-9a-fA-F]+$/.test(token)) return true;
  }
  return false;
}

async function callLLM(input: ParseInput, priorHint?: ParsedExpense): Promise<Partial<ParsedExpense> | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    // Build a dynamic, per-space prompt (adds DNA prior + hard examples).
    const dynamicPrompt = await buildDynamicSystemPrompt(SYSTEM_PROMPT, input.spaceId ?? null);

    // If we have a semantic prior hint from utterance memory, inject it as
    // a soft guide into the user message — the model weighs it heavily but
    // is still free to override it for genuinely different inputs.
    let userContent = input.locale ? `[locale=${input.locale}] ${input.text}` : input.text;
    if (priorHint) {
      const hint = `[SIMILAR_PRIOR: amount=${priorHint.amount}, description=${priorHint.description}, type=${priorHint.type}]`;
      userContent = `${hint}\n${userContent}`;
    }

    const messagesList: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: dynamicPrompt },
    ];
    // Give the model today's date (server runs on IST) so it can resolve any
    // relative date the deterministic regex missed — including ones phrased in
    // an Indian language ("कल", "ഇന്നലെ", "2 din pehle"). The regex result
    // still wins when present; this only fills `date` when regex returned null.
    {
      const now = new Date();
      const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
      messagesList.push({
        role: 'system',
        content: `Today is ${iso} (${weekday}). If the message says WHEN the money moved — "yesterday", "last Friday", "2 days ago", "on the 5th", or the same idea in any Indian language — set "date" to that absolute "YYYY-MM-DD". If no time is implied, "date": null.`,
      });
    }
    if (input.history && input.history.length > 0) {
      for (const turn of input.history) {
        messagesList.push({ role: turn.role, content: turn.content });
      }
    }
    messagesList.push({ role: 'user', content: userContent });

    const completion = await withLatency('parser.expense', () =>
      client.chat.completions.create(
        normalizeChatParams({
          model: env.OPENAI_PARSE_MODEL,
          temperature: 0,
          max_tokens: 400,
          response_format: { type: 'json_object' },
          messages: messagesList,
        }),
      ),
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
      notes: coerceString(parsed.data.notes, 280),
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

  // ── TIER 0: Semantic Utterance Memory (fastest path, ~5ms) ──────────────
  // Before anything else, check if we've seen something semantically
  // identical before. An exact hash match (similarity 1.0) or a vector
  // hit with similarity ≥ EXACT_HIT_THRESHOLD returns the cached parse
  // directly with zero LLM cost. The result is cached here so we don't
  // call the embedding API a second time for the Tier 3 prior hint.
  let memHit: Awaited<ReturnType<typeof lookupSimilar>> = null;
  if (input.spaceId) {
    memHit = await lookupSimilar(input.spaceId, text).catch(() => null);

    if (memHit?.type === 'exact') {
      log.info('PARSE_TIER0_HIT', { spaceId: input.spaceId, similarity: memHit.similarity });
      // Return the cached result, but (a) self-heal stale NUMERICS and (b) keep
      // the `needs` list fresh. The deterministic extractors are versionless
      // truth — when they disagree with the cached amount/currency (because the
      // parser improved since this row was stored: "80 hazaar"→₹80 cached but
      // now ₹80,000, a fixed fraction word, a stripped year/phone), the fresh
      // value wins. This stops the utterance cache from masking parser fixes
      // for returning users without a DB migration or cache wipe.
      const cached: ParsedExpense = { ...memHit.parsedResult };
      const fresh = extractAmount(text);
      if (fresh.amount !== null && fresh.amount !== cached.amount) {
        cached.amount = fresh.amount;
        if (fresh.currency) cached.currency = fresh.currency;
      }
      return { ...cached, needs: computeNeeds(cached) };
    }

    if (memHit?.type === 'prior') {
      log.info('PARSE_TIER0_PRIOR', { spaceId: input.spaceId, similarity: memHit.similarity });
    }

    // ── TIER 1: Learned Regex Patterns ──────────────────────────────────
    const matched = await tryParseLearnedPattern(input.spaceId, text);
    if (matched) {
      // Store for future memory lookups (fire-and-forget).
      void recordUtterance(input.spaceId, text, matched as ParsedExpense).catch(() => undefined);
      return matched as ParsedExpense;
    }
  }

  // ── TIER 2: Deterministic Regex ─────────────────────────────────────────
  const regexAmount = extractAmount(text);
  const regexCurrency = regexAmount.currency ?? extractCurrency(text);
  const regexDate = extractDate(text);
  const regexSplit = extractSplitCount(text);

  // ── TIER 3: LLM with Dynamic Prompt ────────────────────────────────────
  // Reuse the cached Tier 0 result as a prior hint if it was a soft match.
  const priorHint: ParsedExpense | undefined =
    memHit?.type === 'prior' ? memHit.parsedResult : undefined;

  const llm = isAIConfigured() ? await callLLM(input, priorHint) : null;


  // Merge with regex priority on the deterministic fields.
  const mergedAmount = regexAmount.amount ?? llm?.amount ?? null;
  // Defense against blob-mining: when NO deterministic extractor (regex or
  // worded) found an amount and the only candidate is an LLM-extracted number
  // from a message that carries a long encoded/alphanumeric token (hex,
  // base64, ids), discard it. The model mined a figure out of a payload
  // ("...execute it: 69676e6f72..." → 6967), not a real spend. A genuine
  // expense always carries a deterministically extractable amount.
  const safeAmount =
    regexAmount.amount === null && llm?.amount != null && hasEncodedBlobToken(text)
      ? null
      : mergedAmount;
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
  const fallbackDescription = inferDescriptionFallback(text);
  const mergedDescription = llm?.description ?? fallbackDescription;
  const mergedNotes = llm?.notes ?? null;
  const mergedCategoryHint = llm?.categoryHint ?? fallbackDescription;
  const mergedWalletHint = llm?.walletHint ?? null;

  // Foreign-currency mirroring: if the LLM didn't surface originalCurrency
  // but the regex caught a non-INR currency, mirror it.
  let originalAmount = llm?.originalAmount ?? null;
  let originalCurrency = llm?.originalCurrency ?? null;
  if (!originalAmount && !originalCurrency && mergedCurrency && mergedCurrency !== 'INR') {
    originalAmount = safeAmount;
    originalCurrency = mergedCurrency;
  }

  const baseConfidence = llm?.confidence ?? (fallbackDescription ? 0.5 : 0);
  // Regex hits boost confidence even when the LLM missed; this is the
  // signal the route layer trusts to skip confirmation.
  const regexBoost =
    (regexAmount.amount !== null ? 0.15 : 0) + (regexCurrency ? 0.05 : 0) + (regexDate ? 0.05 : 0);
  const confidence = Math.min(1, Math.max(0, baseConfidence + regexBoost));

  const draft: Omit<ParsedExpense, 'needs'> = {
    type: mergedType,
    amount: safeAmount,
    currency: mergedCurrency,
    description: mergedDescription,
    notes: mergedNotes,
    categoryHint: mergedCategoryHint,
    walletHint: mergedWalletHint,
    date: mergedDate,
    splitPeople: mergedSplit,
    originalAmount,
    originalCurrency,
    confidence,
  };

  const finalDraft = { ...draft, needs: computeNeeds(draft) };

  // ── Post-parse async work (fire-and-forget, never blocks caller) ────────
  if (input.spaceId) {
    // Always store the utterance in memory so future lookups benefit.
    void recordUtterance(input.spaceId, text, finalDraft).catch(() => undefined);

    if (finalDraft.confidence >= 0.75) {
      // Compile a regex template from this successful parse.
      void learnPatternFromParse(input.spaceId, text, finalDraft).catch(() => undefined);
    }
  }

  return finalDraft;
}

function parsedFromLlmData(data: z.infer<typeof llmSchema>): ParsedExpense {
  const draft: Omit<ParsedExpense, 'needs'> = {
    type: data.type,
    amount: coerceNumber(data.amount),
    currency: coerceCurrency(data.currency),
    description: coerceString(data.description),
    notes: coerceString(data.notes, 280),
    categoryHint: coerceString(data.categoryHint, 40),
    walletHint: coerceString(data.walletHint, 40),
    date: coerceString(data.date, 10),
    splitPeople: coerceInt(data.splitPeople, 2, 50),
    originalAmount: coerceNumber(data.originalAmount),
    originalCurrency: coerceCurrency(data.originalCurrency),
    confidence: coerceConfidence(data.confidence),
  };
  return { ...draft, needs: computeNeeds(draft) };
}

async function callBatchLLM(input: ParseInput): Promise<ParsedExpenseBatch | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const completion = await withLatency('parser.expenseBatch', () =>
      client.chat.completions.create(
        normalizeChatParams({
          model: env.OPENAI_PARSE_MODEL,
          temperature: 0,
          max_tokens: 900,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: BATCH_SYSTEM_PROMPT },
            {
              role: 'user',
              content: input.locale ? `[locale=${input.locale}] ${input.text}` : input.text,
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
      return null;
    }
    const parsed = batchLlmSchema.safeParse(payload);
    if (!parsed.success) return null;
    const items = parsed.data.items
      .map(parsedFromLlmData)
      .filter((item) => item.amount !== null || item.description);
    if (items.length === 0) return null;
    return { items, confidence: coerceConfidence(parsed.data.confidence) };
  } catch (err) {
    log.warn('AI_PARSE_BATCH_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return null;
  }
}

/**
 * Model-first parser for messages that may contain several transactions.
 * This fixes the old architectural bug where the prompt/schema forced the
 * model to squeeze a list of purchases into one `{ amount, description }`.
 */
export async function parseExpenseBatch(input: ParseInput): Promise<ParsedExpenseBatch | null> {
  const text = input.text?.trim() ?? '';
  if (!text || !isAIConfigured()) return null;
  const batch = await callBatchLLM(input);
  if (!batch || batch.items.length < 2) return null;
  return batch;
}

export const __parserFallbacksForTests = {
  inferDescriptionFallback,
};

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
