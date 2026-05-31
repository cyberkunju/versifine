/**
 * Engine smoke test.
 *
 * Drives the conversation engine through the simulator transport — no
 * real WhatsApp socket, no Chromium. The Versifine API at the configured
 * URL is mocked via `mock.module` so this test runs offline. Asserts:
 *
 *   1. First-touch greeting → AWAITING_LANGUAGE
 *   2. Picking "1" → English language set + LINK prompt
 *   3. LINK 482917 → linked confirmation
 *   4. "spent 450 on auto" → captureLogged reply
 *   5. STATUS reply mentions "linked"
 *   6. RESET acknowledges
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { _resetAllSessions } from '../src/conversations/state.ts';

interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

const calls: ApiCall[] = [];

// Mock the apiClient so we don't actually hit the API.
mock.module('../src/services/apiClient.ts', () => {
  const m: Record<string, unknown> = {
    ApiClientError: class ApiClientError extends Error {
      constructor(
        public code: string,
        message: string,
        public status: number,
      ) {
        super(message);
      }
    },
    captureText: async (phone: string, text: string) => {
      calls.push({ method: 'POST', path: '/capture/text', body: { phone, text } });
      // Simulate an immediately-persisted expense.
      return {
        intent: 'expense',
        needsConfirmation: false,
        queryResult: {
          transaction: {
            id: 'tx_test_1',
            amount: 450,
            currency: 'INR',
            category: 'Transportation',
          },
        },
        echo: text,
      };
    },
    captureVoice: async () => {
      throw new Error('captureVoice not exercised in this test');
    },
    captureImage: async () => {
      throw new Error('captureImage not exercised in this test');
    },
    captureConfirm: async () => {
      throw new Error('captureConfirm not exercised in this test');
    },
    askCopilot: async () => ({ answer: 'mock copilot answer', outcome: 'answered' }),
    botWhoami: async (phone: string) => {
      calls.push({ method: 'POST', path: '/bot/whoami', body: { phone } });
      // Default: brand-new number → onboarding.
      return { exists: false, displayName: null, language: 'en', webLinked: false };
    },
    botEnsureUser: async (phone: string, language: string) => {
      calls.push({ method: 'POST', path: '/bot/ensure-user', body: { phone, language } });
      return { userId: 'u_test_1', spaceId: 's_test_1', isNew: true, displayName: null, language };
    },
    phoneLinkConfirm: async (code: string, phone: string) => {
      calls.push({ method: 'POST', path: '/auth/phone-link/confirm', body: { code, phone } });
      if (code === '482917') return { linked: true, phone };
      return { linked: false, phone };
    },
    createBudget: async () => ({ budget: { id: 'b1', name: 'mock' } }),
    patchTransactionCategory: async () => ({ transaction: { id: 'tx_test_1', category: 'Restaurants' } }),
  };
  return m;
});

// Mock the AI services so the test doesn't require an API key.
mock.module('../src/services/ai/transcribe.ts', () => ({
  transcribe: async () => ({ text: '', language: 'en', source: 'mock' as const }),
}));
mock.module('../src/services/ai/tts.ts', () => ({
  synthesizeSpeech: async () => null,
}));
mock.module('../src/services/ai/indicSpeech.ts', () => ({
  synthesizeIndicSpeech: async () => null,
}));
mock.module('../src/services/ai/translate.ts', () => ({
  translateForUser: async (text: string) => text,
}));

// Lazy import so the mocks resolve first.
let runEngine: typeof import('../src/conversations/engine.ts').runEngine;

beforeAll(async () => {
  const mod = await import('../src/conversations/engine.ts');
  runEngine = mod.runEngine;
  _resetAllSessions();
});

afterAll(() => {
  _resetAllSessions();
});

function inbound(phone: string, body: string) {
  return {
    phone,
    body,
    hasAudio: false,
    audioBuffer: null,
    audioMimetype: null,
    hasImage: false,
    imageBuffer: null,
    imageMimetype: null,
    source: 'simulator' as const,
  };
}

const PHONE = '919999900001';

test('greeting → language pick → auto-provision → capture happy path', async () => {
  // 1. First touch → whoami says new → language menu.
  const greet = await runEngine(inbound(PHONE, 'hi'));
  expect(greet.text).toContain('Versifine');
  expect(greet.state).toBe('AWAITING_LANGUAGE');
  expect(calls.find((c) => c.path === '/bot/whoami')).toBeTruthy();

  // 2. Language pick (English via "1") → auto-provision, straight to LINKED_MAIN.
  const langSet = await runEngine(inbound(PHONE, '1'));
  expect(langSet.text.toLowerCase()).toContain('english');
  expect(langSet.state).toBe('LINKED_MAIN');
  expect(calls.find((c) => c.path === '/bot/ensure-user')).toBeTruthy();

  // 3. Capture: "spent 450 on auto" — no LINK step needed.
  const capture = await runEngine(inbound(PHONE, 'spent 450 on auto'));
  expect(capture.text).toContain('Logged');
  expect(capture.text).toContain('450');
  expect(capture.text).toContain('Transportation');
  const captureCall = calls.find((c) => c.path === '/capture/text');
  expect(captureCall).toBeTruthy();
  expect((captureCall?.body as { text: string }).text).toBe('spent 450 on auto');

  // 4. STATUS.
  const status = await runEngine(inbound(PHONE, 'STATUS'));
  expect(status.text.toLowerCase()).toContain('linked');

  // 5. RESET.
  const reset = await runEngine(inbound(PHONE, 'RESET'));
  expect(reset.text).toMatch(/Reset/i);
});

test('returning user: first message is processed, not discarded', async () => {
  _resetAllSessions();
  // Swap whoami to report an EXISTING account for this number.
  mock.module('../src/services/apiClient.ts', () => ({
    ApiClientError: class ApiClientError extends Error {
      constructor(
        public code: string,
        message: string,
        public status: number,
      ) {
        super(message);
      }
    },
    captureText: async (phone: string, text: string) => {
      calls.push({ method: 'POST', path: '/capture/text', body: { phone, text } });
      return {
        intent: 'expense',
        needsConfirmation: false,
        queryResult: {
          transaction: { id: 'tx_rt', amount: 200, currency: 'INR', category: 'Coffee & Beverages' },
        },
        echo: text,
      };
    },
    captureVoice: async () => ({ intent: 'unknown', needsConfirmation: false, echo: '' }),
    captureImage: async () => ({ intent: 'unknown', needsConfirmation: false, echo: '' }),
    captureConfirm: async () => ({ intent: 'unknown', needsConfirmation: false, echo: '' }),
    askCopilot: async () => ({ answer: 'a', outcome: 'answered' }),
    botWhoami: async () => ({ exists: true, displayName: 'Asha', language: 'en', webLinked: false }),
    botEnsureUser: async (phone: string, language: string) => ({
      userId: 'u_rt',
      spaceId: 's_rt',
      isNew: false,
      displayName: 'Asha',
      language,
    }),
    phoneLinkConfirm: async () => ({ linked: true, phone: PHONE }),
    createBudget: async () => ({ budget: { id: 'b', name: 'b' } }),
    patchTransactionCategory: async () => ({ transaction: { id: 't', category: null } }),
  }));
  const enginePath = '../src/conversations/engine.ts';
  delete (require.cache as unknown as Record<string, unknown>)[require.resolve(enginePath)];
  const fresh = (await import('../src/conversations/engine.ts')).runEngine;

  // First message is an actionable expense — should be logged, NOT swallowed
  // by a greeting, and prefixed with a welcome-back.
  const out = await fresh(inbound('919999900002', 'spent 200 on coffee'));
  expect(out.state).toBe('LINKED_MAIN');
  expect(out.text).toContain('Logged');
  expect(out.text).toMatch(/Welcome back/i);
});

test('CANCEL on a draft routes through draft pending state', async () => {
  _resetAllSessions();

  // Now switch the apiClient mock to return a draft instead.
  mock.module('../src/services/apiClient.ts', () => ({
    ApiClientError: class ApiClientError extends Error {
      constructor(
        public code: string,
        message: string,
        public status: number,
      ) {
        super(message);
      }
    },
    captureText: async () => ({
      intent: 'expense',
      needsConfirmation: true,
      draftId: 'draft_xyz',
      draft: {
        type: 'expense',
        amount: null,
        currency: null,
        description: null,
        category: null,
        walletHint: null,
        date: null,
        splitPeople: null,
        originalAmount: null,
        originalCurrency: null,
        confidence: 0.4,
        needs: ['amount', 'description'],
      },
      followupQuestion: 'How much was it?',
      echo: 'something',
    }),
    captureVoice: async () => ({ intent: 'unknown', needsConfirmation: false, echo: '' }),
    captureImage: async () => ({ intent: 'unknown', needsConfirmation: false, echo: '' }),
    captureConfirm: async () => ({
      intent: 'expense',
      needsConfirmation: false,
      queryResult: { transaction: { id: 't', amount: 100, currency: 'INR', category: null } },
      echo: '',
    }),
    askCopilot: async () => ({ answer: 'mock copilot answer', outcome: 'answered' }),
    botWhoami: async () => ({ exists: false, displayName: null, language: 'en', webLinked: false }),
    botEnsureUser: async (phone: string, language: string) => ({
      userId: 'u_test_2',
      spaceId: 's_test_2',
      isNew: true,
      displayName: null,
      language,
    }),
    phoneLinkConfirm: async () => ({ linked: true, phone: PHONE }),
    createBudget: async () => ({ budget: { id: 'b', name: 'b' } }),
    patchTransactionCategory: async () => ({ transaction: { id: 't', category: null } }),
  }));

  // Re-import the engine so the new mock takes effect.
  const enginePath = '../src/conversations/engine.ts';
  delete (require.cache as unknown as Record<string, unknown>)[require.resolve(enginePath)];
  const fresh = (await import('../src/conversations/engine.ts')).runEngine;

  // Onboard: hi → language pick → auto-provisioned into LINKED_MAIN.
  await fresh(inbound(PHONE, 'hi'));
  await fresh(inbound(PHONE, '1'));

  const drafted = await fresh(inbound(PHONE, 'something'));
  expect(drafted.text).toContain('How much');
  expect(drafted.state).toBe('CAPTURE_CONFIRM');

  const cancelled = await fresh(inbound(PHONE, 'CANCEL'));
  expect(cancelled.text).toMatch(/Cancel/i);
  expect(cancelled.state).toBe('LINKED_MAIN');
});
