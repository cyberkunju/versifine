/**
 * Offline capture queue.
 *
 * IndexedDB-backed FIFO queue that buffers `/capture/text` calls when the
 * network is unreachable. The service worker calls `drain()` on `online`
 * events; the omnibar also fires it manually after a manual retry.
 *
 * A tiny home-grown wrapper around the IndexedDB API keeps the dependency
 * surface narrow — `idb` would be cleaner but it's another package.
 */
import { browser } from '$app/environment';
import { api } from '$lib/api/client';

const DB_NAME = 'finehance-offline';
const DB_VERSION = 1;
const STORE = 'captures';

export interface PendingCapture {
  id: string;
  text: string;
  locale?: string;
  createdAt: string;
  status: 'pending_sync' | 'syncing' | 'failed';
  attempts: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!browser || typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store)).then((value) => {
      result = value;
    });
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB tx failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB tx aborted'));
  });
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

class PendingCaptures {
  /** Reactive snapshot of pending items, freshest-first. */
  items = $state<PendingCapture[]>([]);
  /** True while we're flushing the queue. */
  draining = $state(false);

  /** Hydrate from IndexedDB on app boot. */
  async load(): Promise<void> {
    if (!browser) return;
    try {
      const all = await tx<PendingCapture[]>('readonly', (store) => asPromise(store.getAll()));
      this.items = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      this.items = [];
    }
  }

  /** Push a new capture into the queue. */
  async add(text: string, locale?: string): Promise<PendingCapture> {
    const item: PendingCapture = {
      id: cryptoRandomId(),
      text,
      ...(locale ? { locale } : {}),
      createdAt: new Date().toISOString(),
      status: 'pending_sync',
      attempts: 0,
    };
    await tx('readwrite', (store) => asPromise(store.put(item)));
    this.items = [item, ...this.items];
    return item;
  }

  /** Remove an item by id. */
  async remove(id: string): Promise<void> {
    await tx('readwrite', (store) => asPromise(store.delete(id)));
    this.items = this.items.filter((i) => i.id !== id);
  }

  /**
   * Try to flush every pending item. Stops at the first network error so
   * a temporary outage doesn't burn through retries.
   */
  async drain(): Promise<{ flushed: number; remaining: number }> {
    if (this.draining) return { flushed: 0, remaining: this.items.length };
    this.draining = true;
    let flushed = 0;
    try {
      const snapshot = [...this.items];
      for (const item of snapshot) {
        try {
          await api.capture.text(item.text, item.locale as never);
          await this.remove(item.id);
          flushed += 1;
        } catch (err) {
          // Update status and stop — assume network/auth issue.
          item.status = 'failed';
          item.attempts += 1;
          item.lastError = err instanceof Error ? err.message : String(err);
          await tx('readwrite', (store) => asPromise(store.put(item)));
          this.items = [...this.items];
          break;
        }
      }
    } finally {
      this.draining = false;
    }
    return { flushed, remaining: this.items.length };
  }
}

function cryptoRandomId(): string {
  if (browser && typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `pc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export const pendingCaptures = new PendingCaptures();
