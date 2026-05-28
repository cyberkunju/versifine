/**
 * Per-space overrides — tier 1 of the categorizer.
 *
 * When a user corrects a transaction, we upsert a row keyed by
 * `(space_id, merchant_normalized)`. From that point on, every transaction
 * with the same normalized merchant in that space gets the corrected
 * label with confidence 1.0 and `categorizedBy: 'overrides'`.
 *
 * The `occurrences` counter is bumped on every upsert so a future ranking
 * step can prefer well-trodden mappings if we ever introduce conflict
 * resolution. The `updated_at` column doubles as a last-touch indicator
 * for cache invalidation.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { categoryOverrides } from '../../db/schema/overrides.ts';

export interface OverrideHit {
  category: string;
}

/**
 * Look up a single override. Returns null when no row exists for this
 * (space, merchant) pair. The unique index on (space_id, merchant_normalized)
 * guarantees at most one match.
 */
export async function getOverride(
  spaceId: string,
  normalizedMerchant: string,
): Promise<OverrideHit | null> {
  if (!normalizedMerchant) return null;
  const [row] = await db
    .select({ category: categoryOverrides.category })
    .from(categoryOverrides)
    .where(
      and(
        eq(categoryOverrides.spaceId, spaceId),
        eq(categoryOverrides.merchantNormalized, normalizedMerchant),
      ),
    )
    .limit(1);
  return row ? { category: row.category } : null;
}

/**
 * Idempotent upsert. On conflict we replace the category (the user's most
 * recent correction wins) and bump occurrences + updated_at. The `numeric(6,0)`
 * column type returns/accepts strings via Drizzle, hence the `+ 1` lives in
 * SQL rather than JS.
 */
export async function upsertOverride(
  spaceId: string,
  normalizedMerchant: string,
  category: string,
): Promise<void> {
  if (!normalizedMerchant) return;
  await db
    .insert(categoryOverrides)
    .values({
      spaceId,
      merchantNormalized: normalizedMerchant,
      category,
      occurrences: '1',
    })
    .onConflictDoUpdate({
      target: [categoryOverrides.spaceId, categoryOverrides.merchantNormalized],
      set: {
        category: sql`excluded.category`,
        occurrences: sql`${categoryOverrides.occurrences} + 1`,
        updatedAt: sql`now()`,
      },
    });
}
