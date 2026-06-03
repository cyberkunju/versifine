/**
 * A tiny rune-based query cache.
 *
 * Pretends to be TanStack Query — same hooks-style API (`useQuery`,
 * `invalidate`, `setQueryData`) — but skips the dependency by leaning on
 * Svelte 5's reactive primitives. The cache is a Map keyed by a stable
 * stringified query key. Subscribers register a refetch callback; when
 * invalidate fires, every subscriber re-runs its fetcher.
 */
import { onDestroy } from 'svelte';

export type QueryKey = ReadonlyArray<string | number | boolean | null | undefined>;

interface CacheEntry<T = unknown> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Last time the entry was successfully fetched, ms since epoch. */
  fetchedAt: number;
  subscribers: Set<() => void>;
}

const cache = new Map<string, CacheEntry>();

function keyFor(key: QueryKey): string {
  return JSON.stringify(key.map((part) => (part === undefined ? null : part)));
}

function ensureEntry<T>(serializedKey: string): CacheEntry<T> {
  let entry = cache.get(serializedKey);
  if (!entry) {
    entry = {
      data: null,
      loading: false,
      error: null,
      fetchedAt: 0,
      subscribers: new Set(),
    };
    cache.set(serializedKey, entry);
  }
  return entry as CacheEntry<T>;
}

export interface QueryHandle<T> {
  /** Reactive snapshot. */
  readonly data: T | null;
  /** True while a fetch is in flight. */
  readonly loading: boolean;
  readonly error: Error | null;
  /** Manually re-run the fetcher (bypasses any cache). */
  refetch(): void;
}

interface UseQueryOptions<T> {
  /** Initial value to seed the cache before the first fetch resolves. */
  initialData?: T;
  /** Disable the query — handy for keys that depend on a derived id. */
  enabled?: boolean;
  /** Treat fresh-enough cached data as the answer for this many ms. */
  staleMs?: number;
}

/**
 * Read a cached query and (re)fetch on demand.
 *
 * Usage:
 *
 *     const tx = useQuery(['transactions'], () => api.transactions.list());
 *     // tx.data, tx.loading, tx.error are reactive in markup.
 */
export function useQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options: UseQueryOptions<T> = {},
): QueryHandle<T> {
  const serialized = keyFor(key);
  const entry = ensureEntry<T>(serialized);
  if (options.initialData !== undefined && entry.data === null) {
    entry.data = options.initialData;
  }

  // Reactive proxies over the cache entry. Each subscriber gets its own
  // $state so the markup re-renders without us hand-rolling a store.
  let data = $state<T | null>(entry.data);
  let loading = $state(entry.loading);
  let error = $state<Error | null>(entry.error);

  const enabled = options.enabled ?? true;
  const staleMs = options.staleMs ?? 0;

  const sync = () => {
    data = entry.data;
    loading = entry.loading;
    error = entry.error;
  };

  const run = async () => {
    if (!enabled) return;
    entry.loading = true;
    entry.error = null;
    sync();
    notifyOthers(serialized, sync);
    try {
      const value = await fetcher();
      entry.data = value;
      entry.fetchedAt = Date.now();
      entry.error = null;
    } catch (err) {
      entry.error = err instanceof Error ? err : new Error(String(err));
    } finally {
      entry.loading = false;
      sync();
      notifyOthers(serialized, sync);
    }
  };

  entry.subscribers.add(sync);

  // First mount: only fetch if we don't have fresh data already.
  if (enabled) {
    const hasFresh = entry.data !== null && staleMs > 0 && Date.now() - entry.fetchedAt < staleMs;
    if (!hasFresh) void run();
  }

  // Subscribe-to-invalidation: when invalidate(key) runs we get re-fetched.
  invalidationListeners.set(serialized, [...(invalidationListeners.get(serialized) ?? []), run]);

  // Cleanup on the calling component's destroy.
  try {
    onDestroy(() => {
      entry.subscribers.delete(sync);
      const list = invalidationListeners.get(serialized) ?? [];
      invalidationListeners.set(
        serialized,
        list.filter((fn) => fn !== run),
      );
    });
  } catch {
    // onDestroy is only valid inside component init; allow non-component callers.
  }

  return {
    get data() {
      return data;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    refetch: () => void run(),
  };
}

function notifyOthers(serialized: string, self: () => void): void {
  const entry = cache.get(serialized);
  if (!entry) return;
  for (const subscriber of entry.subscribers) {
    if (subscriber === self) continue;
    subscriber();
  }
}

const invalidationListeners = new Map<string, Array<() => void>>();

/**
 * Drop the cached value for a key (or every key with the given prefix)
 * and trigger an immediate re-fetch on every active subscriber.
 *
 * `invalidate(['transactions'])` matches both `['transactions']` and any
 * key that begins with `['transactions', ...]`, so a single call covers
 * paginated/filter variants of the same resource.
 */
export function invalidate(key: QueryKey): void {
  const prefix = keyFor(key);
  // Match exact OR prefix-of-array form. We compare by stripping the
  // closing bracket from the prefix and adding a comma.
  const prefixLoose = prefix.slice(0, -1) + ',';
  for (const [serialized, listeners] of invalidationListeners) {
    if (serialized === prefix || serialized.startsWith(prefixLoose)) {
      for (const run of listeners) void run();
    }
  }
}

/**
 * Patch the cached data for a key without triggering a network call.
 * Used by the WS layer to graft new transactions into the list cache.
 */
export function setQueryData<T>(key: QueryKey, updater: (prev: T | null) => T | null): void {
  const serialized = keyFor(key);
  const entry = ensureEntry<T>(serialized);
  entry.data = updater(entry.data);
  for (const subscriber of entry.subscribers) subscriber();
}

/** Imperative read of the current cached value. */
export function getQueryData<T>(key: QueryKey): T | null {
  const entry = cache.get(keyFor(key));
  return (entry?.data as T | null) ?? null;
}

/** Test/dev helper — clears every cached query. Not used in prod. */
export function _resetQueryCache(): void {
  cache.clear();
  invalidationListeners.clear();
}
