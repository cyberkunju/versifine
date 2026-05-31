/**
 * Versifine API client.
 *
 * One fetch wrapper for the whole web app. It carries the access token
 * out of the rune-based auth store, retries once on a 401 by refreshing
 * the token pair, and unwraps the standard `{ success, data }` envelope
 * so callers see plain data or a thrown {@link ApiError}.
 *
 * On a second 401 we fall through to a redirect to `/login`, where the
 * auth store has already cleared its in-memory state.
 */
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { PUBLIC_API_URL } from '$lib/config';
import type {
  AdviceEnvelope,
  ApiEnvelope,
  BudgetSummary,
  CaptureResponse,
  CaptureTextInput,
  ForecastResult,
  GoalCreateInput,
  GoalProgressInput,
  GoalStatus,
  GoalSummary,
  GoalUpdateInput,
  LedgerCreateInput,
  LedgerDirection,
  LedgerEntrySummary,
  LedgerSettlementInput,
  LedgerStatus,
  LoginInput,
  PhoneLinkStartResponse,
  RecurringItem,
  RegisterInput,
  ReportSummary,
  TokenPair,
  TransactionCreateInput,
  TransactionListQuery,
  TransactionSummary,
  TransactionUpdateInput,
  TransferInput,
  UserSummary,
  WalletCreateInput,
  WalletSummary,
  WalletUpdateInput,
  Category,
  BudgetCreateInput,
  BudgetUpdateInput,
  BudgetProgress,
  Language,
  GoogleAuthInput,
} from './types';
import { ApiError } from './types';

/** Lazily injected so we avoid a circular import on the auth store. */
export interface TokenSource {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  /** Exchange the current refresh token for a fresh pair. Returns false on hard failure. */
  refresh(): Promise<boolean>;
  /** Hard logout — clear everything and bounce to /login. */
  forceLogout(): void;
}

let tokenSource: TokenSource | null = null;

/**
 * Wire the api client to the auth store. Called once during app boot
 * from `+layout.ts` to avoid the circular dependency.
 */
export function attachTokenSource(source: TokenSource): void {
  tokenSource = source;
}

interface RequestOptions extends RequestInit {
  /** Skip the auto-refresh path AND token attachment; used by auth endpoints (login/register/refresh). */
  skipAuth?: boolean;
  /** Skip envelope unwrap; used for export/CSV downloads. */
  raw?: boolean;
  /** Already-stringified query params. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Internal: marks the single post-refresh retry so we never loop refreshes. */
  _retried?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  // If the caller passed an absolute URL, honour it as-is.
  // Otherwise: prepend `/api` to every relative API path so requests
  // route through nginx (`/api/* -> api`) in production and the Vite
  // dev proxy in local dev. This keeps the client bundle host-free.
  let base: string;
  if (path.startsWith('http')) {
    base = path;
  } else if (PUBLIC_API_URL) {
    // Explicit override (cross-origin dev). Path must already include
    // any prefix the override expects; we don't add /api.
    base = `${PUBLIC_API_URL}${path}`;
  } else {
    // Same-origin behind a proxy. The web routes also use `/login`,
    // `/transactions`, etc., so we MUST prefix to avoid collisions.
    base = `/api${path}`;
  }
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth, raw, query, headers, body, _retried, ...rest } = options;
  const token = !skipAuth && tokenSource ? tokenSource.getAccessToken() : null;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const finalHeaders = new Headers(headers);
  if (!isFormData && body && !finalHeaders.has('content-type')) {
    finalHeaders.set('content-type', 'application/json');
  }
  if (token) finalHeaders.set('authorization', `Bearer ${token}`);

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body,
  });

  if (
    response.status === 401 &&
    !skipAuth &&
    !_retried &&
    tokenSource &&
    tokenSource.getRefreshToken()
  ) {
    const refreshed = await tokenSource.refresh();
    if (refreshed) {
      // Retry exactly once, WITH the freshly-minted access token attached.
      // `_retried` guards against an infinite refresh loop; we deliberately
      // do NOT set `skipAuth` here (that would drop the Authorization header
      // and guarantee another 401 → false logout).
      return request<T>(path, { ...options, _retried: true });
    }
    tokenSource.forceLogout();
    throw new ApiError('UNAUTHORIZED', 'Session expired', 401);
  }

  // A 401 on the post-refresh retry (or when no refresh token exists) is a
  // genuine auth failure — clear state and bounce to login.
  if (response.status === 401 && !skipAuth) {
    tokenSource?.forceLogout();
    throw new ApiError('UNAUTHORIZED', 'Session expired', 401);
  }

  if (raw) {
    if (!response.ok) {
      throw new ApiError('HTTP_ERROR', `HTTP ${response.status}`, response.status);
    }
    return response as unknown as T;
  }

  const text = await response.text();
  let parsed: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new ApiError('PARSE_ERROR', 'Response was not JSON', response.status);
    }
  }
  if (!parsed) {
    throw new ApiError('EMPTY_RESPONSE', 'Empty response body', response.status);
  }
  if (!parsed.success) {
    throw new ApiError(
      parsed.error.code,
      parsed.error.message,
      response.status,
      parsed.error.details,
    );
  }
  return parsed.data;
}

