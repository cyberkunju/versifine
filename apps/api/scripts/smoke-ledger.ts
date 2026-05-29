/**
 * Smoke test: register → create wallet → create lent + borrowed entries →
 * partial settle → full settle (with linked transaction) → list →
 * confirm wallet balance reflects the settlement transaction.
 *
 * Run while the dev API is up: bun run --cwd apps/api scripts/smoke-ledger.ts
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
  const email = `ledger+${Date.now()}@versifine.com`;
  const password = 'Versifine#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };

  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Ledger Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  // Need a wallet to settle into.
  type WalletEnvelope = { wallet: { id: string; balance: number } };
  const w = await call<WalletEnvelope>(
    'POST',
    '/wallets',
    { name: 'HDFC', type: 'bank', currency: 'INR', openingBalance: 10000 },
    access,
  );
  const walletId = w.data.wallet.id;
  console.log(`  → wallet ${walletId} opening balance ${w.data.wallet.balance}`);

  type EntryEnvelope = {
    entry: {
      id: string;
      direction: string;
      outstanding: number;
      baseAmount: number;
      status: string;
    };
  };
  type SettleEnvelope = {
    entry: { id: string; outstanding: number; status: string };
    settlement: { id: string; amount: number; linkedTransactionId: string | null };
  };

  // 1. Lend 4,000 to "Arjun".
  const today = new Date().toISOString().slice(0, 10);
  const lent = await call<EntryEnvelope>(
    'POST',
    '/ledger',
    {
      direction: 'lent',
      counterpartyName: 'Arjun',
      amount: 4000,
      currency: 'INR',
      date: today,
      note: 'Lunch IOU',
    },
    access,
  );
  const lentId = lent.data.entry.id;
  console.log(`  → lent ${lentId} outstanding=${lent.data.entry.outstanding} status=${lent.data.entry.status}`);

  // 2. Borrow 1,500 from "Priya".
  const borrowed = await call<EntryEnvelope>(
    'POST',
    '/ledger',
    {
      direction: 'borrowed',
      counterpartyName: 'Priya',
      amount: 1500,
      currency: 'INR',
      date: today,
    },
    access,
  );
  const borrowedId = borrowed.data.entry.id;
  console.log(`  → borrowed ${borrowedId} outstanding=${borrowed.data.entry.outstanding}`);

  // 3. List with filter.
  type ListEnvelope = { entries: Array<{ id: string; status: string; direction: string }> };
  const list = await call<ListEnvelope>('GET', '/ledger?direction=lent', undefined, access);
  console.log(`  → lent entries: ${list.data.entries.length}`);

  // 4. Partial settle on the lent entry — no wallet, so no transaction created.
  const partial = await call<SettleEnvelope>(
    'POST',
    `/ledger/${lentId}/settle`,
    { amount: 1500, date: today },
    access,
  );
  console.log(
    `  → partial settle outstanding=${partial.data.entry.outstanding} status=${partial.data.entry.status} linkedTx=${partial.data.settlement.linkedTransactionId}`,
  );
  if (partial.data.entry.status !== 'partial') {
    throw new Error(`expected partial, got ${partial.data.entry.status}`);
  }

  // 5. Full settle on the lent entry — with walletId, so it creates an income transaction.
  const full = await call<SettleEnvelope>(
    'POST',
    `/ledger/${lentId}/settle`,
    { amount: 2500, date: today, walletId },
    access,
  );
  console.log(
    `  → full settle outstanding=${full.data.entry.outstanding} status=${full.data.entry.status} linkedTx=${full.data.settlement.linkedTransactionId}`,
  );
  if (full.data.entry.status !== 'settled') {
    throw new Error(`expected settled, got ${full.data.entry.status}`);
  }
  if (!full.data.settlement.linkedTransactionId) {
    throw new Error('expected linkedTransactionId after walletId settlement');
  }

  // 6. Wallet balance: 10,000 + 2,500 income = 12,500.
  const w2 = await call<WalletEnvelope>('GET', `/wallets/${walletId}`, undefined, access);
  console.log(`  → wallet balance after lent settlement: ${w2.data.wallet.balance}`);
  if (Math.abs(w2.data.wallet.balance - 12500) > 0.01) {
    throw new Error(`expected balance 12500, got ${w2.data.wallet.balance}`);
  }

  // 7. Pay the borrow back fully → expense on the wallet.
  const paid = await call<SettleEnvelope>(
    'POST',
    `/ledger/${borrowedId}/settle`,
    { amount: 1500, date: today, walletId },
    access,
  );
  console.log(
    `  → borrowed settled outstanding=${paid.data.entry.outstanding} status=${paid.data.entry.status}`,
  );

  const w3 = await call<WalletEnvelope>('GET', `/wallets/${walletId}`, undefined, access);
  console.log(`  → wallet balance after borrow repayment: ${w3.data.wallet.balance}`);
  if (Math.abs(w3.data.wallet.balance - 11000) > 0.01) {
    throw new Error(`expected balance 11000, got ${w3.data.wallet.balance}`);
  }

  // 8. Try to settle again — should reject (already settled).
  const finalRes = await fetch(`${BASE}/ledger/${lentId}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ amount: 100, date: today }),
  });
  if (finalRes.ok) {
    throw new Error('expected re-settle to fail with 400');
  }
  console.log(`  → re-settle rejected with ${finalRes.status} (good)`);

  console.log('\nsmoke-ledger: OK');
}

main().catch((err) => {
  console.error('smoke-ledger: FAILED', err);
  process.exit(1);
});
