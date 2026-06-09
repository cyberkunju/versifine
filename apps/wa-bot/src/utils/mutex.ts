/**
 * Per-key serialization (a tiny async mutex).
 *
 * The conversation engine mutates per-phone session state (state machine,
 * lastTransactionId, pending). If two messages from the SAME phone are
 * processed concurrently — two webhook POSTs the API relays back-to-back, or
 * a fast double-send — their reads/writes interleave and corrupt the session
 * (e.g. a correction races a new capture). Funnelling every phone's messages
 * through `runExclusive(phone, …)` makes each phone strictly sequential while
 * DIFFERENT phones still run in parallel.
 *
 * Single-process only (the bot is one process) — an in-memory chain is exact.
 */
const tails = new Map<string, Promise<unknown>>();

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  // Run `fn` after the previous task settles (success OR failure), so one
  // thrown handler never wedges the queue for that phone.
  const run = prev.then(fn, fn);
  tails.set(key, run);
  // Drop the key once this task settles, unless a newer task already chained
  // on (then it owns the tail). Keeps the map bounded to active phones.
  void run
    .catch(() => undefined)
    .finally(() => {
      if (tails.get(key) === run) tails.delete(key);
    });
  return run;
}
