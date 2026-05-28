/**
 * WebSocket event contract.
 *
 * The API emits these events on a per-user channel. The web client listens
 * and reconciles by `entityId` (idempotent — duplicate seq numbers from a
 * reconnect/replay don't double-apply because we key the cache by entityId
 * rather than appending blindly).
 *
 * Adding a new event type:
 *   1. Append to `WS_EVENT_TYPES`.
 *   2. Add the discriminated branch to `WsEvent`.
 *   3. Bump the schema version in `events.bus.ts` and document it.
 */

export const WS_EVENT_TYPES = [
  'transaction.created',
  'transaction.updated',
  'transaction.deleted',
  'budget.warning',
  'budget.exceeded',
  'goal.updated',
  'recurring.detected',
  'forecast.invalidated',
  'wallet.updated',
  'ledger.updated',
] as const;

export type WsEventType = (typeof WS_EVENT_TYPES)[number];

export interface WsEnvelope<T extends WsEventType = WsEventType> {
  type: T;
  /** Monotonic sequence per user, set by the server. */
  seq: number;
  /** Stable id of the entity that changed; clients dedupe on this. */
  entityId: string;
  /** ISO timestamp the event was emitted. */
  ts: string;
}

export type TransactionCreatedEvent = WsEnvelope<'transaction.created'> & {
  data: {
    transactionId: string;
    walletId: string;
    type: 'income' | 'expense' | 'transfer' | 'opening_balance';
    amount: number;
    baseAmount: number;
    currency: string;
    date: string;
    description: string;
    category: string | null;
  };
};

export type TransactionUpdatedEvent = WsEnvelope<'transaction.updated'> & {
  data: {
    transactionId: string;
    changedFields: ReadonlyArray<string>;
  };
};

export type TransactionDeletedEvent = WsEnvelope<'transaction.deleted'> & {
  data: { transactionId: string };
};

export type BudgetWarningEvent = WsEnvelope<'budget.warning'> & {
  data: {
    budgetId: string;
    category: string;
    allocated: number;
    spent: number;
    percentage: number;
  };
};

export type BudgetExceededEvent = WsEnvelope<'budget.exceeded'> & {
  data: {
    budgetId: string;
    category: string;
    allocated: number;
    spent: number;
    overBy: number;
  };
};

export type GoalUpdatedEvent = WsEnvelope<'goal.updated'> & {
  data: {
    goalId: string;
    currentAmount: number;
    progressPercentage: number;
    atRisk: boolean;
  };
};

export type RecurringDetectedEvent = WsEnvelope<'recurring.detected'> & {
  data: {
    recurringId: string;
    displayName: string;
    averageAmount: number;
    frequencyDays: number;
  };
};

export type ForecastInvalidatedEvent = WsEnvelope<'forecast.invalidated'> & {
  data: { reason: 'transaction_change' | 'recurring_change' | 'manual' };
};

export type WalletUpdatedEvent = WsEnvelope<'wallet.updated'> & {
  data: { walletId: string; balance: number };
};

export type LedgerUpdatedEvent = WsEnvelope<'ledger.updated'> & {
  data: {
    entryId: string;
    direction: 'lent' | 'borrowed';
    outstanding: number;
    status: 'open' | 'partial' | 'settled';
  };
};

export type WsEvent =
  | TransactionCreatedEvent
  | TransactionUpdatedEvent
  | TransactionDeletedEvent
  | BudgetWarningEvent
  | BudgetExceededEvent
  | GoalUpdatedEvent
  | RecurringDetectedEvent
  | ForecastInvalidatedEvent
  | WalletUpdatedEvent
  | LedgerUpdatedEvent;

const EVENT_TYPE_SET = new Set<string>(WS_EVENT_TYPES);
export function isWsEventType(value: string): value is WsEventType {
  return EVENT_TYPE_SET.has(value);
}
