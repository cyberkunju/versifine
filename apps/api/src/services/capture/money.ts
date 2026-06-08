/**
 * Money-movement orchestration — connects natural language to the (already
 * built) ledger + transfer engine.
 *
 *   lend / borrow      → create a ledger receivable / payable
 *   repayment          → settle the matching open ledger entry (clears the debt)
 *   debt query         → "who owes me", "how much do I owe", "what does X owe"
 *   transfer           → move money between the user's own wallets (NOT a spend)
 *
 * Each handler returns a `MoneyResult` (or null when the text isn't that kind),
 * which the capture route renders into the uniform capture envelope and the bot
 * localises. None of these ever touch the spending totals incorrectly: ledger
 * entries aren't transactions, and transfers are excluded from spend summaries.
 */
import { extractDebt } from '../ai/debt.ts';
import { extractAmount } from '../ai/parserRegex.ts';
import { createEntry, listLedger, settleEntry } from '../ledger/index.ts';
import { createTransfer } from '../transactions/transfer.ts';
import { listLiveWallets, pickWallet } from './wallet.ts';
import { log } from '../../utils/logger.ts';

export interface LedgerView {
  direction: 'lent' | 'borrowed';
  counterparty: string;
  amount: number;
  currency: string;
  outstanding: number;
  status: 'open' | 'partial' | 'settled';
}

export interface DebtsView {
  /** What this query was about. */
  scope: 'lent' | 'borrowed' | 'all';
  counterparty: string | null;
  receivables: Array<{ counterparty: string; outstanding: number }>;
  payables: Array<{ counterparty: string; outstanding: number }>;
  totalReceivable: number;
  totalPayable: number;
  currency: string;
}

export interface TransferView {
  amount: number;
  currency: string;
  fromName: string;
  toName: string;
}

export type MoneyResult =
  | { kind: 'ledger'; intent: 'lend' | 'borrow'; ledger: LedgerView }
  | { kind: 'settle'; intent: 'settle_debt'; ledger: LedgerView; settledAmount: number; cleared: boolean }
  | { kind: 'debts'; intent: 'query_debts'; debts: DebtsView }
  | { kind: 'transfer'; intent: 'transfer'; transfer: TransferView }
  | { kind: 'needs'; intent: 'lend' | 'borrow' | 'transfer'; message: string };

const TODAY = (): string => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ *
 * 1. Lend / borrow → ledger entry
 * ------------------------------------------------------------------ */

