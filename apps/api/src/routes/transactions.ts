/**
 * Transaction routes.
 *
 *   GET    /transactions               filtered list with pagination
 *   POST   /transactions               manual create (web omnibar fallback path)
 *   GET    /transactions/:id           single
 *   PATCH  /transactions/:id           partial update + category-correction
 *   DELETE /transactions/:id           soft delete
 *   POST   /transactions/:id/category  explicit category correction
 *   POST   /transactions/import        CSV bulk import
 *   GET    /transactions/export        CSV stream
 *
 * Every read filters by `space_id` and excludes soft-deleted rows by default.
 * On any state-changing request we emit the matching WS event.
 */
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  CATEGORIES,
  type Category,
  isCategory,
  transactionCreateInput,
  transactionUpdateInput,
} from '@versifine/shared';
import { db } from '../db/client.ts';
import { categoryCorrections } from '../db/schema/overrides.ts';
import { transactions } from '../db/schema/transactions.ts';
import { wallets } from '../db/schema/wallets.ts';
import { requireUserOrBot } from '../middleware/authEither.ts';
import { recomputeAffectedBudgets } from '../services/budgets/index.ts';
import { safeNormalizeMerchant, safeUpsertOverride } from '../services/categorize/_safe.ts';
import { emit } from '../services/events/bus.ts';
import { getRate } from '../services/fx/client.ts';
import { createTransaction, emitCreated } from '../services/transactions/create.ts';
import { recordMutation, snapshotTx, undoLastMutation } from '../services/transactions/mutations.ts';
import {
  getTransactionById,
  listTransactions,
  serializeTransaction,
} from '../services/transactions/query.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';

const app = new Hono();
app.use('*', requireUserOrBot);

app.get('/', async (c) => {
  const u = c.get('user');
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const result = await listTransactions(u.activeSpaceId, query);
  return c.json(ok(result));
});

app.post('/', zValidator('json', transactionCreateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await createTransaction({
    userId: u.id,
    spaceId: u.activeSpaceId,
    source: 'manual_web',
    input: body,
  });
  return c.json(ok({ transaction: serializeTransaction(row) }), 201);
});

