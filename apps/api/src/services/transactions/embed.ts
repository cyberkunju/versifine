/**
 * Background embedding job.
 *
 * `transaction.created` should not block on a network call to OpenAI,
 * so we hand the work off to a tiny in-process queue. For hackathon
 * scale (low thousands of transactions per user) a Promise-chain queue
 * is enough; the same shape will plug into BullMQ later without
 * changing call sites.
 *
 * The queue is single-flight per process — concurrent enqueues land in
 * order, so the database can index rows monotonically and we don't
 * exhaust connections on a burst of imports.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { transactionEmbeddings } from '../../db/schema/embeddings.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { log } from '../../utils/logger.ts';
import { embed } from '../ai/embed.ts';

interface Job {
  transactionId: string;
  text: string;
}

let chain: Promise<void> = Promise.resolve();
let depth = 0;
const MAX_DEPTH = 1000;

async function process(job: Job): Promise<void> {
  try {
    // Resolve the space scoping at run time so we never embed something
    // that was deleted/moved between enqueue and processing.
    const [row] = await db
      .select({ id: transactions.id, spaceId: transactions.spaceId })
      .from(transactions)
      .where(eq(transactions.id, job.transactionId))
      .limit(1);
    if (!row) {
      log.debug('EMBED_SKIP_GONE', { transactionId: job.transactionId });
      return;
    }
    const vector = await embed(job.text);
    if (vector.length === 0) {
      log.debug('EMBED_SKIP_EMPTY', { transactionId: job.transactionId });
      return;
    }
    // Upsert: re-edits should refresh the embedding for the same row.
    await db
      .insert(transactionEmbeddings)
      .values({
        transactionId: row.id,
        spaceId: row.spaceId,
        embedding: vector,
        text: job.text.slice(0, 2000),
      })
      .onConflictDoUpdate({
        target: transactionEmbeddings.transactionId,
        set: {
          embedding: vector,
          text: job.text.slice(0, 2000),
          createdAt: sql`now()`,
        },
      });
  } catch (err) {
    log.warn('EMBED_JOB_FAIL', {
      transactionId: job.transactionId,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
  } finally {
    depth = Math.max(0, depth - 1);
  }
}

/**
 * Queue an embedding refresh for a transaction. The promise resolves
 * synchronously (no awaiting on the actual job); the job runs in the
 * background as part of the chain.
 *
 * Call sites should NOT await this in latency-sensitive paths.
 */
export function enqueueEmbed(transactionId: string, text: string): void {
  if (!transactionId || !text || !text.trim()) return;
  if (depth >= MAX_DEPTH) {
    log.warn('EMBED_QUEUE_OVERFLOW', { depth });
    return;
  }
  depth += 1;
  chain = chain.then(() => process({ transactionId, text }));
}

/** Wait for the queue to drain. Used by tests and graceful shutdown. */
export async function drainEmbeddings(): Promise<void> {
  await chain;
}
