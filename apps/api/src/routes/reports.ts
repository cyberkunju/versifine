/**
 * Report routes.
 *
 *   GET /reports/summary       — JSON envelope of every roll-up
 *   GET /reports/summary.csv   — same data, flattened into a CSV file
 *
 * Both share the same `from`/`to` query params (ISO dates, inclusive). The
 * CSV variant emits four sections separated by blank lines: totals,
 * by-category, by-merchant, by-wallet, budget adherence. Section headers
 * make the file readable in any spreadsheet without a transformation step.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../middleware/auth.ts';
import { computeSummary, type ReportSummary } from '../services/reports/summary.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';

const app = new Hono();
app.use('*', requireUser);

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
});

function parseRange(url: string): { from: string; to: string } {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(url).searchParams.entries()),
  );
  if (!parsed.success) {
    throw errors.validation('Invalid range', { issues: parsed.error.issues });
  }
  return parsed.data;
}

app.get('/summary', async (c) => {
  const u = c.get('user');
  const range = parseRange(c.req.url);
  const summary = await computeSummary(u.activeSpaceId, range);
  return c.json(ok({ summary }));
});

app.get('/summary.csv', async (c) => {
  const u = c.get('user');
  const range = parseRange(c.req.url);
  const summary = await computeSummary(u.activeSpaceId, range);
  const csv = renderCsv(summary);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="finehance-summary-${range.from}-${range.to}.csv"`,
    },
  });
});

function renderCsv(s: ReportSummary): string {
  const lines: string[] = [];
  const push = (...rows: string[][]) => {
    for (const r of rows) lines.push(r.map(escape).join(','));
  };

  push(['Range', `${s.range.from} to ${s.range.to}`]);
  push(['Days', String(s.dayCount)]);
  push(['Transactions', String(s.transactionCount)]);
  lines.push('');

  push(['Totals']);
  push(['Income', String(s.totals.income)]);
  push(['Expense', String(s.totals.expense)]);
  push(['Savings', String(s.totals.savings)]);
  push(['Savings rate (%)', String(s.totals.savingsRate)]);
  lines.push('');

  push(['By category']);
  push(['Category', 'Total']);
  for (const row of s.byCategory) push([row.category, String(row.total)]);
  lines.push('');

  push(['Top merchants']);
  push(['Merchant', 'Total']);
  for (const row of s.byMerchant) push([row.merchant, String(row.total)]);
  lines.push('');

  push(['By wallet']);
  push(['Wallet', 'Currency', 'Total']);
  for (const row of s.byWallet) push([row.walletName, row.currency, String(row.total)]);
  lines.push('');

  push(['Budget adherence']);
  push(['Budget', 'Allocated', 'Spent', 'Percentage']);
  for (const row of s.budgetAdherence) {
    push([row.name, String(row.allocated), String(row.spent), String(row.percentage)]);
  }

  return `${lines.join('\n')}\n`;
}

function escape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export const reportRoutes = app;
