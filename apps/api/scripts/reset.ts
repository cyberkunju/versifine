/**
 * Drop every table the API owns and re-run migrations + seed.
 *
 * Intended for the demo: `bun run db:reset` resets to a known-good state
 * with the demo user and 90 days of seeded transactions.
 */
import { sql as raw } from '../src/db/client.ts';
import { runMigrate } from './migrate.ts';
import { runSeed } from './seed.ts';

const TABLES_IN_ORDER = [
  'transaction_embeddings',
  'category_corrections',
  'category_overrides',
  'ledger_settlements',
  'ledger_entries',
  'recurring_items',
  'goals',
  'budgets',
  'transactions',
  'wallets',
  'space_members',
  'spaces',
  'phone_link_otps',
  'refresh_tokens',
  'users',
  'fx_rates',
  // Drizzle's own tracker
  '__drizzle_migrations',
];

async function main(): Promise<void> {
  console.log('reset: dropping tables...');
  for (const table of TABLES_IN_ORDER) {
    await raw.unsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
  // Also drop the drizzle migrations meta schema if it was created.
  await raw.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE`);

  console.log('reset: re-running migrations...');
  await runMigrate();

  console.log('reset: re-seeding...');
  await runSeed();

  console.log('reset: done.');
}

main()
  .catch((err) => {
    console.error('reset: failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await raw.end({ timeout: 1 });
  });
