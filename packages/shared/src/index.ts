/**
 * Public surface of the shared package. Re-exports everything in a flat
 * namespace so consumers can `import { Category, walletCreateInput } from '@finehance/shared'`
 * without thinking about subpaths. Subpath imports remain available for
 * trees that benefit from finer-grained dependencies.
 */

export * from './categories.ts';
export * from './currencies.ts';
export * from './languages.ts';
export * from './intents.ts';
export * from './events.ts';

export * from './schemas/auth.ts';
export * from './schemas/transaction.ts';
export * from './schemas/wallet.ts';
export * from './schemas/budget.ts';
export * from './schemas/goal.ts';
export * from './schemas/ledger.ts';
export * from './schemas/copilot.ts';
