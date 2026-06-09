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
import { eq, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { processedMessages } from '../../db/schema/processedMessages.ts';
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

// ---- durable idempotency (survives restart) ----
const PRUNE_PROBABILITY = 0.02;
// Meta retries inbound webhooks for up to ~7 days after delivery failure. The
// dedup row must outlive that window so a long-tail retry can't double-process.
const RETENTION_DAYS = 8;

/**
 * Durable dedup — read-only check. Returns true when this messageId already
 * has a "done" row from a previous (post-restart) run. Use BEFORE processing
 * to drop a redelivery, then call markProcessedDurable AFTER processing
 * succeeds so a mid-flight crash leads to safe re-processing on retry rather
 * than silent message loss. Fails OPEN (returns false) on any DB error so a
 * transient hiccup never drops a real message; the in-memory ring still
 * blocks within-process duplicates during the same run.
 */
export async function hasBeenProcessedDurable(
  messageId: string | undefined,
): Promise<boolean> {
  if (!messageId) return false;
  try {
    const [row] = await db
      .select({ id: processedMessages.messageId })
      .from(processedMessages)
      .where(eq(processedMessages.messageId, messageId))
      .limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Durable dedup — write the "done" marker AFTER the message has been
 * successfully processed. Insert-on-conflict-do-nothing keeps it idempotent
 * (a same-process retry that races would no-op). Opportunistic prune trims
 * rows older than RETENTION_DAYS.
 */
export async function markProcessedDurable(messageId: string | undefined): Promise<void> {
  if (!messageId) return;
  try {
    await db
      .insert(processedMessages)
      .values({ messageId })
      .onConflictDoNothing();
    if (Math.random() < PRUNE_PROBABILITY) {
      void db
        .delete(processedMessages)
        .where(lt(processedMessages.createdAt, sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`))
        .catch(() => undefined);
    }
  } catch {
    // Non-fatal: an in-memory ring still dedupes within this process; on a
    // very short retry window we'd accept a rare double-process over losing
    // the original.
  }
}

/**
 * Legacy combined check — kept for callers that don't separate the read from
 * the write yet. New code should use hasBeenProcessedDurable + markProcessedDurable.
 */
export async function alreadyProcessedDurable(messageId: string | undefined): Promise<boolean> {
  if (!messageId) return false;
  try {
    const inserted = await db
      .insert(processedMessages)
      .values({ messageId })
      .onConflictDoNothing()
      .returning({ id: processedMessages.messageId });
    // Opportunistically prune old rows so the table never grows unbounded.
    if (Math.random() < PRUNE_PROBABILITY) {
      void db
        .delete(processedMessages)
        .where(lt(processedMessages.createdAt, sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`))
        .catch(() => undefined);
    }
    return inserted.length === 0;
  } catch {
    return false;
  }
}
