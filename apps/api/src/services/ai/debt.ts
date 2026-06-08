/**
 * Natural-language extraction for the lend/borrow ledger.
 *
 * "lent ravi 2000", "borrowed 500 from mom", "ravi ko 1500 udhaar diya" —
 * the intent classifier already tags these `lend`/`borrow`; this module pulls
 * out the structured fields the ledger needs: amount (regex, sacrosanct),
 * currency, date, and the counterparty's NAME. The name is the only field a
 * regex can't reliably get across languages, so a tiny JSON-mode LLM call
 * extracts it, with a regex fallback when the model is unavailable.
 */
import { z } from 'zod';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, normalizeChatParams, withLatency } from './client.ts';
import { extractAmount, extractCurrency, extractDate } from './parserRegex.ts';

export interface DebtExtraction {
  amount: number | null;
  currency: string | null;
  counterparty: string | null;
  date: string | null;
  note: string | null;
}

const COUNTERPARTY_PROMPT = `You extract the OTHER PERSON's name from a short message about lending or
borrowing money. Return JSON only: {"counterparty": "<name>" or null, "note": "<short context>" or null}.

Rules:
- counterparty = the person the money was lent TO or borrowed FROM (e.g. "Ravi",
  "Mom", "my friend Aman" -> "Aman", "the office boy" -> "office boy").
- If no person is named, counterparty = null.
- note = any short extra context (why), else null. Never put the amount in note.
- The message may be in any Indian language or code-mixed. Output the name in
  a clean readable form (Latin if it was Latin, native script if native).

Examples:
"lent ravi 2000" -> {"counterparty":"Ravi","note":null}
"borrowed 500 from mom for groceries" -> {"counterparty":"Mom","note":"for groceries"}
"gave 1000 to my friend aman" -> {"counterparty":"Aman","note":null}
"ravi ko 1500 udhaar diya" -> {"counterparty":"Ravi","note":null}
"lent 300" -> {"counterparty":null,"note":null}`;

const schema = z
  .object({
    counterparty: z.union([z.string(), z.null()]).optional(),
    note: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

function clean(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Deterministic fallback: pull a name out of common lend/borrow shapes. */
function regexCounterparty(text: string): string | null {
  const t = text.trim();
  // "lent/gave <Name> 2000"  |  "lent/gave 2000 to <Name>"
  const m1 = /\b(?:lent|loaned|gave|paid)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+\d/.exec(t);
  if (m1?.[1]) return m1[1];
  const m2 = /\b(?:to|from)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/.exec(t);
  if (m2?.[1]) return m2[1];
  // "<Name> ko ... udhaar" (Hindi romanised)
  const m3 = /\b([A-Z][a-z]+)\s+ko\b/.exec(t);
  if (m3?.[1]) return m3[1];
  return null;
}

async function llmCounterparty(text: string): Promise<{ counterparty: string | null; note: string | null }> {
  const client = getOpenAI();
  if (!client) return { counterparty: regexCounterparty(text), note: null };
  try {
    const completion = await withLatency('debt.counterparty', () =>
      client.chat.completions.create(
        normalizeChatParams({
          model: env.OPENAI_NLU_MODEL,
          temperature: 0,
          max_tokens: 80,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: COUNTERPARTY_PROMPT },
            { role: 'user', content: text },
          ],
        }),
      ),
    );
    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { counterparty: regexCounterparty(text), note: null };
    return {
      counterparty: clean(parsed.data.counterparty) ?? regexCounterparty(text),
      note: clean(parsed.data.note, 200),
    };
  } catch (err) {
    log.warn('DEBT_COUNTERPARTY_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return { counterparty: regexCounterparty(text), note: null };
  }
}

/** Extract everything the ledger needs from a lend/borrow utterance. */
export async function extractDebt(text: string, _locale?: string): Promise<DebtExtraction> {
  const amt = extractAmount(text);
  const date = extractDate(text);
  const { counterparty, note } = isAIConfigured()
    ? await llmCounterparty(text)
    : { counterparty: regexCounterparty(text), note: null };
  return {
    amount: amt.amount,
    currency: amt.currency ?? extractCurrency(text),
    counterparty,
    date,
    note,
  };
}
