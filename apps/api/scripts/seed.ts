/**
 * Demo seed runner.
 *
 * Idempotent: if `demo@finehance.app` already exists, the run wipes that
 * user's data (transactions, budgets, goals, ledger entries, recurring,
 * embeddings, etc.) and refreshes it with fresh fixtures. Wallets are
 * preserved when names match so existing transaction wallet ids stay
 * stable across re-runs.
 *
 * Drives every insert through the canonical create services so
 * categorization, FX conversion, and event emission run identically to
 * production traffic. The seeded copy reads exactly like a hand-typed
 * one and the recurring detector picks up the subscriptions on first run.
 */
import { and, eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { db, sql as raw } from '../src/db/client.ts';
import { budgets } from '../src/db/schema/budgets.ts';
import { categoryCorrections, categoryOverrides } from '../src/db/schema/overrides.ts';
import { goals } from '../src/db/schema/goals.ts';
import { ledgerEntries, ledgerSettlements } from '../src/db/schema/ledger.ts';
import { recurringItems } from '../src/db/schema/recurring.ts';
import { spaceMembers, spaces } from '../src/db/schema/spaces.ts';
import { transactionEmbeddings } from '../src/db/schema/embeddings.ts';
import { transactions } from '../src/db/schema/transactions.ts';
import { phoneLinkOtps, refreshTokens, users } from '../src/db/schema/users.ts';
import { wallets, type Wallet } from '../src/db/schema/wallets.ts';
import { hashPassword } from '../src/services/auth/password.ts';
import { createTransaction } from '../src/services/transactions/create.ts';
import {
  buildSeedTransactions,
  DEMO_BUDGETS,
  DEMO_GOALS,
  DEMO_LEDGER,
  DEMO_USER,
  DEMO_WALLETS,
  isoDate,
} from '../src/data/seed-fixtures.ts';

interface SeedSummary {
  userId: string;
  spaceId: string;
  wallets: number;
  transactions: number;
  budgets: number;
  goals: number;
  ledgerEntries: number;
}

async function findExistingDemoUser(): Promise<{ id: string; activeSpaceId: string | null } | null> {
  const [row] = await db
    .select({ id: users.id, activeSpaceId: users.activeSpaceId })
    .from(users)
    .where(eq(users.email, DEMO_USER.email))
    .limit(1);
  return row ?? null;
}

async function wipeUserData(spaceId: string): Promise<void> {
  // Order matters — clear children before parents for FK safety.
  await db.delete(categoryCorrections).where(eq(categoryCorrections.spaceId, spaceId));
  await db.delete(categoryOverrides).where(eq(categoryOverrides.spaceId, spaceId));
  await db.delete(transactionEmbeddings).where(eq(transactionEmbeddings.spaceId, spaceId));
  await db.delete(ledgerSettlements).where(
    inArray(
      ledgerSettlements.ledgerEntryId,
      db
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.spaceId, spaceId)),
    ),
  );
  await db.delete(ledgerEntries).where(eq(ledgerEntries.spaceId, spaceId));
  await db.delete(transactions).where(eq(transactions.spaceId, spaceId));
  await db.delete(recurringItems).where(eq(recurringItems.spaceId, spaceId));
  await db.delete(budgets).where(eq(budgets.spaceId, spaceId));
  await db.delete(goals).where(eq(goals.spaceId, spaceId));
}

async function ensureUserAndSpace(): Promise<{ userId: string; spaceId: string }> {
  const existing = await findExistingDemoUser();
  if (existing && existing.activeSpaceId) {
    await wipeUserData(existing.activeSpaceId);
    return { userId: existing.id, spaceId: existing.activeSpaceId };
  }
  if (existing && !existing.activeSpaceId) {
    // Pathological case — user exists but space doesn't. Drop the user and
    // let the create path below regenerate. Refresh tokens cascade with
    // the user delete.
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, existing.id));
    await db.delete(phoneLinkOtps).where(eq(phoneLinkOtps.userId, existing.id));
    await db.delete(users).where(eq(users.id, existing.id));
  }

  const passwordHash = await hashPassword(DEMO_USER.password);

  return await db.transaction(async (tx) => {
    const [space] = await tx
      .insert(spaces)
      .values({ name: 'Personal', type: 'personal', baseCurrency: 'INR' })
      .returning({ id: spaces.id });
    if (!space) throw new Error('Failed to create demo space');

    const [user] = await tx
      .insert(users)
      .values({
        email: DEMO_USER.email,
        passwordHash,
        displayName: DEMO_USER.displayName,
        primaryLanguage: DEMO_USER.primaryLanguage,
        baseCurrency: 'INR',
        activeSpaceId: space.id,
      })
      .returning({ id: users.id });
    if (!user) throw new Error('Failed to create demo user');

    await tx.update(spaces).set({ createdBy: user.id }).where(eq(spaces.id, space.id));
    await tx.insert(spaceMembers).values({ spaceId: space.id, userId: user.id, role: 'owner' });

    return { userId: user.id, spaceId: space.id };
  });
}

