/**
 * Typed fetch wrapper around the Versifine API.
 *
 * Every call here goes server-to-server with the bot's shared secret and
 * the user's WhatsApp phone in the headers. The API's `requireBot` /
 * `requireUserOrBot` middleware resolves the user from `X-Phone` against
 * `users.whatsapp_phone`. So phone numbers must always be normalised to
 * digits-only before they hit this module — `utils/phone.ts:normalizePhone`
 * is the canonical helper.
 *
 * Errors throw `ApiClientError` with the upstream code/message intact so
 * flow handlers can switch on `code === 'NOT_FOUND'` without parsing
 * strings. The wrapper never catches network errors silently — those
 * surface as a generic `INTERNAL` failure that flows render through the
 * localised "something went wrong" message.
 */
import { env } from '../config.ts';
import { log } from '../utils/logger.ts';
import { normalizeLocale } from '../utils/locale.ts';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface RequestOptions {
  /** When provided, sets X-Phone for bot trust resolution. */
  phone?: string;
  /** Used for /auth/* endpoints which are bot-secret-free. */
  unauthenticated?: boolean;
  /** Allow the caller to override the body type (FormData for multipart). */
  body?: unknown;
  /** Optional timeout; defaults to 30s. */
  timeoutMs?: number;
  /** Extra headers merged last (e.g. bot secret on the unauthenticated
   * /bot routes that need the secret but not an X-Phone user). */
  headers?: Record<string, string>;
}

interface InternalRequest extends RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
}

