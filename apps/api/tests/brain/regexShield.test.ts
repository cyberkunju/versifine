/**
 * Regex Shield — unit tests.
 *
 * These run entirely in-process with no DB or network.
 * They prove the hard never-throw contract.
 */
import { describe, expect, it } from 'bun:test';
import {
  compilePattern,
  drainRepairQueue,
  enqueueRepair,
  safeRegexExec,
  safeRegexTest,
} from '../../src/services/ai/brain/regexShield.ts';

describe('compilePattern', () => {
  it('compiles a valid pattern', () => {
    const re = compilePattern('^spent\\s+(\\d+)\\s+on\\s+(.+)$');
    expect(re).not.toBeNull();
    expect(re?.test('spent 450 on auto')).toBe(true);
  });

  it('returns null for an invalid pattern — never throws', () => {
    const re = compilePattern('[invalid(regex');
    expect(re).toBeNull();
  });

  it('returns null for a pattern exceeding MAX_PATTERN_LEN', () => {
    const long = 'a'.repeat(2001);
    expect(compilePattern(long)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(compilePattern('')).toBeNull();
  });
});

describe('safeRegexExec', () => {
  it('matches a valid pattern string', () => {
    const m = safeRegexExec('^(\\d+)$', '450');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('450');
  });

  it('returns null for no match — never throws', () => {
    const m = safeRegexExec('^(\\d+)$', 'hello');
    expect(m).toBeNull();
  });

  it('returns null for an invalid pattern string — never throws', () => {
    const m = safeRegexExec('[broken(', 'hello');
    expect(m).toBeNull();
  });

  it('accepts a pre-compiled RegExp', () => {
    const re = /^auto\s+(\d+)$/i;
    const m = safeRegexExec(re, 'auto 80');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('80');
  });

  it('enqueues patternId for repair on failure', () => {
    drainRepairQueue(); // clear
    safeRegexExec('[invalid(regex', 'text', 'i', 'pid-123');
    const queue = drainRepairQueue();
    expect(queue).toContain('pid-123');
  });
});

describe('safeRegexTest', () => {
  it('returns true on match', () => {
    expect(safeRegexTest('^\\d+$', '999')).toBe(true);
  });

  it('returns false on no-match — never throws', () => {
    expect(safeRegexTest('^\\d+$', 'abc')).toBe(false);
  });

  it('returns false on invalid pattern — never throws', () => {
    expect(safeRegexTest('((((broken', 'hello')).toBe(false);
  });
});

describe('repair queue', () => {
  it('accumulates and drains', () => {
    drainRepairQueue();
    enqueueRepair('a');
    enqueueRepair('b');
    enqueueRepair('a'); // duplicate — Set deduplication
    const q = drainRepairQueue();
    expect(q.sort()).toEqual(['a', 'b']);
    expect(drainRepairQueue()).toHaveLength(0);
  });
});
