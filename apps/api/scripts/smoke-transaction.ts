/**
 * Smoke test: register → create wallet → create transaction → list →
 * update category → delete. Exercises FX, embedding queue, budget recompute.
 *
 * Run while the dev API is up: bun run --cwd apps/api scripts/smoke-transaction.ts
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

async function main() {
  const email = `txn+${Date.now()}@versifine.com`;
  const password = 'Versifine#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };

  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'TXN Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  // Wallet: HDFC INR
  type WalletEnvelope = { wallet: { id: string; balance: number } };
  const w = await call<WalletEnvelope>(
    'POST',
    '/wallets',
    { name: 'HDFC', type: 'bank', currency: 'INR', openingBalance: 50000 },
    access,
  );
  const walletId = w.data.wallet.id;
  console.log(`  → wallet ${walletId} open balance ${w.data.wallet.balance}`);

  // Direct manual expense
  type TxEnvelope = { transaction: { id: string; amount: number; category: string | null } };
  const t1 = await call<TxEnvelope>(
    'POST',
    '/transactions',
    {
      type: 'expense',
      amount: 450,
      currency: 'INR',
      date: '2026-05-28',
      description: 'Rapido Yelahanka to Madiwala',
      walletId,
      tags: ['transport'],
    },
    access,
  );
  console.log(
    `  → tx ${t1.data.transaction.id} category=${t1.data.transaction.category} amount=${t1.data.transaction.amount}`,
  );

  // Listing
  type ListEnvelope = { items: Array<{ id: string; amount: number }>; total: number };
  const list = await call<ListEnvelope>('GET', `/transactions?limit=10`, undefined, access);
  console.log(`  → list total=${list.data.total}`);

  // Update category
  await call(
    'POST',
    `/transactions/${t1.data.transaction.id}/category`,
    { category: 'Transportation' },
    access,
  );

  // Wallet balance after expense
  const w2 = await call<WalletEnvelope>('GET', `/wallets/${walletId}`, undefined, access);
  console.log(`  → wallet balance after txn: ${w2.data.wallet.balance}`);

  // Soft delete
  await call('DELETE', `/transactions/${t1.data.transaction.id}`, undefined, access);

  console.log('\nsmoke-transaction: OK');
}

main().catch((err) => {
  console.error('smoke-transaction: FAILED', err);
  process.exit(1);
});
