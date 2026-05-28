/**
 * Smoke test: register → wallet → seed enough activity for the rules-based
 * fallback to fire → fetch advice.
 *
 *   bun run --cwd apps/api scripts/smoke-advice.ts
 */
export {};

const BASE = process.env.API_URL ?? 'http://localhost:5000';

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { success: boolean; data?: T; error?: { message: string } };
  console.log(`[${res.status}] ${method} ${path}`);
  if (!res.ok) {
    console.log(JSON.stringify(json, null, 2));
    throw new Error(`request failed: ${method} ${path}`);
  }
  return { status: res.status, data: json.data as T };
}

function isoOffset(yearMonthDelta: number, dayOffset = 0): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + yearMonthDelta);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const email = `advice+${Date.now()}@finehance.app`;
  const password = 'Finehance#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };
  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Advice Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  type WalletEnvelope = { wallet: { id: string } };
  const w = await call<WalletEnvelope>(
    'POST',
    '/wallets',
    { name: 'HDFC', type: 'bank', currency: 'INR', openingBalance: 100000 },
    access,
  );
  const walletId = w.data.wallet.id;

  // Income for both months so savings rate is computable.
  await call(
    'POST',
    '/transactions',
    {
      type: 'income',
      amount: 90000,
      currency: 'INR',
      date: isoOffset(0, 1),
      description: 'Monthly Salary',
      walletId,
    },
    access,
  );
  await call(
    'POST',
    '/transactions',
    {
      type: 'income',
      amount: 90000,
      currency: 'INR',
      date: isoOffset(-1, 1),
      description: 'Monthly Salary',
      walletId,
    },
    access,
  );

  // Last month: modest food spend.
  for (let i = 0; i < 4; i += 1) {
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount: 800,
        currency: 'INR',
        date: isoOffset(-1, i + 5),
        description: 'Swiggy Order',
        walletId,
        category: 'Food Delivery',
      },
      access,
    );
  }

  // This month: a clear overspend on Food Delivery vs last month.
  for (let i = 0; i < 8; i += 1) {
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount: 1100,
        currency: 'INR',
        date: isoOffset(0, i + 1),
        description: 'Swiggy Order',
        walletId,
        category: 'Food Delivery',
      },
      access,
    );
  }

  type AdviceEnvelope = {
    items: Array<{
      id: string;
      kind: string;
      headline: string;
      detail: string;
      priority: string;
      deltaInr?: number;
    }>;
    source: 'ai' | 'rules';
  };
  const advice = await call<AdviceEnvelope>('GET', '/advice', undefined, access);
  console.log(`  → source=${advice.data.source} items=${advice.data.items.length}`);
  for (const item of advice.data.items) {
    console.log(`     • [${item.priority}] ${item.headline}`);
  }

  if (advice.data.items.length === 0) throw new Error('expected at least one advice item');

  console.log('\nsmoke-advice: OK');
}

main().catch((err) => {
  console.error('smoke-advice: FAILED', err);
  process.exit(1);
});
