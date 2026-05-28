/**
 * WebSocket client for real-time events.
 *
 * The API exposes a per-user channel at `${PUBLIC_WS_URL}` and authenticates
 * via the Sec-WebSocket-Protocol header (`bearer.<jwt>`). We reconnect with
 * exponential backoff (1s → 2s → 4s, capped at 30s) and let the cache
 * layer drive cache invalidation on each event — the protocol does not
 * support replay, so on reconnect we re-fetch.
 */
import { browser } from '$app/environment';
import { PUBLIC_WS_URL } from '$lib/config';
import type { WsEvent, WsEventType } from '@finehance/shared';

type Handler<T extends WsEventType> = (event: Extract<WsEvent, { type: T }>) => void;

export class FinehanceSocket {
  private ws: WebSocket | null = null;
  private retryDelay = 1000;
  private readonly maxRetryDelay = 30_000;
  private getToken: () => string | null = () => null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<WsEventType | '*' | 'connected' | 'disconnected', Set<(event: unknown) => void>>();
  private explicitClose = false;

  /**
   * Open a connection. Closes any prior socket first. Safe to call
   * repeatedly — reconnect uses this same path.
   */
  connect(getToken: () => string | null): void {
    if (!browser) return;
    this.getToken = getToken;
    const token = getToken();
    if (!token) return;
    this.explicitClose = false;
    this.openSocket(token);
  }

  /** Subscribe to an event type. Returns an unsubscriber. */
  on<T extends WsEventType>(type: T, handler: Handler<T>): () => void {
    return this.subscribe(type, handler as (event: unknown) => void);
  }

  /** Listener for connect/disconnect transitions. */
  onConnect(handler: () => void): () => void {
    return this.subscribe('connected', () => handler());
  }
  onDisconnect(handler: () => void): () => void {
    return this.subscribe('disconnected', () => handler());
  }
  /** Subscribe to every event regardless of type. */
  onAny(handler: (event: WsEvent) => void): () => void {
    return this.subscribe('*', (event) => handler(event as WsEvent));
  }

  /** True while a socket is open. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Close the connection and stop reconnecting. */
  disconnect(): void {
    this.explicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }

  // ---- internals ----
  private subscribe(
    key: WsEventType | '*' | 'connected' | 'disconnected',
    handler: (event: unknown) => void,
  ): () => void {
    let bucket = this.listeners.get(key);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(key, bucket);
    }
    bucket.add(handler);
    return () => {
      bucket?.delete(handler);
    };
  }

  private openSocket(token: string): void {
    try {
      // PUBLIC_WS_URL already includes the /ws path in our config.
      const protocol = `bearer.${token}`;
      const ws = new WebSocket(PUBLIC_WS_URL, [protocol]);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.retryDelay = 1000;
        this.emit('connected', null);
      };
      ws.onmessage = (e) => {
        let payload: unknown;
        try {
          payload = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const type = (payload as { type?: string }).type;
        if (typeof type !== 'string') return;
        // The first message is `{ type: 'connected' }` from the server.
        if (type === 'connected') return;
        this.emit(type as WsEventType, payload);
        this.emit('*', payload);
      };
      ws.onclose = () => {
        this.connected = false;
        this.emit('disconnected', null);
        if (this.explicitClose) return;
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        // The close handler will fire next; do nothing here.
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.explicitClose) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.maxRetryDelay, this.retryDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const token = this.getToken();
      if (token) this.openSocket(token);
    }, delay);
  }

  private emit(type: string, event: unknown): void {
    const bucket = this.listeners.get(type as WsEventType | '*' | 'connected' | 'disconnected');
    if (!bucket) return;
    for (const handler of bucket) handler(event);
  }
}

/** Singleton — there's only one connection per tab. */
export const socket = new FinehanceSocket();
