/**
 * Ledger routes.
 *
 *   GET    /ledger              list (optional ?direction=lent|borrowed&status=open|partial|settled&counterpartyName=)
 *   POST   /ledger              create entry
 *   GET    /ledger/:id          fetch
 *   POST   /ledger/:id/settle   apply a settlement (optionally creates a wallet transaction)
 *
 * No update/delete on entries in this iteration — losing audit history of
 * who-owes-whom is a worse failure mode than forcing a contra-entry.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  ledgerCreateInput,
  ledgerDirection,
  ledgerSettlementInput,
  ledgerStatus,
} from '@versifine/shared';
import { requireUser } from '../middleware/auth.ts';
import {
  createEntry,
  getEntry,
  listLedger,
  serializeEntry,
  settleEntry,
} from '../services/ledger/index.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';

const app = new Hono();
app.use('*', requireUser);

app.get('/', async (c) => {
  const u = c.get('user');
  const directionParam = c.req.query('direction');
  const statusParam = c.req.query('status');
  const counterpartyName = c.req.query('counterpartyName') ?? undefined;

  const opts: Parameters<typeof listLedger>[1] = {};
  if (directionParam) {
    const parsed = ledgerDirection.safeParse(directionParam);
    if (!parsed.success)
      throw errors.validation('Invalid direction', { direction: directionParam });
    opts.direction = parsed.data;
  }
  if (statusParam) {
    const parsed = ledgerStatus.safeParse(statusParam);
    if (!parsed.success) throw errors.validation('Invalid status', { status: statusParam });
    opts.status = parsed.data;
  }
  if (counterpartyName) opts.counterpartyName = counterpartyName;

  const rows = await listLedger(u.activeSpaceId, opts);
  return c.json(ok({ entries: rows.map(serializeEntry) }));
});

app.post('/', zValidator('json', ledgerCreateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await createEntry(u.id, u.activeSpaceId, u.baseCurrency, body);
  return c.json(ok({ entry: serializeEntry(row) }), 201);
});

app.get('/:id', async (c) => {
  const u = c.get('user');
  const row = await getEntry(u.activeSpaceId, c.req.param('id'));
  if (!row) throw errors.notFound('Ledger entry not found');
  return c.json(ok({ entry: serializeEntry(row) }));
});

app.post('/:id/settle', zValidator('json', ledgerSettlementInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const result = await settleEntry(u.id, u.activeSpaceId, c.req.param('id'), u.baseCurrency, body);
  return c.json(
    ok({
      entry: serializeEntry(result.entry),
      settlement: {
        id: result.settlement.id,
        amount: Number(result.settlement.amount),
        date: result.settlement.date,
        linkedTransactionId: result.settlement.linkedTransactionId,
        createdAt: result.settlement.createdAt.toISOString(),
      },
    }),
    201,
  );
});

export const ledgerRoutes = app;