/**
 * Trigger a browser "Save As" for an in-memory blob. Used by authenticated
 * CSV exports — the bytes come back through {@link request} (which attaches
 * the Bearer token and rides the refresh path), so unlike a bare
 * `window.open` this can never 401.
 */
function saveBlob(blob: Blob, filename: string): void {
  if (!browser) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Public API surface — every domain object grouped under a single
 * namespace so call-sites read like `api.transactions.list({...})`.
 */
export const api = {
  auth: {
    login(input: LoginInput): Promise<{ user: UserSummary; tokens: TokenPair }> {
      return request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
        skipAuth: true,
      });
    },
    register(input: RegisterInput): Promise<{ user: UserSummary; tokens: TokenPair }> {
      return request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
        skipAuth: true,
      });
    },
    google(input: GoogleAuthInput): Promise<{ user: UserSummary; tokens: TokenPair }> {
      return request('/auth/google', {
        method: 'POST',
        body: JSON.stringify(input),
        skipAuth: true,
      });
    },
    refresh(refreshToken: string): Promise<{ tokens: TokenPair }> {
      return request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        skipAuth: true,
      });
    },
    me(): Promise<{ user: UserSummary }> {
      return request('/auth/me');
    },
    logout(refreshToken?: string): Promise<{ loggedOut: boolean }> {
      return request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
    },
    phoneLinkStart(): Promise<PhoneLinkStartResponse> {
      return request('/auth/phone-link/start', { method: 'POST' });
    },
  },
  transactions: {
    list(
      query: Partial<TransactionListQuery> = {},
    ): Promise<{ items: TransactionSummary[]; total: number; limit: number; offset: number }> {
      return request('/transactions', { query: query as Record<string, string | number> });
    },
    get(id: string): Promise<{ transaction: TransactionSummary }> {
      return request(`/transactions/${id}`);
    },
    create(input: TransactionCreateInput): Promise<{ transaction: TransactionSummary }> {
      return request('/transactions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    patch(
      id: string,
      input: TransactionUpdateInput,
    ): Promise<{ transaction: TransactionSummary }> {
      return request(`/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    delete(id: string): Promise<{ deleted: boolean }> {
      return request(`/transactions/${id}`, { method: 'DELETE' });
    },
    correctCategory(
      id: string,
      category: Category,
    ): Promise<{ transaction: TransactionSummary }> {
      return request(`/transactions/${id}/category`, {
        method: 'POST',
        body: JSON.stringify({ category }),
      });
    },
    /**
     * Authenticated CSV export. Fetches the file as a blob (Bearer token
     * attached via {@link request}) and triggers a download. Returns the
     * blob too, for callers that want to handle it themselves.
     */
    async exportCsv(query: Partial<TransactionListQuery> = {}): Promise<Blob> {
      const res = await request<Response>('/transactions/export', {
        query: query as Record<string, string | number>,
        raw: true,
      });
      const blob = await res.blob();
      saveBlob(blob, `versifine-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
      return blob;
    },
    import(formData: FormData): Promise<{ imported: number; skipped: number; errors: unknown[] }> {
      return request('/transactions/import', {
        method: 'POST',
        body: formData,
      });
    },
  },
  wallets: {
    list(): Promise<{ wallets: WalletSummary[] }> {
      return request('/wallets');
    },
    get(id: string): Promise<{ wallet: WalletSummary }> {
      return request(`/wallets/${id}`);
    },
    create(input: WalletCreateInput): Promise<{ wallet: WalletSummary }> {
      return request('/wallets', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    patch(id: string, input: WalletUpdateInput): Promise<{ wallet: WalletSummary }> {
      return request(`/wallets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    delete(id: string): Promise<{ archived: boolean }> {
      return request(`/wallets/${id}`, { method: 'DELETE' });
    },
    transfer(input: TransferInput): Promise<{
      transferId: string;
      from: { id: string; walletId: string };
      to: { id: string; walletId: string };
    }> {
      return request('/wallets/transfer', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  },
  budgets: {
    list(): Promise<{ budgets: BudgetSummary[] }> {
      return request('/budgets');
    },
    get(id: string): Promise<{ budget: BudgetSummary }> {
      return request(`/budgets/${id}`);
    },
    create(input: BudgetCreateInput): Promise<{ budget: BudgetSummary }> {
      return request('/budgets', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    patch(id: string, input: BudgetUpdateInput): Promise<{ budget: BudgetSummary }> {
      return request(`/budgets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    delete(id: string): Promise<{ deleted: boolean }> {
      return request(`/budgets/${id}`, { method: 'DELETE' });
    },
    progress(id: string): Promise<{ progress: BudgetProgress }> {
      return request(`/budgets/${id}/progress`);
    },
  },
  goals: {
    list(status?: GoalStatus): Promise<{ goals: GoalSummary[] }> {
      return request('/goals', { query: status ? { status } : undefined });
    },
    get(id: string): Promise<{ goal: GoalSummary }> {
      return request(`/goals/${id}`);
    },
    create(input: GoalCreateInput): Promise<{ goal: GoalSummary }> {
      return request('/goals', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    patch(id: string, input: GoalUpdateInput): Promise<{ goal: GoalSummary }> {
      return request(`/goals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    delete(id: string): Promise<{ deleted: boolean }> {
      return request(`/goals/${id}`, { method: 'DELETE' });
    },
    progress(id: string, body: GoalProgressInput): Promise<{ goal: GoalSummary }> {
      return request(`/goals/${id}/progress`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  },
  ledger: {
    list(opts?: {
      direction?: LedgerDirection;
      status?: LedgerStatus;
      counterpartyName?: string;
    }): Promise<{ entries: LedgerEntrySummary[] }> {
      return request('/ledger', { query: opts as Record<string, string> });
    },
    get(id: string): Promise<{ entry: LedgerEntrySummary }> {
      return request(`/ledger/${id}`);
    },
    create(input: LedgerCreateInput): Promise<{ entry: LedgerEntrySummary }> {
      return request('/ledger', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    settle(
      id: string,
      body: LedgerSettlementInput,
    ): Promise<{ entry: LedgerEntrySummary; settlement: unknown }> {
      return request(`/ledger/${id}/settle`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  },
  recurring: {
    list(status?: 'active' | 'dismissed'): Promise<{ items: RecurringItem[] }> {
      return request('/recurring', { query: status ? { status } : undefined });
    },
    run(): Promise<{ summary: unknown; items: RecurringItem[] }> {
      return request('/recurring/run', { method: 'POST' });
    },
    patchStatus(
      id: string,
      status: 'active' | 'dismissed',
    ): Promise<{ item: RecurringItem }> {
      return request(`/recurring/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
  },
  forecast: {
    get(days: 7 | 14 | 30 | 60 | 90 = 30): Promise<{ forecast: ForecastResult }> {
      return request('/forecast', { query: { days } });
    },
  },
  reports: {
    summary(range: { from: string; to: string }): Promise<{ summary: ReportSummary }> {
      return request('/reports/summary', { query: range });
    },
    /** Authenticated CSV export of the report summary; triggers a download. */
    async summaryCsv(range: { from: string; to: string }): Promise<Blob> {
      const res = await request<Response>('/reports/summary.csv', { query: range, raw: true });
      const blob = await res.blob();
      saveBlob(blob, `versifine-summary-${range.from}-${range.to}.csv`);
      return blob;
    },
  },
  advice: {
    get(): Promise<AdviceEnvelope> {
      return request('/advice');
    },
  },
  capture: {
    text(text: string, locale?: Language): Promise<CaptureResponse> {
      const body: CaptureTextInput = { text, ...(locale ? { locale } : {}) };
      return request('/capture/text', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    voice(blob: Blob, locale?: Language): Promise<CaptureResponse> {
      const form = new FormData();
      form.append('audio', blob, 'voice.webm');
      if (locale) form.append('locale', locale);
      return request('/capture/voice', {
        method: 'POST',
        body: form,
      });
    },
    image(blob: Blob, locale?: Language): Promise<CaptureResponse> {
      const form = new FormData();
      form.append('image', blob, 'receipt.jpg');
      if (locale) form.append('locale', locale);
      return request('/capture/image', {
        method: 'POST',
        body: form,
      });
    },
    confirm(payload: {
      draftId: string;
      edits?: Record<string, unknown>;
      text?: string;
    }): Promise<CaptureResponse> {
      return request('/capture/confirm', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  },
};

/** Convenience: programmatic redirect helper used by the auth store. */
export function bounceToLogin(): void {
  if (browser) void goto('/login');
}

export type Api = typeof api;
