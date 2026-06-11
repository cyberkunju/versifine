/**
 * Live DB smoke for the FX resolution worker.
 *
 * Reproduces the outage corruption in a THROWAWAY space, runs the worker, and
 * asserts the row self-heals — then deletes everything it created. Run on the
 * box where the DB + FX provider are reachable:
 *
 *   bun run apps/api/scripts/smoke-fx-resolve.ts
 *
 * Exits non-zero on any assertion failure so it can gate a deploy smoke.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { spaces } from '../src/db/schema/spaces.ts';
import { wallets } from '../src/db/schema/wallets.ts';
import { transactions } from '../src/db/schema/transactions.ts';
import { resolvePendingFx } from '../src/services/fx/resolveWorker.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`✓ ${msg}`);
}

async function main(): Promise<void> {
  // 1) Throwaway INR space + wallet.
  const [space] = await db
    .insert(spaces)
    .values({ name: '__fx_smoke__', type: 'personal', baseCurrency: 'INR' })
    .returning({ id: spaces.id });
  const spaceId = space!.id;
  const [wallet] = await db
    .insert(wallets)
    .values({ spaceId, name: '__fx_smoke_wallet__', type: 'cash', currency: 'INR' })
    .returning({ id: wallets.id });
  const walletId = wallet!.id;

  // 2) The outage state: 5 OMR booked at 1:1 → baseAmount 5, flag set.
  const [txn] = await db
    .insert(transactions)
    .values({
      spaceId,
      walletId,
      type: 'expense',
      amount: '5.00',
      currency: 'OMR',
      baseAmount: '5.00',
      fxRate: '1.00000000',
      description: 'fx smoke coffee',
      date: new Date().toISOString().slice(0, 10),
      source: 'omnibar',
      needsFxResolution: true,
    })
    .returning({ id: transactions.id });
  const txnId = txn!.id;
  console.log(`seeded txn ${txnId} in space ${spaceId} (OMR 5 booked as ₹5)`);

  try {
    // 3) Run the worker — SCOPED to our throwaway space so it can never touch
    //    unrelated production rows that happen to be FX-pending.
    const result = await resolvePendingFx(50, { spaceId });
    console.log('resolvePendingFx →', result);
    assert(result.resolved >= 1, 'worker resolved at least one row');

    // 4) Re-read and assert it healed.
    const [after] = await db
      .select({
        baseAmount: transactions.baseAmount,
        fxRate: transactions.fxRate,
        needsFxResolution: transactions.needsFxResolution,
      })
      .from(transactions)
      .where(eq(transactions.id, txnId))
      .limit(1);
    assert(!!after, 'row still exists');
    assert(after!.needsFxResolution === false, 'needsFxResolution cleared');
    const base = Number(after!.baseAmount);
    assert(base > 50, `baseAmount re-converted to real INR (got ₹${base}, was ₹5)`);
    assert(Number(after!.fxRate) > 1, `fxRate updated to a real OMR→INR rate (got ${after!.fxRate})`);
  } finally {
    // 5) Cleanup — hard delete the throwaway rows (txn → wallet → space).
    await db.delete(transactions).where(eq(transactions.id, txnId));
    await db.delete(wallets).where(and(eq(wallets.id, walletId), eq(wallets.spaceId, spaceId)));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    console.log('cleaned up throwaway space/wallet/txn');
  }

  if (process.exitCode && process.exitCode !== 0) {
    console.error('FX smoke FAILED');
  } else {
    console.log('FX smoke PASSED');
  }
}

main()
  .catch((err) => {
    console.error('FX smoke ERROR:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Let the process exit; the worker timer (if any) is unref'd, but this
    // script never starts it.
    setTimeout(() => process.exit(process.exitCode ?? 0), 100);
  });
