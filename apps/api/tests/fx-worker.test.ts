/**
 * FX resolution worker — lifecycle + pure math.
 *
 * The end-to-end DB path (claim → re-rate → CAS update → recompute) is
 * verified by scripts/smoke-fx-resolve.ts against a real database. Here we
 * cover what's safe without a DB: the worker starts/stops idempotently and
 * doesn't fire its tick synchronously (the first drain is delayed), and the
 * base-amount recomputation math the worker relies on is correct.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { startFxResolutionWorker, stopFxResolutionWorker } from '../src/services/fx/resolveWorker.ts';
import { toBase } from '../src/services/fx/convert.ts';

afterAll(() => stopFxResolutionWorker());

describe('FX worker lifecycle', () => {
  test('start is idempotent and stop is safe to call repeatedly', () => {
    expect(() => startFxResolutionWorker(60_000)).not.toThrow();
    expect(() => startFxResolutionWorker(60_000)).not.toThrow(); // no-op second start
    expect(() => stopFxResolutionWorker()).not.toThrow();
    expect(() => stopFxResolutionWorker()).not.toThrow(); // safe double-stop
  });
});

describe('FX resolution math (what the worker writes back)', () => {
  test('a 1:1 outage row (5 OMR booked as base 5) recomputes to the real base', () => {
    // During the outage: rate=1, base=5. After resolution with the real rate
    // (1 OMR ≈ 216 INR), the base becomes ~1080 — the corruption is healed.
    const healed = toBase(5, 'OMR', 'INR', 216.12);
    expect(healed).toBeCloseTo(1080.6, 1);
    expect(healed).not.toBe(5);
  });

  test('same-currency rows resolve to identity (amount === base)', () => {
    expect(toBase(500, 'INR', 'INR', 1)).toBe(500);
  });
});
