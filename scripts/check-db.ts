/**
 * Quick database probe. Lists every demo data count so we can sanity-check
 * a seed run from the command line without firing up psql.
 *
 * Usage: bun run scripts/check-db.ts
 */
import { default as postgres } from 'postgres';

const url =
  process.env.DATABASE_URL ?? 'postgres://versifine:versifine@localhost:5432/versifine_dev';

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

async function count(table: string): Promise<number> {
  const rows = await sql.unsafe<Array<{ count: string }>>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const tables = [
    'users',
    'spaces',
    'wallets',
    'transactions',
    'budgets',
    'goals',
    'ledger_entries',
    'recurring_items',
    'transaction_embeddings',
    'category_overrides',
  ];
  console.log(`db: ${url}`);
  for (const t of tables) {
    try {
      console.log(`  ${t.padEnd(28)} ${await count(t)}`);
    } catch (err) {
      console.log(`  ${t.padEnd(28)} <missing> (${(err as Error).message.slice(0, 60)})`);
    }
  }
}

main()
  .catch((err) => {
    console.error('check-db failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end({ timeout: 1 });
  });
