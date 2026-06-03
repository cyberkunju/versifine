/**
 * Postgres connection + Drizzle ORM client.
 *
 * Connection pool sized to ten — enough for solo dev plus a few WhatsApp
 * messages arriving in parallel. The pool is shared across all request
 * handlers; per-request transactions are obtained via `db.transaction`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.ts';
import * as schema from './schema/index.ts';

const url =
  env.NODE_ENV === 'test' && env.DATABASE_URL_TEST ? env.DATABASE_URL_TEST : env.DATABASE_URL;

export const sql = postgres(url, {
  max: 10,
  idle_timeout: 20,
  prepare: false,
  onnotice: () => undefined,
});

export const db = drizzle(sql, { schema, casing: 'snake_case' });

/**
 * Aliases for typed transaction handles. `Db` is the friendlier name we use
 * inside services that accept either the global client or a `db.transaction`
 * scope; both share the exact same shape.
 */
export type Database = typeof db;
export type Db = typeof db;
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { schema };
