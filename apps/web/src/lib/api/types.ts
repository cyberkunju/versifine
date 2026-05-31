/**
 * Re-exports of useful shared types so the web app can pull most
 * wire-shape definitions from a single import.
 */

export type {
  UserSummary,
  TokenPair,
  RegisterInput,
  LoginInput,
  GoogleAuthInput,
  TransactionSummary,
  TransactionType,
  TransactionCreateInput,
  TransactionUpdateInput,
  TransactionListQuery,
  WalletSummary,
  WalletType,
  WalletCreateInput,
  WalletUpdateInput,
  TransferInput,
  BudgetCreateInput,
  BudgetUpdateInput,
  BudgetProgress,
  GoalSummary,
  GoalCreateInput,
  GoalUpdateInput,
  GoalProgressInput,
  GoalStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerCreateInput,
  LedgerSettlementInput,
  LedgerEntrySummary,
  CaptureResponse,
  CaptureTextInput,
  CopilotMessage,
  Category,
  Currency,
  Language,
  Intent,
  WsEvent,
  WsEventType,
} from '@versifine/shared';

/** Standard envelope returned by every JSON endpoint. */
export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

/** Thrown by the api client when the server returns success: false. */
export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface AdviceItem {
  id: string;
  kind: 'cut_back' | 'goal' | 'recurring' | 'forecast' | 'savings';
  headline: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  deltaInr?: number;
}

export interface AdviceEnvelope {
  items: AdviceItem[];
  source: 'ai' | 'rules';
}

export interface ForecastDay {
  date: string;
  recurring: number;
  variable: number;
  lower: number;
  upper: number;
}

export interface ForecastAnomaly {
  date: string;
  amount: number;
  expected: number;
  z: number;
  reason: string;
}

export interface ForecastResult {
  recurringBase: number;
  variableTotal: number;
  total: number;
  daily: ForecastDay[];
  anomalies: ForecastAnomaly[];
  method: 'arima' | 'rolling_average';
}

export interface RecurringItem {
  id: string;
  merchantNormalized: string;
  displayName: string;
  averageAmount: number;
  currency: string;
  frequencyDays: number;
  nextExpectedDate: string | null;
  occurrences: number;
  confidence: number;
  status: 'active' | 'dismissed';
  detectedAt: string;
  updatedAt: string;
}

export interface ReportSummary {
  range: { from: string; to: string };
  totals: {
    income: number;
    expense: number;
    savings: number;
    savingsRate: number;
  };
  byCategory: Array<{ category: string; total: number }>;
  byMerchant: Array<{ merchant: string; total: number }>;
  byWallet: Array<{
    walletId: string;
    walletName: string;
    currency: string;
    total: number;
  }>;
  budgetAdherence: Array<{
    budgetId: string;
    name: string;
    allocated: number;
    spent: number;
    percentage: number;
  }>;
  dayCount: number;
  transactionCount: number;
}

export interface BudgetSummary {
  id: string;
  name: string;
  recurrence: 'monthly' | 'custom';
  periodStart: string | null;
  periodEnd: string | null;
  allocations: Record<string, number>;
  warnThreshold: number;
  exceedThreshold: number;
  createdAt: string;
}

export interface PhoneLinkStartResponse {
  code?: string;
  expiresAt: string;
  instruction: string;
}