async function call<T>(req: InternalRequest): Promise<T> {
  const url = `${env.API_URL}${req.path}`;
  const headers: Record<string, string> = {};

  if (!req.unauthenticated) {
    headers['x-bot-secret'] = env.BOT_SECRET;
    if (req.phone) headers['x-phone'] = req.phone;
  }
  if (req.headers) {
    Object.assign(headers, req.headers);
  }

  let body: BodyInit | undefined;
  if (req.body !== undefined && req.body !== null) {
    if (req.body instanceof FormData) {
      body = req.body;
      // fetch will set the multipart boundary; do not set content-type.
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: req.method,
      headers,
      body,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    log.warn('API_NETWORK_FAIL', {
      method: req.method,
      path: req.path,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw new ApiClientError('NETWORK', 'Could not reach Versifine API', 0);
  }
  clearTimeout(timer);

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError(
      'INTERNAL',
      `Non-JSON response (status ${response.status})`,
      response.status,
    );
  }

  if (!payload.success) {
    throw new ApiClientError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }
  return payload.data;
}

/* ----- Endpoint helpers (typed surface) -------------------------------- */

export interface CaptureDraft {
  type: 'expense' | 'income' | 'transfer';
  amount: number | null;
  currency: string | null;
  description: string | null;
  category: string | null;
  walletHint: string | null;
  date: string | null;
  splitPeople: number | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  confidence: number;
  needs: ReadonlyArray<'amount' | 'description' | 'wallet' | 'currency'>;
}

export interface CaptureResponseShape {
  intent: string;
  needsConfirmation: boolean;
  draftId?: string;
  draft?: CaptureDraft;
  followupQuestion?: string;
  queryResult?: Record<string, unknown>;
  copilotStreamUrl?: string;
  echo: string;
}

export async function captureText(
  phone: string,
  text: string,
  locale?: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  recentContext?: string,
): Promise<CaptureResponseShape> {
  const loc = normalizeLocale(locale);
  const body: Record<string, unknown> = { text, history };
  if (loc) body.locale = loc;
  if (recentContext) body.recentContext = recentContext;
  return await call<CaptureResponseShape>({
    method: 'POST',
    path: '/capture/text',
    phone,
    body,
  });
}

export async function captureVoice(
  phone: string,
  audio: Buffer,
  mimetype: string,
  locale?: string,
): Promise<CaptureResponseShape> {
  const form = new FormData();
  const blob = new Blob([audio], { type: mimetype });
  form.set('audio', blob, suffixForMime(mimetype, 'voice'));
  const loc = normalizeLocale(locale);
  if (loc) form.set('locale', loc);
  return await call<CaptureResponseShape>({
    method: 'POST',
    path: '/capture/voice',
    phone,
    body: form,
    timeoutMs: 60_000,
  });
}

export async function captureImage(
  phone: string,
  image: Buffer,
  mimetype: string,
  locale?: string,
  /** Optional caption text the user typed alongside the photo. Forwarded to
   *  the API so vision can use it as a hint OR fall back on it when the
   *  receipt is unreadable. The empath subagent flagged that ignoring a
   *  caption ("Lulu, ₹240 for groceries") on a photo message is a louder
   *  invisibility signal than not running OCR at all. */
  caption?: string,
): Promise<CaptureResponseShape> {
  const form = new FormData();
  const blob = new Blob([image], { type: mimetype });
  form.set('image', blob, suffixForMime(mimetype, 'receipt'));
  const loc = normalizeLocale(locale);
  if (loc) form.set('locale', loc);
  if (caption && caption.trim()) form.set('caption', caption.trim().slice(0, 800));
  return await call<CaptureResponseShape>({
    method: 'POST',
    path: '/capture/image',
    phone,
    body: form,
    timeoutMs: 60_000,
  });
}

export async function captureConfirm(
  phone: string,
  payload: {
    draftId: string;
    edits?: Record<string, unknown>;
    text?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
): Promise<CaptureResponseShape> {
  return await call<CaptureResponseShape>({
    method: 'POST',
    path: '/capture/confirm',
    phone,
    body: payload,
  });
}

export interface CopilotAskResult {
  answer: string;
  outcome: string;
}

export interface BotWhoami {
  exists: boolean;
  displayName: string | null;
  language: string;
  webLinked: boolean;
}

export interface BotEnsuredUser {
  userId: string;
  spaceId: string;
  isNew: boolean;
  displayName: string | null;
  language: string;
  /** Email now stored on the account (null when the user skipped). */
  email: string | null;
  /** True when the phone was attached to a pre-existing web/email account. */
  linkedExisting: boolean;
}

/**
 * Read-only check on first contact: does an account already exist for this
 * phone? Uses the bot-secret /bot route (no X-Phone resolution) so it works
 * for numbers that aren't provisioned yet.
 */
export async function botWhoami(phone: string): Promise<BotWhoami> {
  return await call<BotWhoami>({
    method: 'POST',
    path: '/bot/whoami',
    unauthenticated: true,
    body: { phone },
    headers: { 'x-bot-secret': env.BOT_SECRET, 'x-phone': phone },
  });
}

/**
 * Find-or-create the account for a WhatsApp phone (phone-first signup).
 * Idempotent; sending a language refreshes the stored primary language.
 * An optional `email` links this phone to a pre-existing web/email account
 * (or stores the real address so the web side can adopt it later) — no OTP.
 */
export async function botEnsureUser(
  phone: string,
  language: string,
  email?: string,
): Promise<BotEnsuredUser> {
  return await call<BotEnsuredUser>({
    method: 'POST',
    path: '/bot/ensure-user',
    unauthenticated: true,
    body: email ? { phone, language, email } : { phone, language },
    // x-phone makes the provisioning rate-limit per-number instead of a single
    // shared 'anon' bucket — so concurrent NEW signups don't throttle each other.
    headers: { 'x-bot-secret': env.BOT_SECRET, 'x-phone': phone },
  });
}

/**
 * Ask the guarded copilot a free-form finance question and get one finished
 * answer back (the API screens for scope + prompt-injection server-side).
 */
export async function askCopilot(phone: string, text: string): Promise<CopilotAskResult> {
  return await call<CopilotAskResult>({
    method: 'POST',
    path: '/copilot/ask',
    phone,
    body: { text },
    timeoutMs: 45_000,
  });
}

export interface PhoneLinkConfirmResult {
  linked: boolean;
  phone: string;
  userId?: string;
  spaceId?: string;
}

export async function phoneLinkConfirm(
  code: string,
  phone: string,
): Promise<PhoneLinkConfirmResult> {
  return await call<PhoneLinkConfirmResult>({
    method: 'POST',
    path: '/auth/phone-link/confirm',
    unauthenticated: true,
    body: { code, phone },
  });
}

export interface BudgetCreatePayload {
  name: string;
  recurrence: 'monthly' | 'custom';
  allocations?: Record<string, number>;
  overallLimit?: number;
  warnThreshold?: number;
  exceedThreshold?: number;
  periodStart?: string;
  periodEnd?: string;
}

export async function createBudget(
  phone: string,
  payload: BudgetCreatePayload,
): Promise<{ budget: { id: string; name: string } }> {
  return await call<{ budget: { id: string; name: string } }>({
    method: 'POST',
    path: '/budgets',
    phone,
    body: payload,
  });
}

export async function patchTransactionCategory(
  phone: string,
  transactionId: string,
  category: string,
): Promise<{ transaction: { id: string; category: string | null } }> {
  return await call<{ transaction: { id: string; category: string | null } }>({
    method: 'POST',
    path: `/transactions/${transactionId}/category`,
    phone,
    body: { category },
  });
}

/**
 * General partial update of a transaction (amount / description / category /
 * currency). Used by the correction flow for "it was 500 not 50" (amount),
 * "change last to dinner" (description), and "its OMR not INR" (currency).
 * The API recomputes baseAmount from the wallet's currency when amount or
 * currency change.
 */
export async function patchTransaction(
  phone: string,
  transactionId: string,
  fields: { amount?: number; description?: string; category?: string; currency?: string },
): Promise<{ transaction: { id: string; amount: number; currency: string; description: string; category: string | null } }> {
  return await call<{
    transaction: { id: string; amount: number; currency: string; description: string; category: string | null };
  }>({
    method: 'PATCH',
    path: `/transactions/${transactionId}`,
    phone,
    body: fields,
  });
}

export interface UndoResultShape {
  undone: boolean;
  reversed?: 'create' | 'update' | 'delete';
  transaction?: { id: string; amount: number; currency: string; category: string | null; description: string };
}

/** Reverse the user's most recent mutation (create→remove, update→revert, delete→restore). */
export async function undoLast(phone: string): Promise<UndoResultShape> {
  return await call<UndoResultShape>({
    method: 'POST',
    path: '/transactions/undo',
    phone,
    body: {},
  });
}

export interface UndoByTokenShape {
  undone: boolean;
  reason?: 'not_found' | 'already_undone';
  reversed?: 'create' | 'update' | 'delete';
  transaction?: { id: string; amount: number; currency: string; category: string | null; description: string };
}

/** Reverse a SPECIFIC mutation by its user-facing 6-char token (L2-2). */
export async function undoByToken(phone: string, token: string): Promise<UndoByTokenShape> {
  return await call<UndoByTokenShape>({
    method: 'POST',
    path: '/transactions/undo-token',
    phone,
    body: { token },
  });
}

/** Soft-delete a transaction by id (records a 'delete' mutation; reversible via undo). */
export async function deleteTransaction(
  phone: string,
  transactionId: string,
): Promise<{ deleted: boolean }> {
  return await call<{ deleted: boolean }>({
    method: 'DELETE',
    path: `/transactions/${transactionId}`,
    phone,
  });
}

export interface ResolvedTxCandidate {
  id: string;
  amount: number;
  currency: string;
  description: string;
  category: string | null;
  date: string;
  confidence: number;
}

/**
 * Resolve a natural-language reference ("the coffee one", "yesterday's uber",
 * "last 3") to up to 3 candidate transactions. Used by the bot for corrections
 * and deletes on non-last entries — the resolver runs structural → keyword →
 * semantic strategies and returns the best matches scoped to the user's space.
 * `intent='mutate'` (default for change/delete) skips the semantic fallback so
 * a fuzzy match never silently corrupts the ledger.
 */
export async function resolveTxReference(
  phone: string,
  query: string,
  intent: 'read' | 'mutate' = 'mutate',
): Promise<{ candidates: ResolvedTxCandidate[] }> {
  return await call<{ candidates: ResolvedTxCandidate[] }>({
    method: 'POST',
    path: '/capture/resolve-ref',
    phone,
    body: { query, intent },
  });
}

export interface DbSession {
  phone: string;
  language: string;
  state: string;
  linked: boolean;
  userId: string | null;
  spaceId: string | null;
  lastDraftId: string | null;
  lastTransactionId: string | null;
  replyMode: string;
  pending: Record<string, any>;
  accountResolved: boolean;
}

export async function apiGetBotSession(phone: string): Promise<DbSession | null> {
  const res = await call<{ session: DbSession | null }>({
    method: 'GET',
    path: `/bot/sessions/${phone}`,
  });
  return res.session;
}

export async function apiSaveBotSession(phone: string, session: Partial<DbSession>): Promise<DbSession> {
  const res = await call<{ session: DbSession }>({
    method: 'POST',
    path: `/bot/sessions/${phone}`,
    body: session,
  });
  return res.session;
}

export async function apiDeleteBotSession(phone: string): Promise<void> {
  await call<{ success: boolean }>({
    method: 'DELETE',
    path: `/bot/sessions/${phone}`,
  });
}

function suffixForMime(mime: string, base: string): string {
  const lower = mime.toLowerCase();
  if (lower.startsWith('audio/ogg') || lower.includes('opus')) return `${base}.ogg`;
  if (lower.startsWith('audio/mpeg') || lower.includes('mp3')) return `${base}.mp3`;
  if (lower.startsWith('audio/mp4') || lower.includes('m4a')) return `${base}.m4a`;
  if (lower.startsWith('audio/wav')) return `${base}.wav`;
  if (lower.startsWith('audio/webm')) return `${base}.webm`;
  if (lower.startsWith('image/jpeg') || lower.endsWith('jpg')) return `${base}.jpg`;
  if (lower.startsWith('image/png')) return `${base}.png`;
  if (lower.startsWith('image/webp')) return `${base}.webp`;
  return base;
}
