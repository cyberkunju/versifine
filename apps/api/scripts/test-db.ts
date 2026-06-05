import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../src/env.ts';
import { db, sql } from '../src/db/client.ts';

const migrationsFolder = resolve(import.meta.dir, '../src/db/migrations');

console.log('--- DATABASE DIAGNOSTIC ---');
console.log('DATABASE_URL:', env.DATABASE_URL);
console.log('NODE_ENV:', env.NODE_ENV);
console.log('migrationsFolder:', migrationsFolder);
console.log('migrationsFolder exists:', existsSync(migrationsFolder));
if (existsSync(migrationsFolder)) {
  console.log('migrationsFolder files:', readdirSync(migrationsFolder));
}

try {
  const result = await sql`SELECT current_database(), current_user;`;
  console.log('SQL SELECT current_database():', result);
  
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`;
  console.log('Tables in database:', tables.map(t => t.table_name));

  const migrations = await sql`SELECT * FROM drizzle.__drizzle_migrations;`;
  console.log('drizzle.__drizzle_migrations:', migrations);
} catch (err) {
  console.error('Diagnostic error:', err);
} finally {
  await sql.end({ timeout: 1 });
}
