/**
 * Transaction mutation log — audit trail + the undo engine.
 *
 * `recordMutation` appends one row per state change (create / update / delete)
 * with before/after snapshots. `undoLastMutation` reverses a user's most recent
 * non-undone mutation atomically, replaying the snapshot in the opposite
 * direction, and marks it `undoneAt` so the stack walks to the prior action.
 *
 * Snapshots store the DB-native column values (numeric amounts as strings, the
 * ISO date string) so a restore is byte-for-byte faithful — including the
 * original FX rate baked into `baseAmount`.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, type Db, type DbTx } from '../../db/client.ts';
import { transactions, type Transaction } from '../../db/schema/transactions.ts';
import { transactionMutations } from '../../db/schema/mutations.ts';

export type MutationAction = 'create' | 'update' | 'delete';

/** The transaction fields an undo needs to restore exactly. */
export interface TxSnapshot {
  amount: string;
  baseAmount: string;
  currency: string;
  category: string | null;
  categoryConfidence: string | null;
  categorizedBy: Transaction['categorizedBy'];
  description: string;
  date: string;
  walletId: string;
  notes: string | null;
  tags: string[];
  type: string;
}

export function snapshotTx(row: Transaction): TxSnapshot {
  return {
    amount: row.amount,
    baseAmount: row.baseAmount,
    currency: row.currency,
    category: row.category,
    categoryConfidence: row.categoryConfidence,
    categorizedBy: row.categorizedBy,
    description: row.description,
    date: row.date,
    walletId: row.walletId,
    notes: row.notes ?? null,
    tags: row.tags ?? [],
    type: row.type,
  };
}

export interface RecordMutationInput {
  spaceId: string;
  userId: string;
  transactionId: string;
  action: MutationAction;
  before?: TxSnapshot | null;
  after?: TxSnapshot | null;
  source?: string | null;
}

/** Append a mutation row. Pass a tx handle to record atomically with the change. */
export async function recordMutation(dbh: Db | DbTx, m: RecordMutationInput): Promise<void> {
  await dbh.insert(transactionMutations).values({
    spaceId: m.spaceId,
    userId: m.userId,
    transactionId: m.transactionId,
    action: m.action,
    before: m.before ?? null,
    after: m.after ?? null,
    source: m.source ?? null,
  });
}

export interface UndoResult {
  /** What kind of change was reversed. */
  reversed: MutationAction;
  /** User-facing summary of the entry after the undo. */
  transaction: {
    id: string;
    amount: number;
    currency: string;
    category: string | null;
    description: string;
  };
  /** Category to recompute budgets for. */
  affectedCategory: string | null;
}

/**
 * Reverse the user's most recent non-undone mutation. Returns null when there
 * is nothing to undo (no mutations, or the row was hard-deleted out from under
 * us). Atomic: selects + reverses + marks undone in one DB transaction.
 */
export async function undoLastMutation(
  userId: string,
  spaceId: string,
): Promise<UndoResult | null> {
  const result = await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(transactionMutations)
      .where(
        and(
          eq(transactionMutations.spaceId, spaceId),
          eq(transactionMutations.userId, userId),
          isNull(transactionMutations.undoneAt),
        ),
      )
      .orderBy(desc(transactionMutations.createdAt))
      .limit(1);
    if (!m) return null;

    const [row] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, m.transactionId), eq(transactions.spaceId, spaceId)))
      .limit(1);

    // Always consume the mutation so a missing/odd row can't wedge the stack.
    await tx
      .update(transactionMutations)
      .set({ undoneAt: new Date() })
      .where(eq(transactionMutations.id, m.id));

    if (!row) return null;

    const now = new Date();
    let restored: Transaction = row;

    if (m.action === 'create') {
      // Reverse a create → soft-delete the row.
      const [r] = await tx
        .update(transactions)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(transactions.id, row.id))
        .returning();
      if (r) restored = r;
    } else if (m.action === 'delete') {
      // Reverse a delete → bring it back.
      const [r] = await tx
        .update(transactions)
        .set({ deletedAt: null, updatedAt: now })
        .where(eq(transactions.id, row.id))
        .returning();
      if (r) restored = r;
    } else {
      // Reverse an update → restore the BEFORE snapshot.
      const before = m.before as TxSnapshot | null;
      if (!before) return null;
      const [r] = await tx
        .update(transactions)
        .set({
          amount: before.amount,
          baseAmount: before.baseAmount,
          currency: before.currency,
          category: before.category,
          categoryConfidence: before.categoryConfidence,
          categorizedBy: before.categorizedBy,
          description: before.description,
          date: before.date,
          walletId: before.walletId,
          notes: before.notes,
          tags: before.tags,
          updatedAt: now,
        })
        .where(eq(transactions.id, row.id))
        .returning();
      if (r) restored = r;
    }

    return {
      reversed: m.action as MutationAction,
      transaction: {
        id: restored.id,
        amount: Number(restored.amount),
        currency: restored.currency,
        category: restored.category,
        description: restored.description,
      },
      affectedCategory: restored.category,
    } satisfies UndoResult;
  });

  return result;
}
