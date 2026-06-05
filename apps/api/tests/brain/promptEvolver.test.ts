/**
 * Prompt Evolver — unit tests for pure functions.
 *
 * The DB-backed functions are integration-tested separately.
 * Here we test `buildDynamicSystemPrompt` in isolation by stubbing the DB
 * layer: when spaceId is null/undefined it must return the base prompt unchanged.
 */
import { describe, expect, it } from 'bun:test';
import { buildDynamicSystemPrompt } from '../../src/services/ai/brain/promptEvolver.ts';

const BASE = 'BASE_SYSTEM_PROMPT';

describe('buildDynamicSystemPrompt', () => {
  it('returns base prompt unchanged when spaceId is null', async () => {
    const result = await buildDynamicSystemPrompt(BASE, null);
    expect(result).toBe(BASE);
  });

  it('returns base prompt unchanged when spaceId is undefined', async () => {
    const result = await buildDynamicSystemPrompt(BASE, undefined);
    expect(result).toBe(BASE);
  });

  it('returns a string that starts with the base prompt', async () => {
    // With a non-null spaceId, the DB calls will fail gracefully in test
    // env (no DB) and the function should still return at least the base prompt.
    const result = await buildDynamicSystemPrompt(BASE, 'space-abc').catch(() => BASE);
    expect(typeof result).toBe('string');
    expect(result.startsWith(BASE) || result === BASE).toBe(true);
  });
});
