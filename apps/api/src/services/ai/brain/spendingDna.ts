/**
 * Spending DNA — per-space behavioural fingerprint.
 *
 * Built from the last 90 days of confirmed transactions and stored as a
 * single JSON blob per space in `spending_dna`.  The DNA is injected into
 * LLM prompts so the model behaves like it knows the user — correctly
 * defaulting to their usual wallet, predicting categories, and suppressing
 * implausible outliers.
 *
 * `rebuildDna()` is cheap (one aggregation query) and is called
 * asynchronously after every confirmed transaction, keeping the profile
 * fresh without blocking the user-facing response.
 *
 * `getDna()` is a fast point-lookup used at prompt-assembly time.
 */
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../../../db/client.ts';
import { spendingDna } from '../../../db/schema/spendingDna.ts';
import { transactions } from '../../../db/schema/transactions.ts';
import { wallets } from '../../../db/schema/wallets.ts';
import { log } from '../../../utils/logger.ts';

export interface DnaProfile {
  preferredWallets: string[];
  topCategories: Array<{ category: string; share: number }>;
  avgAmounts: Record<string, number>;
  commonMerchants: string[];
  transactionCount: number;
}

const EMPTY_DNA: DnaProfile = {
  preferredWallets: [],
  topCategories: [],
  avgAmounts: {},
  commonMerchants: [],
  transactionCount: 0,
};

/** Minimum transactions before DNA is considered meaningful. */
const MIN_TX_COUNT = 5;

/** Look-back window for aggregation. */
const LOOKBACK_DAYS = 90;

/**
 * Return the current DNA profile for a space.
 * Returns an empty profile if no data exists yet.
 */
export async function getDna(spaceId: string): Promise<DnaProfile> {
  try {
    const rows = await db
      .select()
      .from(spendingDna)
      .where(eq(spendingDna.spaceId, spaceId))
      .limit(1);

    if (rows.length === 0) return EMPTY_DNA;
    const row = rows[0]!;
    return {
      preferredWallets: (row.preferredWallets as string[]) ?? [],
      topCategories:
        (row.topCategories as Array<{ category: string; share: number }>) ?? [],
      avgAmounts: (row.avgAmounts as Record<string, number>) ?? {},
      commonMerchants: (row.commonMerchants as string[]) ?? [],
      transactionCount: row.transactionCount,
    };
  } catch (err) {
    log.warn('SPENDING_DNA_GET_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return EMPTY_DNA;
  }
}

/**
 * Rebuild the DNA for a space from the last 90 days of transactions.
 *
 * This is the aggregation engine.  It runs entirely in SQL so it's fast
 * even for users with thousands of transactions.  Fire-and-forget safe.
 */
export async function rebuildDna(spaceId: string): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    // ── 1. Wallet usage frequency ──────────────────────────────────
    const walletRows = await db
      .select({
        walletName: wallets.name,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(transactions)
      .innerJoin(wallets, eq(transactions.walletId, wallets.id))
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          gte(transactions.date, cutoffStr),
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(wallets.name)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(5);

    const preferredWallets = walletRows.map((r) => r.walletName);

    // ── 2. Category distribution ───────────────────────────────────
    const totalTxResult = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          gte(transactions.date, cutoffStr),
          isNull(transactions.deletedAt),
        ),
      );
    const totalTx = Number(totalTxResult[0]?.total ?? 0);

    const catRows = await db
      .select({
        category: transactions.category,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          gte(transactions.date, cutoffStr),
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(transactions.category)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(8);

    const topCategories = catRows
      .filter((r) => r.category)
      .map((r) => ({
        category: r.category!,
        share: totalTx > 0 ? Math.round((Number(r.cnt) / totalTx) * 100) / 100 : 0,
      }));

    // ── 3. Average amount by category ──────────────────────────────
    const avgRows = await db
      .select({
        category: transactions.category,
        avg: sql<string>`AVG(amount::numeric)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          gte(transactions.date, cutoffStr),
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(transactions.category)
      .limit(20);

    const avgAmounts: Record<string, number> = {};
    for (const r of avgRows) {
      if (r.category) avgAmounts[r.category] = Math.round(Number(r.avg));
    }

    // ── 4. Common merchant/description tokens ──────────────────────
    const descRows = await db
      .select({ description: transactions.description })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          gte(transactions.date, cutoffStr),
          isNull(transactions.deletedAt),
        ),
      )
      .orderBy(sql`created_at DESC`)
      .limit(200);

    const tokenFreq = new Map<string, number>();
    for (const r of descRows) {
      const tokens = r.description
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3 && t.length <= 20);
      for (const t of tokens) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
    }
    const commonMerchants = [...tokenFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([t]) => t);

    // ── 5. Upsert ──────────────────────────────────────────────────
    await db
      .insert(spendingDna)
      .values({
        spaceId,
        preferredWallets,
        topCategories,
        avgAmounts,
        commonMerchants,
        transactionCount: totalTx,
        lastUpdatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: spendingDna.spaceId,
        set: {
          preferredWallets,
          topCategories,
          avgAmounts,
          commonMerchants,
          transactionCount: totalTx,
          lastUpdatedAt: new Date(),
        },
      });

    log.info('SPENDING_DNA_REBUILT', { spaceId, totalTx, categories: topCategories.length });
  } catch (err) {
    log.warn('SPENDING_DNA_REBUILD_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}

/**
 * Build a short, natural-language summary of the DNA suitable for
 * injection into the LLM system prompt (≤ 3 lines).
 *
 * Only included when `transactionCount >= MIN_TX_COUNT` — a fresh space
 * with no history gets no DNA injection so defaults don't skew parses.
 */
export function dnaToPriorHint(dna: DnaProfile): string | null {
  if (dna.transactionCount < MIN_TX_COUNT) return null;

  const lines: string[] = [];

  if (dna.preferredWallets.length > 0) {
    lines.push(`User's usual payment methods (most → least used): ${dna.preferredWallets.slice(0, 3).join(', ')}.`);
  }

  if (dna.topCategories.length > 0) {
    const cats = dna.topCategories
      .slice(0, 4)
      .map((c) => c.category)
      .join(', ');
    lines.push(`Most frequent spending categories: ${cats}.`);
  }

  if (dna.commonMerchants.length > 0) {
    lines.push(`Common merchants/items: ${dna.commonMerchants.slice(0, 8).join(', ')}.`);
  }

  return lines.length > 0
    ? `USER SPENDING PROFILE (use as soft prior, not hard rule):\n${lines.join('\n')}`
    : null;
}
