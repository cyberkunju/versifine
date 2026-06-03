/**
 * Apply Drizzle migrations to the configured database.
 *
 * Run with `bun run db:migrate` from the api workspace, or `bun run db:migrate`
 * from the repo root. Missing migrations folder is treated as "nothing to do"
 * so this can run safely on a fresh checkout before any generation.
 *
 * Exposes `runMigrate()` for use by other scripts (e.g. `reset.ts`) so the
 * top-level `await sql.end()` is sequenced correctly.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from '../src/db/client.ts';

const migrationsFolder = resolve(import.meta.dir, '../src/db/migrations');

export async function runMigrate(): Promise<void> {
  if (!existsSync(migrationsFolder) || readdirSync(migrationsFolder).length === 0) {
    console.log('migrate: no migrations to apply (folder empty).');
    return;
  }
  console.log('migrate: applying...');
  await migrate(db, { migrationsFolder });
  console.log('migrate: done.');
}

// CLI entry: only runs when this file is executed directly, not when
// imported (e.g. by reset.ts).
const isCli = (() => {
  try {
    return (
      import.meta.url.endsWith(process.argv[1] ?? '') ||
      process.argv[1]?.endsWith('migrate.ts') === true
    );
  } catch {
    return true;
  }
})();

if (isCli) {
  runMigrate()
    .catch((err) => {
      console.error('migrate: failed', err);
      process.exit(1);
    })
    .finally(async () => {
      await sql.end({ timeout: 1 });
    });
}
