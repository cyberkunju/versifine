/**
 * Aggregates every table into one schema namespace so the Drizzle client
 * sees the full set and so `drizzle-kit generate` finds everything.
 *
 * Order of re-exports is intentional: tables that own foreign keys appear
 * after the tables they reference, so a fresh reader follows the
 * dependency arrows top-to-bottom.
 */
export * from './users.ts';
export * from './spaces.ts';
export * from './wallets.ts';
export * from './transactions.ts';
export * from './overrides.ts';
export * from './embeddings.ts';
export * from './budgets.ts';
export * from './goals.ts';
export * from './ledger.ts';
export * from './recurring.ts';
export * from './fx.ts';