app.get('/export', async (c) => {
  const u = c.get('user');
  const url = new URL(c.req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  // Pull a wide window in one go — for the demo dataset 5000 rows is plenty.
  const result = await listTransactions(u.activeSpaceId, { ...params, limit: '5000', offset: '0' });
  const csv = toCsv(result.items);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="transactions-${Date.now()}.csv"`,
    },
  });
});

app.post('/import', async (c) => {
  const u = c.get('user');
  const contentType = c.req.header('content-type') ?? '';
  let csvText = '';
  if (contentType.startsWith('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw errors.validation('Missing file field');
    csvText = await file.text();
  } else if (contentType.startsWith('text/csv') || contentType.startsWith('application/csv')) {
    csvText = await c.req.text();
  } else {
    csvText = await c.req.text();
  }

  const records = parseCsv(csvText);
  if (records.length === 0) throw errors.validation('CSV has no rows');

  const walletByName = await loadWalletsByName(u.activeSpaceId);
  const importedIds: string[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i] as Record<string, string>;
    try {
      const candidate = mapCsvRow(rec, walletByName);
      const row = await createTransaction({
        userId: u.id,
        spaceId: u.activeSpaceId,
        source: 'csv_import',
        input: { ...candidate } as unknown as Record<string, unknown>,
      });
      importedIds.push(row.id);
    } catch (err) {
      skipped.push({
        row: i + 2, // +1 for header, +1 for 1-indexing
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return c.json(
    ok({
      imported: importedIds.length,
      skipped: skipped.length,
      errors: skipped,
    }),
  );
});

app.get('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const row = await getTransactionById(u.activeSpaceId, id);
  if (!row) throw errors.notFound('Transaction not found');
  return c.json(ok({ transaction: serializeTransaction(row) }));
});

app.patch('/:id', zValidator('json', transactionUpdateInput), async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await getTransactionById(u.activeSpaceId, id);
  if (!existing) throw errors.notFound('Transaction not found');

  // If walletId changes, confirm new wallet belongs to space.
  if (body.walletId && body.walletId !== existing.walletId) {
    const [w] = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(and(eq(wallets.id, body.walletId), eq(wallets.spaceId, u.activeSpaceId)))
      .limit(1);
    if (!w) throw errors.validation('Wallet not in this space');
  }

  const changedFields: string[] = [];
  const updates: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
  for (const key of Object.keys(body) as (keyof typeof body)[]) {
    if (body[key] === undefined) continue;
    changedFields.push(key);
  }

  // The wallet IS the row's base-currency boundary (createTransaction uses the
  // destination wallet's currency as the base for FX conversion). When the
  // user changes amount OR currency we recompute baseAmount so reports stay
  // correct — fetching a fresh FX rate ONLY when the currency actually flips.
  const targetWalletId = body.walletId ?? existing.walletId;
  const [targetWallet] = await db
    .select({ id: wallets.id, currency: wallets.currency })
    .from(wallets)
    .where(and(eq(wallets.id, targetWalletId), eq(wallets.spaceId, u.activeSpaceId)))
    .limit(1);
  const baseCcy = (targetWallet?.currency ?? 'INR').toUpperCase();
  const oldAmount = Number(existing.amount);
  const oldCurrency = (existing.currency ?? baseCcy).toUpperCase();
  const newCurrency = body.currency ? body.currency.toUpperCase() : oldCurrency;
  const newAmount = body.amount !== undefined ? body.amount : oldAmount;

  if (body.amount !== undefined) updates.amount = body.amount.toFixed(2);
  if (body.currency !== undefined) updates.currency = body.currency;

  if (body.amount !== undefined || body.currency !== undefined) {
    if (newCurrency === baseCcy) {
      // Same-currency: amount equals baseAmount; rate is identity.
      updates.baseAmount = newAmount.toFixed(2);
      updates.fxRate = '1.00000000';
    } else if (body.currency !== undefined) {
      // Currency changed: must fetch a fresh rate (the old fxRate was for the
      // OLD currency pair). FX outage is non-fatal: degrade to identity and
      // log so the row stays editable; the user can correct again later.
      let fxRate = 1;
      try {
        fxRate = await getRate(newCurrency, baseCcy);
      } catch (err) {
        log.warn('FX_PATCH_FALLBACK', {
          transactionId: id,
          from: newCurrency,
          to: baseCcy,
          error: err instanceof Error ? err.message : String(err),
        });
        fxRate = 1;
      }
      updates.baseAmount = (newAmount * fxRate).toFixed(2);
      updates.fxRate = fxRate.toFixed(8);
    } else {
      // Amount only changed — preserve the existing FX rate so the row's
      // historical conversion is unchanged.
      const rate = oldAmount > 0 ? Number(existing.baseAmount) / oldAmount : 1;
      updates.baseAmount = (newAmount * rate).toFixed(2);
    }
  }
  if (body.date !== undefined) updates.date = body.date;
  if (body.description !== undefined) updates.description = body.description;
  if (body.walletId !== undefined) updates.walletId = body.walletId;
  if (body.notes !== undefined) updates.notes = body.notes ?? null;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.category !== undefined) {
    updates.category = body.category;
    updates.categoryConfidence = '1.00';
    updates.categorizedBy = 'user';
  }

  // ATOMIC: take the existing snapshot, apply the update, AND record the audit
  // mutation inside ONE DB transaction so a partial failure can never leave the
  // ledger mutated without an audit row (the invariant the gate relies on).
  // Side effects (events, budget recompute, category-override learning) only
  // run AFTER successful commit.
  const txResult = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(transactions)
      .set(updates)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.spaceId, u.activeSpaceId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning();
    if (!updated) throw errors.internal('Update failed');

    await recordMutation(tx, {
      spaceId: u.activeSpaceId,
      userId: u.id,
      transactionId: updated.id,
      action: 'update',
      before: snapshotTx(existing),
      after: snapshotTx(updated),
      source: c.req.header('x-bot-secret') ? 'whatsapp_correction' : 'manual_web',
    });
    return updated;
  });
  const updated = txResult;

  if (body.category && body.category !== existing.category) {
    await recordCategoryCorrection(
      u.activeSpaceId,
      updated.id,
      existing.category,
      body.category,
      updated.description,
    );
  }

  emit(u.id, {
    type: 'transaction.updated',
    entityId: updated.id,
    data: { transactionId: updated.id, changedFields },
  });
  void recomputeAffectedBudgets(u.id, u.activeSpaceId, updated.category ?? existing.category);

  return c.json(ok({ transaction: serializeTransaction(updated) }));
});

app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');

  // ATOMIC: snapshot, soft-delete, and record audit mutation in ONE DB
  // transaction so a delete is never silent (no audit row) on partial failure.
  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.spaceId, u.activeSpaceId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return null;

    const [row] = await tx
      .update(transactions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(transactions.id, existing.id))
      .returning();
    if (!row) return null;

    await recordMutation(tx, {
      spaceId: u.activeSpaceId,
      userId: u.id,
      transactionId: row.id,
      action: 'delete',
      before: snapshotTx(existing),
      source: c.req.header('x-bot-secret') ? 'whatsapp_delete' : 'manual_web',
    });
    return row;
  });

  if (!txResult) throw errors.notFound('Transaction not found');

  emit(u.id, {
    type: 'transaction.deleted',
    entityId: id,
    data: { transactionId: id },
  });
  void recomputeAffectedBudgets(u.id, u.activeSpaceId, txResult.category);
  return c.json(ok({ deleted: true }));
});

/**
 * Undo the user's most recent mutation (create → remove, update → revert,
 * delete → restore). Powers the universal "undo" / "oops" command. Returns
 * { undone: false } when there's nothing to reverse.
 */
app.post('/undo', async (c) => {
  const u = c.get('user');
  const result = await undoLastMutation(u.id, u.activeSpaceId);
  if (!result) return c.json(ok({ undone: false }));
  // Reverse-action → WS event the client expects:
  //   create → deleted (the row is now soft-deleted)
  //   delete → created (the row is back; clients that REMOVED on .deleted
  //                     must re-add — emitting .updated would leak rows)
  //   update → updated
  const eventType =
    result.reversed === 'create'
      ? 'transaction.deleted'
      : result.reversed === 'delete'
        ? 'transaction.created'
        : 'transaction.updated';
  emit(u.id, {
    type: eventType,
    entityId: result.transaction.id,
    data: { transactionId: result.transaction.id },
  });
  void recomputeAffectedBudgets(u.id, u.activeSpaceId, result.affectedCategory);
  return c.json(
    ok({
      undone: true,
      reversed: result.reversed,
      transaction: result.transaction,
    }),
  );
});

const categoryCorrectionInput = z.object({
  category: z.enum(CATEGORIES),
});

app.post('/:id/category', zValidator('json', categoryCorrectionInput), async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const { category } = c.req.valid('json');

  const existing = await getTransactionById(u.activeSpaceId, id);
  if (!existing) throw errors.notFound('Transaction not found');

  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(transactions)
      .set({
        category,
        categoryConfidence: '1.00',
        categorizedBy: 'user',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.spaceId, u.activeSpaceId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning();
    if (!row) throw errors.internal('Category update failed');
    await recordMutation(tx, {
      spaceId: u.activeSpaceId,
      userId: u.id,
      transactionId: row.id,
      action: 'update',
      before: snapshotTx(existing),
      after: snapshotTx(row),
      source: c.req.header('x-bot-secret') ? 'whatsapp_correction' : 'manual_web',
    });
    return [row];
  });
  if (!updated) throw errors.internal('Category update failed');

  if (category !== existing.category) {
    await recordCategoryCorrection(
      u.activeSpaceId,
      updated.id,
      existing.category,
      category,
      updated.description,
    );
  }

  emit(u.id, {
    type: 'transaction.updated',
    entityId: updated.id,
    data: { transactionId: updated.id, changedFields: ['category'] },
  });
  void recomputeAffectedBudgets(u.id, u.activeSpaceId, updated.category ?? existing.category);

  return c.json(ok({ transaction: serializeTransaction(updated) }));
});

async function recordCategoryCorrection(
  spaceId: string,
  transactionId: string,
  fromCategory: string | null,
  toCategory: Category,
  description: string,
): Promise<void> {
  await db.insert(categoryCorrections).values({
    spaceId,
    transactionId,
    fromCategory,
    toCategory,
  });
  const merchant = await safeNormalizeMerchant(description);
  if (merchant) await safeUpsertOverride(spaceId, merchant, toCategory);
}

async function loadWalletsByName(
  spaceId: string,
): Promise<Map<string, { id: string; currency: string }>> {
  const rows = await db
    .select({ id: wallets.id, name: wallets.name, currency: wallets.currency })
    .from(wallets)
    .where(eq(wallets.spaceId, spaceId));
  const map = new Map<string, { id: string; currency: string }>();
  for (const r of rows) map.set(r.name.toLowerCase(), { id: r.id, currency: r.currency });
  return map;
}

interface CsvCandidateInput {
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  date: string;
  description: string;
  walletId: string;
  category?: Category;
  notes?: string;
  tags: string[];
}

function mapCsvRow(
  rec: Record<string, string>,
  walletByName: Map<string, { id: string; currency: string }>,
): CsvCandidateInput {
  const lc: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) lc[k.toLowerCase().trim()] = v;

  const date = (lc.date ?? lc.day ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`invalid date '${date}' (expected YYYY-MM-DD)`);
  }
  const description = (lc.description ?? lc.merchant ?? lc.note ?? '').trim();
  if (!description) throw new Error('description is required');

  const walletName = (lc.wallet ?? lc['wallet name'] ?? '').trim().toLowerCase();
  const wallet = walletByName.get(walletName);
  if (!wallet) throw new Error(`unknown wallet '${walletName}'`);

  const amountStr = (lc.amount ?? '').replace(/[^\d.\-]/g, '');
  const amount = Math.abs(Number(amountStr));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount '${lc.amount}'`);

  const typeRaw = (lc.type ?? '').toLowerCase().trim();
  let type: 'income' | 'expense';
  if (typeRaw === 'income' || typeRaw === 'expense') type = typeRaw;
  else type = Number(amountStr) < 0 ? 'expense' : 'income';

  const currency = ((lc.currency ?? wallet.currency) || 'INR').toUpperCase();

  let category: Category | undefined;
  if (lc.category) {
    const cleaned = lc.category.trim();
    if (isCategory(cleaned)) category = cleaned;
  }

  const tagsRaw = (lc.tags ?? '').trim();
  const tags = tagsRaw
    ? tagsRaw
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const result: CsvCandidateInput = {
    type,
    amount,
    currency,
    date,
    description,
    walletId: wallet.id,
    tags,
  };
  if (category) result.category = category;
  if (lc.notes) result.notes = lc.notes;
  return result;
}

/**
 * Tiny CSV parser. We avoid an extra dependency for the demo; this handles
 * quoted values, embedded commas, escaped quotes (""), and CRLF/LF line
 * endings. It returns row objects keyed by the header row.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cur.push(field);
      field = '';
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  }
  if (rows.length === 0) return [];
  const header = (rows.shift() as string[]).map((h) => h.trim());
  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => {
        obj[h] = r[idx] ?? '';
      });
      return obj;
    });
}

function toCsv(items: ReadonlyArray<ReturnType<typeof serializeTransaction>>): string {
  const cols = [
    'id',
    'date',
    'type',
    'amount',
    'currency',
    'baseAmount',
    'description',
    'category',
    'walletId',
    'notes',
    'tags',
    'source',
    'createdAt',
  ] as const;
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(',')];
  for (const it of items) {
    lines.push(
      cols
        .map((c) => {
          if (c === 'tags') return escape(it.tags.join('|'));
          return escape((it as unknown as Record<string, unknown>)[c]);
        })
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

void emitCreated;

export const transactionRoutes = app;
