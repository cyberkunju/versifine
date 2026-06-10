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

/**
 * 6-character undo-token alphabet — alphanumeric, BUT excludes ambiguous
 * glyphs (0/O, 1/I/l) so a user reading the token from a text bubble and
 * typing it back doesn't confuse them.
 *
 * Tokens are GUARANTEED to contain at least one digit and at least one
 * letter (see generateToken). This is what lets the bot's bare-token
 * detector require a digit — which eliminates every English-word false
 * positive ("BUDGET" is all-letters → never mistaken for a token).
 */
const TOKEN_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const TOKEN_DIGITS = '23456789';
const TOKEN_ALL = TOKEN_LETTERS + TOKEN_DIGITS;
const TOKEN_LEN = 6;

function pick(alphabet: string, rnd: number): string {
  return alphabet[rnd % alphabet.length]!;
}

function generateToken(): string {
  const buf = crypto.getRandomValues(new Uint8Array(TOKEN_LEN + 2));
  // Build 6 random chars, then FORCE at least one digit and one letter so
  // every emitted token is unambiguously a token (the bot requires a digit).
  const chars: string[] = [];
  for (let i = 0; i < TOKEN_LEN; i += 1) chars.push(pick(TOKEN_ALL, buf[i]!));
  // Force a digit at a random position and a letter at another (distinct).
  const digitPos = buf[TOKEN_LEN]! % TOKEN_LEN;
  chars[digitPos] = pick(TOKEN_DIGITS, buf[TOKEN_LEN + 1]!);
  let letterPos = (digitPos + 1) % TOKEN_LEN;
  // If by chance the forced-letter slot is the digit slot, shift it.
  if (letterPos === digitPos) letterPos = (digitPos + 2) % TOKEN_LEN;
  // Only overwrite with a letter if that slot isn't already a letter.
  if (!TOKEN_LETTERS.includes(chars[letterPos]!)) {
    chars[letterPos] = pick(TOKEN_LETTERS, buf[0]!);
  }
  return chars.join('');
}

/**
 * Append a mutation row + return the user-facing undo token. Pass a tx
 * handle to record atomically with the change. The token is unique within
 * the user's space (paired index), generated with retry-on-collision —
 * we only retry up to 5 times because a single collision in 887M is
 * already unlikely; 5 retries take it below astronomical.
 */
export async function recordMutation(
  dbh: Db | DbTx,
  m: RecordMutationInput,
): Promise<{ token: string }> {
  let token = generateToken();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await dbh.insert(transactionMutations).values({
        spaceId: m.spaceId,
        userId: m.userId,
        transactionId: m.transactionId,
        action: m.action,
        token,
        before: m.before ?? null,
        after: m.after ?? null,
        source: m.source ?? null,
      });
      return { token };
    } catch (err) {
      // Postgres unique-violation code is 23505. The token index is the only
      // unique constraint that could collide here — retry with a fresh token.
      const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code
        ?? (err as { code?: string })?.code;
      if (code === '23505' && attempt < 4) {
        token = generateToken();
        continue;
      }
      throw err;
    }
  }
  // Unreachable in practice — the loop above either returns or throws.
  return { token };
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
  return await db.transaction(async (tx) => {
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
    return await reverseMutationRow(tx, m, spaceId);
  });
}

/**
 * Reverse a SPECIFIC mutation by its user-facing token (L2-2). The user types
 * the 6-char token from any prior reply ("undo K7P2A9") to reverse THAT exact
 * mutation — not just the most recent. Returns:
 *   • UndoResult on success,
 *   • 'not_found' when no live mutation matches the token in this space,
 *   • 'already_undone' when the token's mutation was already reversed.
 * Scoped to the space so a token can't reverse another user's entry.
 */
export async function undoMutationByToken(
  spaceId: string,
  token: string,
): Promise<UndoResult | 'not_found' | 'already_undone'> {
  const normalized = token.trim().toUpperCase();
  return await db.transaction(async (tx) => {
    // FOR UPDATE row-lock: two concurrent undos of the same token (double-tap,
    // retried webhook) would both pass a plain SELECT under READ COMMITTED and
    // double-reverse. The lock serialises them — the second waits, then sees
    // undoneAt set and returns 'already_undone'.
    const [m] = await tx
      .select()
      .from(transactionMutations)
      .where(
        and(
          eq(transactionMutations.spaceId, spaceId),
          eq(transactionMutations.token, normalized),
        ),
      )
      .for('update')
      .limit(1);
    if (!m) return 'not_found';
    if (m.undoneAt) return 'already_undone';
    const result = await reverseMutationRow(tx, m, spaceId);
    return result ?? 'not_found';
  });
}

/**
 * Reverse a single (already-selected, not-yet-undone) mutation row inside an
 * open transaction. Marks it undone and replays the snapshot in the opposite
 * direction. Shared by `undoLastMutation` (recency) and `undoMutationByToken`
 * (explicit). Returns the UndoResult, or null when the underlying row is gone.
 */
async function reverseMutationRow(
  tx: DbTx,
  m: typeof transactionMutations.$inferSelect,
  spaceId: string,
): Promise<UndoResult | null> {
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
}
