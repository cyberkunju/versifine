/**
 * Wallet routes.
 *
 *   GET    /wallets                  list with live balances (single SQL aggregate)
 *   POST   /wallets                  create
 *   GET    /wallets/:id              fetch with balance
 *   PATCH  /wallets/:id              rename / archive
 *   DELETE /wallets/:id              archive only — wallets never delete (transactions reference them)
 *   POST   /wallets/transfer         atomic two-row transfer
 *
 * The list endpoint computes balance with one SQL pass: a left join from
 * `wallets` to `transactions` aggregating signed amounts per wallet, so we
 * never N+1 over wallets to compute balance.
 */
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  transferInput,
  walletCreateInput,
  walletUpdateInput,
} from '@versifine/shared';
import { db } from '../db/client.ts';
import { transactions } from '../db/schema/transactions.ts';
import { wallets } from '../db/schema/wallets.ts';
import { requireUser } from '../middleware/auth.ts';
import { emit } from '../services/events/bus.ts';
import { createTransfer } from '../services/transactions/transfer.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';

const app = new Hono();
app.use('*', requireUser);

app.get('/', async (c) => {
  const u = c.get('user');
  // Signed amount = amount when income/opening_balance, -amount when expense, ±amount when transfer.
  // For the wallet's own balance the signed amount is +amount on the to-side and -amount on the from-side;
  // we encode that via metadata.side which the transfer service writes.
  const rows = await db
    .select({
      id: wallets.id,
      name: wallets.name,
      type: wallets.type,
      currency: wallets.currency,
      archivedAt: wallets.archivedAt,
      createdAt: wallets.createdAt,
      balance: drizzleSql<string>`
        coalesce(sum(
          case
            when ${transactions.deletedAt} is not null then 0
            when ${transactions.type} = 'income' then ${transactions.amount}
            when ${transactions.type} = 'opening_balance' then ${transactions.amount}
            when ${transactions.type} = 'expense' then -${transactions.amount}
            when ${transactions.type} = 'transfer' then
              case when (${transactions.metadata} ->> 'side') = 'to' then ${transactions.amount}
                   else -${transactions.amount}
              end
            else 0
          end
        ), 0)
      `,
    })
    .from(wallets)
    .leftJoin(transactions, eq(transactions.walletId, wallets.id))
    .where(eq(wallets.spaceId, u.activeSpaceId))
    .groupBy(wallets.id);

  return c.json(
    ok({
      wallets: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        currency: r.currency,
        balance: Number(r.balance),
        archived: r.archivedAt !== null,
        createdAt: r.createdAt.toISOString(),
      })),
    }),
  );
});

app.post('/', zValidator('json', walletCreateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const wallet = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(wallets)
      .values({
        spaceId: u.activeSpaceId,
        name: body.name,
        type: body.type,
        currency: body.currency,
      })
      .returning();
    if (!row) throw errors.internal('Wallet create failed');

    if (body.openingBalance > 0) {
      await tx.insert(transactions).values({
        spaceId: u.activeSpaceId,
        walletId: row.id,
        type: 'opening_balance',
        amount: body.openingBalance.toFixed(2),
        currency: body.currency,
        baseAmount: body.openingBalance.toFixed(2),
        fxRate: '1.00000000',
        description: `Opening balance for ${body.name}`,
        category: null,
        date: new Date().toISOString().slice(0, 10),
        tags: [],
        source: 'manual_web',
      });
    }
    return row;
  });

  emit(u.id, {
    type: 'wallet.updated',
    entityId: wallet.id,
    data: { walletId: wallet.id, balance: body.openingBalance },
  });

  return c.json(
    ok({
      wallet: {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        currency: wallet.currency,
        balance: body.openingBalance,
        archived: false,
        createdAt: wallet.createdAt.toISOString(),
      },
    }),
    201,
  );
});

app.get('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.spaceId, u.activeSpaceId)))
    .limit(1);
  if (!row) throw errors.notFound('Wallet not found');

  const balance = await computeWalletBalance(u.activeSpaceId, id);
  return c.json(
    ok({
      wallet: {
        id: row.id,
        name: row.name,
        type: row.type,
        currency: row.currency,
        balance,
        archived: row.archivedAt !== null,
        createdAt: row.createdAt.toISOString(),
      },
    }),
  );
});

app.patch('/:id', zValidator('json', walletUpdateInput), async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.spaceId, u.activeSpaceId)))
    .limit(1);
  if (!existing) throw errors.notFound('Wallet not found');

  const updates: Partial<typeof wallets.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.archived !== undefined) updates.archivedAt = body.archived ? new Date() : null;

  const [row] = await db
    .update(wallets)
    .set(updates)
    .where(and(eq(wallets.id, id), eq(wallets.spaceId, u.activeSpaceId)))
    .returning();
  if (!row) throw errors.internal('Wallet update failed');

  const balance = await computeWalletBalance(u.activeSpaceId, id);
  emit(u.id, {
    type: 'wallet.updated',
    entityId: id,
    data: { walletId: id, balance },
  });

  return c.json(
    ok({
      wallet: {
        id: row.id,
        name: row.name,
        type: row.type,
        currency: row.currency,
        balance,
        archived: row.archivedAt !== null,
        createdAt: row.createdAt.toISOString(),
      },
    }),
  );
});

app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [row] = await db
    .update(wallets)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(wallets.id, id), eq(wallets.spaceId, u.activeSpaceId)))
    .returning();
  if (!row) throw errors.notFound('Wallet not found');
  emit(u.id, {
    type: 'wallet.updated',
    entityId: id,
    data: { walletId: id, balance: await computeWalletBalance(u.activeSpaceId, id) },
  });
  return c.json(ok({ archived: true }));
});

app.post('/transfer', zValidator('json', transferInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const result = await createTransfer({
    userId: u.id,
    spaceId: u.activeSpaceId,
    source: 'manual_web',
    input: body,
  });
  return c.json(
    ok({
      transferId: result.transferId,
      from: { id: result.fromTransaction.id, walletId: result.fromTransaction.walletId },
      to: { id: result.toTransaction.id, walletId: result.toTransaction.walletId },
    }),
    201,
  );
});

async function computeWalletBalance(spaceId: string, walletId: string): Promise<number> {
  const [row] = await db
    .select({
      balance: drizzleSql<string>`
        coalesce(sum(
          case
            when ${transactions.type} = 'income' then ${transactions.amount}
            when ${transactions.type} = 'opening_balance' then ${transactions.amount}
            when ${transactions.type} = 'expense' then -${transactions.amount}
            when ${transactions.type} = 'transfer' then
              case when (${transactions.metadata} ->> 'side') = 'to' then ${transactions.amount}
                   else -${transactions.amount}
              end
            else 0
          end
        ), 0)
      `,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.walletId, walletId),
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
      ),
    );
  return Number(row?.balance ?? 0);
}

export const walletRoutes = app;
export { computeWalletBalance };
