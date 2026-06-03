/**
 * Database bootstrap.
 *
 * Drops + recreates the `versifine_dev` and `versifine_test` databases and
 * the `versifine` role, then enables the four extensions every app needs:
 *
 *   - pgcrypto  → gen_random_uuid()
 *   - pg_trgm   → trigram indexes for transaction description search
 *   - citext    → case-insensitive email column
 *   - vector    → embeddings for the copilot RAG retriever
 *
 * Connects as the local Postgres superuser using the password the README
 * documents for the dev-only install. If you set up Postgres yourself,
 * override with PGUSER / PGPASSWORD / PGHOST / PGPORT before running.
 *
 * Usage:
 *   bun run db:init
 */

const SUPERUSER_DEFAULTS = {
  user: process.env.PG_SUPERUSER ?? 'postgres',
  password: process.env.PG_SUPERPASSWORD ?? 'versifine_dev',
  host: process.env.PGHOST ?? 'localhost',
  port: process.env.PGPORT ?? '5432',
};

async function withDb<T>(
  database: string,
  fn: (sql: <R>(query: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const { default: postgres } = await import('postgres');
  const sql = postgres({
    host: SUPERUSER_DEFAULTS.host,
    port: Number(SUPERUSER_DEFAULTS.port),
    user: SUPERUSER_DEFAULTS.user,
    password: SUPERUSER_DEFAULTS.password,
    database,
    onnotice: () => undefined,
    max: 1,
  });

  try {
    const wrap = <R>(query: string, params: unknown[] = []) =>
      sql.unsafe<R[]>(query, params as never);
    return await fn(wrap);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function ensureRole(): Promise<void> {
  await withDb('postgres', async (q) => {
    const rows = await q<{ rolname: string }>('SELECT rolname FROM pg_roles WHERE rolname = $1', [
      'versifine',
    ]);
    if (rows.length === 0) {
      await q(`CREATE ROLE versifine LOGIN PASSWORD 'versifine' CREATEDB`);
      console.log('  ✓ created role versifine');
    } else {
      // Keep the password aligned with what the docs promise.
      await q(`ALTER ROLE versifine WITH LOGIN PASSWORD 'versifine' CREATEDB`);
      console.log('  ✓ role versifine present (password reset to documented value)');
    }
  });
}

async function recreateDatabase(name: string): Promise<void> {
  await withDb('postgres', async (q) => {
    // Force-disconnect any open sessions before dropping.
    await q(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await q(`DROP DATABASE IF EXISTS ${name}`);
    await q(`CREATE DATABASE ${name} OWNER versifine`);
    console.log(`  ✓ recreated database ${name}`);
  });
}

async function enableExtensions(name: string): Promise<void> {
  await withDb(name, async (q) => {
    for (const ext of ['pgcrypto', 'pg_trgm', 'citext', 'vector']) {
      await q(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
    }
    // Ensure versifine can use everything inside the db.
    await q(`GRANT ALL ON SCHEMA public TO versifine`);
    const exts = await q<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension ORDER BY extname`,
    );
    const summary = exts
      .filter((row) => row.extname !== 'plpgsql')
      .map((row) => `${row.extname}@${row.extversion}`)
      .join(', ');
    console.log(`  ✓ ${name}: ${summary}`);
  });
}

async function main(): Promise<void> {
  console.log('versifine · db init');
  await ensureRole();
  for (const db of ['versifine_dev', 'versifine_test']) {
    await recreateDatabase(db);
    await enableExtensions(db);
  }
  console.log('done.');
}

main().catch((err) => {
  console.error('db init failed:', err);
  process.exit(1);
});
