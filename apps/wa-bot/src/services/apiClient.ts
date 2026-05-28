/**
 * Typed fetch wrapper around the Finehance API.
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
    throw new ApiClientError('NETWORK', 'Could not reach Finehance API', 0);
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
): Promise<CaptureResponseShape> {
  return await call<CaptureResponseShape>({
    method: 'POST',
    path: '/capture/text',
    phone,
    body: locale ? { text, locale } : { text },
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
  if (locale) form.set('locale', locale);
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
): Promise<CaptureResponseShape> {
  const form = new FormData();
  const blob = new Blob([image], { type: mimetype });
  form.set('image', blob, suffixForMime(mimetype, 'receipt'));
  if (locale) form.set('locale', locale);
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
  payload: { draftId: string; edits?: Record<string, unknown>; text?: string },
): Promise<CaptureResponseShape> {
  return await call<CaptureResponseShape>({
    method: 'POST',
    path: '/capture/confirm',
    phone,
    body: payload,
  });
}

export async function phoneLinkConfirm(code: string, phone: string): Promise<{ linked: boolean; phone: string }> {
  return await call<{ linked: boolean; phone: string }>({
    method: 'POST',
    path: '/auth/phone-link/confirm',
    unauthenticated: true,
    body: { code, phone },
  });
}

export interface BudgetCreatePayload {
  name: string;
  recurrence: 'monthly' | 'custom';
  allocations: Record<string, number>;
  warnThreshold?: number;
  exceedThreshold?: number;
  periodStart?: string;
  periodEnd?: string;
}

export async function createBudget(phone: string, payload: BudgetCreatePayload): Promise<{ budget: { id: string; name: string } }> {
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
