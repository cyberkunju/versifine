/**
 * Compound-plan executor — the "why AI" path.
 *
 * The legacy router picks exactly ONE intent per message, so a compound
 * utterance like "paid 500 rent and got 2000 salary and lent ravi 300"
 * logs one leg and silently drops the rest — the user believes all three
 * saved. The planner (`services/ai/planner.ts`) already decomposes such a
 * message into a typed action list and has run in SHADOW for a while. This
 * module turns that decomposition into real writes for the bounded, safe
 * subset of action kinds, behind a strict grounding/confidence gate.
 *
 * SCOPE (v1): only baskets whose every action is one of
 *   log_expense | log_income | lend | borrow
 * are executed here. Anything else (budget/goal/transfer/correct/delete/
 * query/change_language/chat/none, or a single-action plan) returns null so
 * the proven legacy single-intent routing handles it untouched.
 *
 * ATOMICITY: legs are validated up front (wallet availability, currency),
 * then persisted sequentially. Each expense/income leg mints its own L2-2
 * undo token, and each lend/borrow leg is a normal reversible ledger entry,
 * so a (rare) mid-basket failure leaves only independently-reversible writes
 * rather than a half-committed atomic unit. We log loudly and return the legs
 * that succeeded.
 */
import { type Currency, isCurrency, type TransactionSource } from '@versifine/shared';
import { log } from '../../utils/logger.ts';
import { createTransaction } from '../transactions/create.ts';
import { createEntry } from '../ledger/index.ts';
import { listLiveWallets, pickWallet } from './wallet.ts';
import { textHasForeignCurrencyToken } from '../ai/parserRegex.ts';
import type { PlannedAction, PlannerResult } from '../ai/planner.ts';

const TODAY = (): string => new Date().toISOString().slice(0, 10);

const SUPPORTED_KINDS = new Set<PlannedAction['kind']>([
  'log_expense',
  'log_income',
  'lend',
  'borrow',
]);

/** Minimum self-reported planner confidence to act on a basket without asking. */
const MIN_PLAN_CONFIDENCE = 0.7;

export interface PlanLegResult {
  /** 'tx' for a wallet transaction (expense/income), 'ledger' for lend/borrow. */
  kind: 'tx' | 'ledger';
  actionKind: 'log_expense' | 'log_income' | 'lend' | 'borrow';
  amount: number;
  currency: string;
  description: string | null;
  category: string | null;
  counterparty: string | null;
  direction: 'lent' | 'borrowed' | null;
  /** L2-2 undo token — present only on tx legs (ledger legs aren't tokenised). */
  undoToken: string | null;
}

export interface ExecutePlanArgs {
  userId: string;
  spaceId: string;
  baseCurrency: string;
  source: TransactionSource;
  text: string;
  plan: PlannerResult;
}

/**
 * Is this plan a basket we are willing to execute live? Two or more actions,
 * every one a supported money movement, all amounts deterministically
 * grounded, and the planner reasonably confident.
 */
export function isExecutablePlan(plan: PlannerResult): boolean {
  if (plan.actions.length < 2) return false;
  if (!plan.allAmountsGrounded) return false;
  if (plan.confidence < MIN_PLAN_CONFIDENCE) return false;
  return plan.actions.every((a) => SUPPORTED_KINDS.has(a.kind));
}

/** Trust an action's echoed `sourceText` only when it's genuinely a substring
 *  of the message (case/whitespace-insensitive); otherwise fall back to the
 *  whole message. Mirrors the batch parser's itemSpan so the per-leg currency
 *  guard can't be widened by a paraphrase. */
function spanOf(sourceText: string | null | undefined, fullText: string): string {
  const src = typeof sourceText === 'string' ? sourceText.trim() : '';
  if (!src) return fullText;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(fullText).includes(norm(src)) ? src : fullText;
}

/** Resolve an action's currency conservatively: a non-INR code is honoured
 *  only when it's a valid ISO AND a foreign currency token appears in THIS
 *  action's own span (not anywhere in the message). This is the per-leg guard
 *  that stops "$100 hotel and 2000 food" booking the rupee leg as USD — the
 *  exact corruption the batch parser's per-item span guard prevents. */