export async function handleLendBorrow(args: {
  userId: string;
  spaceId: string;
  baseCurrency: string;
  text: string;
  direction: 'lent' | 'borrowed';
  locale?: string;
}): Promise<MoneyResult> {
  const { userId, spaceId, baseCurrency, text, direction, locale } = args;
  const debt = await extractDebt(text, locale);

  if (debt.amount === null) {
    return {
      kind: 'needs',
      intent: direction === 'lent' ? 'lend' : 'borrow',
      message: 'How much was it?',
    };
  }
  const counterparty = debt.counterparty ?? 'someone';
  const currency = debt.currency ?? 'INR';

  const row = await createEntry(userId, spaceId, baseCurrency, {
    direction,
    counterpartyName: counterparty,
    amount: debt.amount,
    currency: currency as never,
    date: debt.date ?? TODAY(),
    note: debt.note ?? undefined,
  });

  return {
    kind: 'ledger',
    intent: direction === 'lent' ? 'lend' : 'borrow',
    ledger: {
      direction,
      counterparty: row.counterpartyName,
      amount: Number(row.amount),
      currency: row.currency,
      outstanding: Number(row.outstanding),
      status: row.status as LedgerView['status'],
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. Repayment → settle a matching open ledger entry
 * ------------------------------------------------------------------ */

// "ravi paid me back", "returned my money", "I paid mom back", "settled with X"
const REPAY_RE =
  /\b(paid\s+(?:me\s+)?back|paid\s+back|pay(?:ing)?\s+back|payback|returned|repaid|repay|gave\s+back|settled|cleared|got\s+back|wapas|वापस|लौटा|चुका|തിരികെ|തിരിച്ച|മടക്കി|திரும்ப|வாபஸ்|తిరిగి|వాపసు|ವಾಪಸ್|ಹಿಂತಿರುಗಿ)\b/i;
// Signals the OTHER person returned money to me → settle a `lent` entry.
const THEY_PAID_ME = /\b(paid\s+me|me\s+back|got\s+back|returned\s+to\s+me|gave\s+me\s+back|i\s+got)\b/i;
// Signals I returned money → settle a `borrowed` entry.
const I_PAID_THEM = /\b(i\s+paid|paid\s+back|i\s+returned|paid\s+off|settled\s+with|paid\s+my)\b/i;

/**
 * Detect a repayment and, if it matches an OPEN/partial ledger entry, settle it.
 * Returns null when the text isn't a repayment or no matching debt exists (the
 * caller then falls through to normal routing — e.g. it's just income).
 */
export async function tryRepayment(args: {
  userId: string;
  spaceId: string;
  baseCurrency: string;
  text: string;
  locale?: string;
}): Promise<MoneyResult | null> {
  const { userId, spaceId, baseCurrency, text, locale } = args;
  if (!REPAY_RE.test(text)) return null;

  // Need at least one open/partial entry to settle.
  const open = await listLedger(spaceId, {});
  const live = open.filter((e) => e.status === 'open' || e.status === 'partial');
  if (live.length === 0) return null;

  const debt = await extractDebt(text, locale);
  const name = debt.counterparty?.toLowerCase() ?? null;

  // Filter by counterparty when one was named.
  const nameMatched = name
    ? live.filter(
        (e) =>
          e.counterpartyName.toLowerCase().includes(name) ||
          name.includes(e.counterpartyName.toLowerCase()),
      )
    : [];
  let candidates = nameMatched.length > 0 ? nameMatched : live;

  // Disambiguate direction from phrasing when both kinds are open.
  const dirHint: 'lent' | 'borrowed' | null = THEY_PAID_ME.test(text)
    ? 'lent'
    : I_PAID_THEM.test(text)
      ? 'borrowed'
      : null;
  if (dirHint) {
    const byDir = candidates.filter((e) => e.direction === dirHint);
    if (byDir.length > 0) candidates = byDir;
  }

  // Prefer the most recent matching entry.
  const entry = candidates[0];
  if (!entry) return null;

  const outstanding = Number(entry.outstanding);
  // When NO amount was given we'd settle the whole outstanding balance. That's
  // only safe when the message clearly pins down WHICH debt — i.e. it named a
  // counterparty that matched a live entry, or it carried a directional cue
  // ("paid me back" / "I paid them"). A bare "cleared"/"settled" with no amount
  // and no target must NOT silently zero out a debt ("cleared my head").
  const hasAmount = debt.amount !== null;
  if (!hasAmount && nameMatched.length === 0 && !dirHint) return null;

  const settleAmount = Math.min(debt.amount ?? outstanding, outstanding);
  if (settleAmount <= 0) return null;

  try {
    const result = await settleEntry(userId, spaceId, entry.id, baseCurrency, {
      amount: settleAmount,
      date: debt.date ?? TODAY(),
    });
    const remaining = Number(result.entry.outstanding);
    return {
      kind: 'settle',
      intent: 'settle_debt',
      ledger: {
        direction: entry.direction as LedgerView['direction'],
        counterparty: entry.counterpartyName,
        amount: Number(entry.amount),
        currency: entry.currency,
        outstanding: remaining,
        status: result.entry.status as LedgerView['status'],
      },
      settledAmount: settleAmount,
      cleared: result.entry.status === 'settled',
    };
  } catch (err) {
    log.warn('REPAY_SETTLE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 3. Debt queries — "who owes me", "how much do I owe", "what does X owe"
 * ------------------------------------------------------------------ */

const OWE_ME = /\b(who\s+owes?\s+me|owed\s+to\s+me|owe\s+me|lent\s+to|receivable|i\s+lent|money\s+(?:people|they)\s+owe)\b/i;
const I_OWE = /\b(how\s+much\s+do\s+i\s+owe|what\s+do\s+i\s+owe|my\s+debts?|i\s+owe|payable|borrowed\s+from|do\s+i\s+owe)\b/i;
const LEDGER_WORD = /\b(owe|owes|owed|debt|debts|loan|loans|lent|borrow|borrowed|udhaar|udhar|ledger|receivable|payable)\b/i;

/** Detect a debt/ledger question. Returns the scope + optional counterparty, else null. */
export function detectDebtQuery(text: string): { scope: 'lent' | 'borrowed' | 'all'; counterparty: string | null } | null {
  if (!LEDGER_WORD.test(text)) return null;
  // A statement with an amount is an action (lend/borrow/repay), not a query.
  const hasAmount = extractAmount(text).amount !== null;
  const isQuestion = /\b(who|how\s+much|what|do\s+i|does|list|show|my)\b/i.test(text) || text.includes('?');
  if (hasAmount && !isQuestion) return null;
  if (!isQuestion) return null;

  let counterparty: string | null = null;
  const m = /\b(?:does|do\s+i\s+owe|owe)\s+([A-Z][a-z]+)\b/.exec(text);
  if (m?.[1]) counterparty = m[1];

  const wantsOweMe = OWE_ME.test(text);
  const wantsIOwe = I_OWE.test(text);
  const scope: 'lent' | 'borrowed' | 'all' = wantsIOwe && !wantsOweMe ? 'borrowed' : wantsOweMe && !wantsIOwe ? 'lent' : 'all';
  return { scope, counterparty };
}

export async function handleDebtQuery(
  spaceId: string,
  q: { scope: 'lent' | 'borrowed' | 'all'; counterparty: string | null },
): Promise<MoneyResult> {
  const rows = await listLedger(spaceId, {});
  const live = rows.filter((e) => Number(e.outstanding) > 0.005);

  const nameLc = q.counterparty?.toLowerCase() ?? null;
  const matchName = (n: string) => !nameLc || n.toLowerCase().includes(nameLc);

  const receivables = live
    .filter((e) => e.direction === 'lent' && matchName(e.counterpartyName))
    .map((e) => ({ counterparty: e.counterpartyName, outstanding: Number(e.outstanding) }));
  const payables = live
    .filter((e) => e.direction === 'borrowed' && matchName(e.counterpartyName))
    .map((e) => ({ counterparty: e.counterpartyName, outstanding: Number(e.outstanding) }));

  return {
    kind: 'debts',
    intent: 'query_debts',
    debts: {
      scope: q.scope,
      counterparty: q.counterparty,
      receivables,
      payables,
      totalReceivable: round2(receivables.reduce((s, r) => s + r.outstanding, 0)),
      totalPayable: round2(payables.reduce((s, r) => s + r.outstanding, 0)),
      currency: 'INR',
    },
  };
}

/* ------------------------------------------------------------------ *
 * 4. Transfer between own wallets
 * ------------------------------------------------------------------ */

function extractTransferHints(text: string): { from: string | null; to: string | null } {
  const lower = text.toLowerCase();
  // "from <A> to <B>"
  const both = /\bfrom\s+([a-z][\w &]*?)\s+to\s+([a-z][\w &]*?)(?:\s+(?:account|wallet)\b|[.,!]|$)/i.exec(text);
  if (both) return { from: both[1]!.trim(), to: both[2]!.trim() };
  // "to <B>"
  const toOnly = /\bto\s+(?:my\s+)?([a-z][\w &]*?)(?:\s+(?:account|wallet)\b|[.,!]|$)/i.exec(text);
  const to = toOnly?.[1]?.trim() ?? null;
  // "from <A>"
  const fromOnly = /\bfrom\s+(?:my\s+)?([a-z][\w &]*?)(?:\s+(?:account|wallet)\b|[.,!]|$)/i.exec(text);
  const from = fromOnly?.[1]?.trim() ?? null;
  void lower;
  return { from, to };
}

export async function handleTransfer(args: {
  userId: string;
  spaceId: string;
  text: string;
  source: 'whatsapp_text' | 'whatsapp_voice' | 'whatsapp_image' | 'manual_web';
}): Promise<MoneyResult> {
  const { userId, spaceId, text, source } = args;
  const amt = extractAmount(text);
  if (amt.amount === null) {
    return { kind: 'needs', intent: 'transfer', message: 'How much did you move?' };
  }

  const live = await listLiveWallets(spaceId);
  if (live.length < 2) {
    return {
      kind: 'needs',
      intent: 'transfer',
      message:
        "You only have one account, so there's nothing to move between. Add another account first, then I can record transfers.",
    };
  }

  const hints = extractTransferHints(text);
  const toPick = pickWallet(live, hints.to);
  // The destination must be a real, matched wallet (not the generic fallback)
  // when a hint was given — otherwise we'd silently move to the wrong account.
  const toWallet =
    hints.to && toPick.matched === 'fallback' ? null : toPick.wallet;
  if (!toWallet) {
    return {
      kind: 'needs',
      intent: 'transfer',
      message: hints.to
        ? `I couldn't find an account called "${hints.to}". Which account should I move it to?`
        : 'Which account should I move it to?',
    };
  }

  // From-wallet: an explicit hint, else the first live wallet that isn't the destination.
  let fromWallet = live.find((w) => w.id !== toWallet.id) ?? null;
  if (hints.from) {
    const fromPick = pickWallet(live, hints.from);
    if (fromPick.wallet && fromPick.wallet.id !== toWallet.id && fromPick.matched !== 'fallback') {
      fromWallet = fromPick.wallet;
    }
  }
  if (!fromWallet) {
    return { kind: 'needs', intent: 'transfer', message: 'Which account should I move it from?' };
  }

  const result = await createTransfer({
    userId,
    spaceId,
    source,
    input: {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      amount: amt.amount,
    },
  });
  void result;

  return {
    kind: 'transfer',
    intent: 'transfer',
    transfer: {
      amount: amt.amount,
      currency: amt.currency ?? fromWallet.currency,
      fromName: fromWallet.name,
      toName: toWallet.name,
    },
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
