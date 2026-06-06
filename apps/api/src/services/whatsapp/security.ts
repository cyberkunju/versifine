/**
 * Webhook security + idempotency for the WhatsApp Cloud API.
 *
 *  - verifySignature: Meta signs every webhook POST with an HMAC-SHA256 of the
 *    raw body using the App Secret, sent as `X-Hub-Signature-256: sha256=<hex>`.
 *    We MUST verify this before trusting any payload, or anyone who knows the
 *    URL could inject fake messages (and fake transactions) into the pipeline.
 *
 *  - seenMessage: Meta delivers webhooks at-least-once and retries on any
 *    non-200 or timeout. Without dedup, a retried message would be processed
 *    twice — double-logging a transaction. We remember recent message ids in a
 *    bounded in-memory ring and drop repeats. (In-memory is enough: retries
 *    arrive within minutes; a process restart only risks re-processing a
 *    message that was in-flight at the moment of restart.)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../env.ts';

/**
 * Verify the X-Hub-Signature-256 header against the raw request body.
 * Returns true when valid. When no app secret is configured we return false
 * for non-empty signatures only in production; callers decide how strict to be.
 */
export function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = env.WHATSAPP_APP_SECRET;
  if (!secret) return false; // cannot verify without the secret
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signatureHeader.slice('sha256='.length).trim();

  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---- idempotency ring ----
const SEEN_CAPACITY = 2000;
const seenSet = new Set<string>();
const seenOrder: string[] = [];

/**
 * Returns true if this message id was already processed (so the caller should
 * skip it). Records the id when new. Bounded to SEEN_CAPACITY ids.
 */
export function seenMessage(messageId: string | undefined): boolean {
  if (!messageId) return false; // can't dedupe without an id — process it
  if (seenSet.has(messageId)) return true;
  seenSet.add(messageId);
  seenOrder.push(messageId);
  if (seenOrder.length > SEEN_CAPACITY) {
    const evict = seenOrder.shift();
    if (evict) seenSet.delete(evict);
  }
  return false;
}

/** Test helper to reset the dedup ring. */
export function _resetSeen(): void {
  seenSet.clear();
  seenOrder.length = 0;
}