function resolveCurrency(raw: string | null, span: string): Currency {
  if (!raw) return 'INR';
  const upper = raw.trim().toUpperCase();
  if (!isCurrency(upper)) return 'INR';
  if (upper === 'INR') return 'INR';
  return textHasForeignCurrencyToken(span) ? (upper as Currency) : 'INR';
}

/**
 * Execute a compound money basket. Returns the per-leg results, or null when
 * the plan isn't an executable basket or can't be persisted (e.g. no live
 * wallet for an expense/income leg) — in which case the caller falls back to
 * legacy routing. Never throws: a leg failure is logged and skipped.
 */
export async function executePlan(args: ExecutePlanArgs): Promise<PlanLegResult[] | null> {
  const { userId, spaceId, baseCurrency, source, text, plan } = args;
  if (!isExecutablePlan(plan)) return null;

  const actions = plan.actions;
  const needsWallet = actions.some((a) => a.kind === 'log_expense' || a.kind === 'log_income');

  let liveWallets: Awaited<ReturnType<typeof listLiveWallets>> = [];
  if (needsWallet) {
    liveWallets = await listLiveWallets(spaceId);
    if (liveWallets.length === 0) return null; // can't persist a spend with no wallet
  }

  const results: PlanLegResult[] = [];
  let attempted = false;
  for (const action of actions) {
    try {
      if (action.kind === 'log_expense' || action.kind === 'log_income') {
        if (action.amount == null || !Number.isFinite(action.amount) || action.amount <= 0) continue;
        const walletPick = pickWallet(liveWallets, action.walletHint ?? null);
        const walletId = walletPick.wallet?.id;
        if (!walletId) continue;
        const currency = resolveCurrency(action.currency, spanOf(action.sourceText, text));
        const description =
          (action.description && action.description.trim()) ||
          (action.kind === 'log_income' ? 'income' : 'expense');
        const payload: Record<string, unknown> = {
          type: action.kind === 'log_income' ? 'income' : 'expense',
          amount: action.amount,
          currency,
          date: action.date ?? TODAY(),
          description,
          walletId,
          tags: [],
        };
        attempted = true;
        const { row, undoToken } = await createTransaction({ userId, spaceId, source, input: payload });
        results.push({
          kind: 'tx',
          actionKind: action.kind,
          amount: Number(row.amount),
          currency: row.currency,
          description: row.description,
          category: row.category,
          counterparty: null,
          direction: null,
          undoToken,
        });
      } else if (action.kind === 'lend' || action.kind === 'borrow') {
        if (action.amount == null || !Number.isFinite(action.amount) || action.amount <= 0) continue;
        const direction = action.kind === 'lend' ? 'lent' : 'borrowed';
        const currency = resolveCurrency(action.currency, spanOf(action.sourceText, text));
        const counterparty = (action.counterparty && action.counterparty.trim()) || 'someone';
        attempted = true;
        const row = await createEntry(userId, spaceId, baseCurrency, {
          direction,
          counterpartyName: counterparty,
          amount: action.amount,
          currency: currency as never,
          date: action.date ?? TODAY(),
        });
        results.push({
          kind: 'ledger',
          actionKind: action.kind,
          amount: Number(row.amount),
          currency: row.currency,
          description: null,
          category: null,
          counterparty: row.counterpartyName,
          direction,
          undoToken: null,
        });
      }
    } catch (err) {
      log.warn('PLAN_LEG_FAIL', {
        kind: action.kind,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  // CRITICAL double-write guard. Return null — telling the caller to fall back
  // to legacy routing — ONLY when we never attempted a single write (not
  // executable, no wallet, or every leg had an invalid amount). The moment we
  // attempt ANY persist we return the results array (even if a leg later threw
  // post-commit), so the caller can NEVER re-route and double-log a basket we
  // already started committing.
  if (!attempted) return null;
  return results;
}

/** Test-only surface for the pure guards. */
export const __planInternals = { spanOf, resolveCurrency };
