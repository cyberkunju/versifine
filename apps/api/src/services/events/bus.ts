/**
 * Per-user event bus.
 *
 * The WS layer (Phase 9) will subscribe a websocket session to this bus
 * keyed by the authenticated user id. For now any in-process consumer
 * (forecast cache invalidator, budget recompute, smoke tests) can call
 * `subscribe()` and receive a typed `WsEvent`.
 *
 * Each emit increments a per-user monotonic `seq` so a client reconnecting
 * with a "last-seen" cursor can detect drops. Events carry `entityId` so
 * dedupe-on-receipt is trivial.
 */
import { isWsEventType, type WsEvent, type WsEventType } from '@finehance/shared';

type Handler = (event: WsEvent) => void;

const seqByUser = new Map<string, number>();
const subscribersByUser = new Map<string, Set<Handler>>();

function nextSeq(userId: string): number {
  const next = (seqByUser.get(userId) ?? 0) + 1;
  seqByUser.set(userId, next);
  return next;
}

export interface EmitInput {
  type: WsEventType;
  entityId: string;
  data: WsEvent['data'];
}

/**
 * Emit an event to all of `userId`'s subscribers. Returns the assembled
 * envelope so callers can also pass it down a different transport (e.g.
 * the bot's outgoing WhatsApp queue) without re-deriving it.
 */
export function emit(userId: string, input: EmitInput): WsEvent {
  if (!isWsEventType(input.type)) {
    throw new Error(`Unknown WS event type: ${input.type as string}`);
  }
  const envelope = {
    type: input.type,
    seq: nextSeq(userId),
    entityId: input.entityId,
    ts: new Date().toISOString(),
    data: input.data,
  } as WsEvent;

  const subs = subscribersByUser.get(userId);
  if (subs) {
    for (const handler of subs) {
      try {
        handler(envelope);
      } catch {
        // Handler crashes must not block other subscribers or the caller.
      }
    }
  }
  return envelope;
}

/**
 * Subscribe to a user's stream. Returns an unsubscribe function. Multiple
 * subscribers per user are supported (web + bot + an in-process forecast
 * invalidator can all listen at once).
 */
export function subscribe(userId: string, handler: Handler): () => void {
  let bucket = subscribersByUser.get(userId);
  if (!bucket) {
    bucket = new Set();
    subscribersByUser.set(userId, bucket);
  }
  bucket.add(handler);
  return () => {
    const set = subscribersByUser.get(userId);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) subscribersByUser.delete(userId);
  };
}

/** Test-only: clear all subscriptions and reset sequence numbers. */
export function _resetEventBus(): void {
  seqByUser.clear();
  subscribersByUser.clear();
}
