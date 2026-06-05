/**
 * Utterance Memory — unit tests for pure functions.
 *
 * The DB-dependent functions (lookupSimilar, recordUtterance, etc.) require
 * pgvector and are integration-tested separately.  This file tests the pure
 * helper logic that can be exercised in isolation.
 */
import { describe, expect, it } from 'bun:test';
import { EXACT_HIT_THRESHOLD, PRIOR_THRESHOLD } from '../../src/services/ai/brain/utteranceMemory.ts';

describe('thresholds', () => {
  it('EXACT_HIT_THRESHOLD is higher than PRIOR_THRESHOLD', () => {
    expect(EXACT_HIT_THRESHOLD).toBeGreaterThan(PRIOR_THRESHOLD);
  });

  it('EXACT_HIT_THRESHOLD is between 0.9 and 1.0', () => {
    expect(EXACT_HIT_THRESHOLD).toBeGreaterThanOrEqual(0.9);
    expect(EXACT_HIT_THRESHOLD).toBeLessThan(1.0);
  });

  it('PRIOR_THRESHOLD is between 0.5 and EXACT_HIT_THRESHOLD', () => {
    expect(PRIOR_THRESHOLD).toBeGreaterThan(0.5);
    expect(PRIOR_THRESHOLD).toBeLessThan(EXACT_HIT_THRESHOLD);
  });
});
