import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://finehance:finehance@localhost:5432/finehance_dev',
  },
  strict: true,
  verbose: true,
} satisfies Config;