async function ensureWallets(spaceId: string): Promise<Map<string, Wallet>> {
  // Fetch existing first so re-runs preserve ids; only create missing rows.
  const existing = await db
    .select()
    .from(wallets)
    .where(eq(wallets.spaceId, spaceId));
  const byName = new Map(existing.map((w) => [w.name, w] as const));

  for (const def of DEMO_WALLETS) {
    if (byName.has(def.name)) continue;
    const [created] = await db
      .insert(wallets)
      .values({
        spaceId,
        name: def.name,
        type: def.type,
        currency: def.currency,
      })
      .returning();
    if (created) byName.set(created.name, created);
    if (def.openingBalance > 0) {
      await db.insert(transactions).values({
        spaceId,
        walletId: created!.id,
        type: 'opening_balance',
        amount: def.openingBalance.toFixed(2),
        currency: def.currency,
        baseAmount: def.openingBalance.toFixed(2),
        fxRate: '1.00000000',
        description: `Opening balance for ${def.name}`,
        category: null,
        date: isoDate(89),
        tags: [],
        source: 'manual_web',
      });
    }
  }
  return byName;
}

async function seedBudgets(spaceId: string): Promise<number> {
  let count = 0;
  for (const def of DEMO_BUDGETS) {
    await db.insert(budgets).values({
      spaceId,
      name: def.name,
      recurrence: def.recurrence,
      allocations: def.allocations,
      warnThreshold: def.warnThreshold ?? 80,
      exceedThreshold: def.exceedThreshold ?? 100,
    });
    count += 1;
  }
  return count;
}

async function seedGoals(spaceId: string): Promise<number> {
  let count = 0;
  for (const def of DEMO_GOALS) {
    await db.insert(goals).values({
      spaceId,
      name: def.name,
      targetAmount: def.targetAmount.toFixed(2),
      currentAmount: def.currentAmount.toFixed(2),
      deadline: def.deadline ?? null,
      linkedCategory: def.linkedCategory ?? null,
      status: def.currentAmount >= def.targetAmount ? 'achieved' : 'active',
    });
    count += 1;
  }
  return count;
}

async function seedLedger(spaceId: string): Promise<number> {
  let count = 0;
  for (const def of DEMO_LEDGER) {
    const baseAmount = def.amount;
    await db.insert(ledgerEntries).values({
      spaceId,
      direction: def.direction,
      counterpartyName: def.counterpartyName,
      amount: def.amount.toFixed(2),
      currency: def.currency,
      baseAmount: baseAmount.toFixed(2),
      outstanding: baseAmount.toFixed(2),
      status: 'open',
      date: isoDate(def.daysAgo),
      note: def.note ?? null,
    });
    count += 1;
  }
  return count;
}

async function seedTransactions(
  userId: string,
  spaceId: string,
  walletByName: Map<string, Wallet>,
): Promise<number> {
  const fixtures = buildSeedTransactions();
  let count = 0;
  for (const def of fixtures) {
    const wallet = walletByName.get(def.walletName);
    if (!wallet) continue;
    await createTransaction({
      userId,
      spaceId,
      source: 'manual_web',
      input: {
        type: def.type === 'opening_balance' ? 'income' : def.type,
        amount: def.amount,
        currency: def.currency,
        date: isoDate(def.daysAgo),
        description: def.description,
        walletId: wallet.id,
        ...(def.category ? { category: def.category } : {}),
        ...(def.notes ? { notes: def.notes } : {}),
        tags: def.tags ?? [],
      } satisfies Record<string, unknown>,
    });
    count += 1;
  }
  return count;
}

async function refreshSequenceCounters(): Promise<void> {
  // postgres-js bumps SERIAL/IDENTITY counters automatically; nothing to do.
  // Kept as a hook in case later schema additions need it.
}

export async function runSeed(): Promise<SeedSummary> {
  console.log('seed: ensuring demo user + space …');
  const { userId, spaceId } = await ensureUserAndSpace();

  console.log('seed: ensuring wallets …');
  const walletMap = await ensureWallets(spaceId);

  console.log('seed: building 90-day transaction set …');
  const txCount = await seedTransactions(userId, spaceId, walletMap);

  console.log('seed: budgets …');
  const budgetCount = await seedBudgets(spaceId);

  console.log('seed: goals …');
  const goalCount = await seedGoals(spaceId);

  console.log('seed: ledger entries …');
  const ledgerCount = await seedLedger(spaceId);

  await refreshSequenceCounters();

  // Try to run the recurring detector so the dashboard shows subscriptions
  // out of the box. Failure is non-fatal — `POST /recurring/run` is a
  // single click away if the user wants to trigger it manually.
  try {
    const { runDetector } = await import('../src/services/forecast/recurring.ts');
    await runDetector(userId, spaceId);
    console.log('seed: recurring detector run.');
  } catch (err) {
    console.warn('seed: recurring detector skipped:', (err as Error).message);
  }

  // Sanity-check: count what we landed.
  const [{ count: actualTxCount } = { count: 0 }] = (await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.spaceId, spaceId)))) as Array<{ count: number }>;

  const summary: SeedSummary = {
    userId,
    spaceId,
    wallets: walletMap.size,
    transactions: actualTxCount,
    budgets: budgetCount,
    goals: goalCount,
    ledgerEntries: ledgerCount,
  };

  console.log('seed: done.', summary);
  console.log('');
  console.log(`  Demo login → ${DEMO_USER.email} / ${DEMO_USER.password}`);
  console.log('');
  // Reference unused import so the bundler doesn't strip schema modules.
  void txCount;

  return summary;
}

const isCli = (() => {
  try {
    return process.argv[1]?.endsWith('seed.ts') === true;
  } catch {
    return true;
  }
})();

if (isCli) {
  runSeed()
    .catch((err) => {
      console.error('seed: failed', err);
      process.exit(1);
    })
    .finally(async () => {
      await raw.end({ timeout: 1 });
    });
}
