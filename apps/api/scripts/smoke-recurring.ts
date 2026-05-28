/**
 * Smoke test: register → create wallet → seed monthly subscription
 * transactions → run detector → list → dismiss.
 *
 * Run while the dev API is up:
 *   bun run --cwd apps/api scripts/smoke-recurring.ts
 */
export {};

const BASE = process.env.API_URL ?? 'http://localhost:5000';

interface CallResult<T> {
  status: number;
  data: T;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<CallResult<T>> {
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

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const email = `recurring+${Date.now()}@finehance.app`;
  const password = 'Finehance#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };

  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Recurring Demo',
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

  // Seed a Netflix-style monthly charge across the lookback window.
  for (const offset of [85, 55, 25]) {
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount: 649,
        currency: 'INR',
        date: isoDaysAgo(offset),
        description: 'Netflix Subscription',
        walletId,
      },
      access,
    );
  }

  // Seed a weekly Swiggy subscription-feeling charge (steady amount, weekly cadence).
  for (const offset of [42, 35, 28, 21, 14, 7]) {
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount: 380,
        currency: 'INR',
        date: isoDaysAgo(offset),
        description: 'Spotify Family',
        walletId,
      },
      access,
    );
  }

  // Run the detector.
  type DetectorResult = {
    summary: { created: number; updated: number; total: number };
    items: Array<{
      id: string;
      displayName: string;
      averageAmount: number;
      frequencyDays: number;
      confidence: number;
      status: string;
    }>;
  };
  const detect = await call<DetectorResult>('POST', '/recurring/run', {}, access);
  console.log(
    `  → detector: created=${detect.data.summary.created} updated=${detect.data.summary.updated}`,
  );
  for (const it of detect.data.items) {
    console.log(
      `     • ${it.displayName} ₹${it.averageAmount} every ${it.frequencyDays}d conf=${it.confidence}`,
    );
  }

  // List active recurring items.
  type ListEnvelope = { items: Array<{ id: string; displayName: string; status: string }> };
  const list = await call<ListEnvelope>('GET', '/recurring?status=active', undefined, access);
  if (list.data.items.length === 0) {
    throw new Error('expected at least one active recurring item');
  }

  // Dismiss the first one.
  const first = list.data.items[0];
  if (!first) throw new Error('no recurring item to dismiss');
  await call('PATCH', `/recurring/${first.id}`, { status: 'dismissed' }, access);

  const list2 = await call<ListEnvelope>('GET', '/recurring?status=dismissed', undefined, access);
  console.log(`  → after dismiss: ${list2.data.items.length} dismissed`);

  console.log('\nsmoke-recurring: OK');
}

main().catch((err) => {
  console.error('smoke-recurring: FAILED', err);
  process.exit(1);
});
