/**
 * WebSocket broadcaster.
 *
 * Subscribes to the in-process event bus and fans events out to every
 * authenticated socket for the matching user. Sockets self-register via
 * `attach(ws, userId)` when the upgrade succeeds and self-deregister via
 * `detach(ws)` on close. The bus subscription is set up lazily on first
 * `attach` and torn down once no users are listening.
 *
 * Design:
 *   - One bus subscription per active user, not per socket. Multiple tabs
 *     share the same subscription handle.
 *   - Send is best-effort: a backpressured socket is closed rather than
 *     queued, because finance events are small and stale events are worse
 *     than dropped ones.
 *   - On close we trim the per-user set; when the set empties we
 *     unsubscribe from the bus to keep the emitter clean.
 */
import type { ServerWebSocket } from 'bun';
import type { WsEvent } from '@finehance/shared';
import { log } from '../../utils/logger.ts';
import { subscribe } from './bus.ts';

interface Attachment {
  userId: string;
  attachedAt: number;
}

const socketsByUser = new Map<string, Set<ServerWebSocket<Attachment>>>();
const unsubByUser = new Map<string, () => void>();

function ensureSubscription(userId: string): void {
  if (unsubByUser.has(userId)) return;
  const off = subscribe(userId, (event) => fanout(userId, event));
  unsubByUser.set(userId, off);
}

function fanout(userId: string, event: WsEvent): void {
  const sockets = socketsByUser.get(userId);
  if (!sockets || sockets.size === 0) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    try {
      const ok = ws.send(payload);
      if (typeof ok === 'number' && ok < 0) {
        // Backpressure or send error; close the socket.
        try {
          ws.close(1011, 'backpressure');
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      log.warn('WS_SEND_FAIL', {
        userId,
        error: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    }
  }
}

export function attachSocket(ws: ServerWebSocket<Attachment>): void {
  const { userId } = ws.data;
  ensureSubscription(userId);
  let bucket = socketsByUser.get(userId);
  if (!bucket) {
    bucket = new Set();
    socketsByUser.set(userId, bucket);
  }
  bucket.add(ws);
  log.info('WS_ATTACH', { userId, totalSockets: bucket.size });
  // Immediate handshake message so clients know the channel is live.
  ws.send(
    JSON.stringify({
      type: 'connected',
      ts: new Date().toISOString(),
    }),
  );
}

export function detachSocket(ws: ServerWebSocket<Attachment>): void {
  const { userId } = ws.data;
  const bucket = socketsByUser.get(userId);
  if (!bucket) return;
  bucket.delete(ws);
  if (bucket.size === 0) {
    socketsByUser.delete(userId);
    const off = unsubByUser.get(userId);
    if (off) off();
    unsubByUser.delete(userId);
  }
  log.info('WS_DETACH', { userId, remaining: bucket.size });
}

/** Test-only helper — clears all sockets and bus subscriptions. */
export function _resetWsBroadcaster(): void {
  for (const off of unsubByUser.values()) {
    try {
      off();
    } catch {
      // ignore
    }
  }
  unsubByUser.clear();
  socketsByUser.clear();
}

export type WsAttachment = Attachment;
