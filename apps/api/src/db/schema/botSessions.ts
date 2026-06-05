/**
 * PostgreSQL persistent bot session store.
 * Holds user session context for the WhatsApp bot to prevent state loss across restarts.
 */
import { sql } from 'drizzle-orm';
import { boolean, pgTable, timestamp, uuid, varchar, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.ts';
import { spaces } from './spaces.ts';

export const botSessions = pgTable(
  'bot_sessions',
  {
    phone: varchar('phone', { length: 20 }).primaryKey(),
    language: varchar('language', { length: 10 }).notNull().default('en'),
    state: varchar('state', { length: 40 }).notNull().default('GREETING'),
    linked: boolean('linked').notNull().default(false),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'set null' }),
    lastDraftId: uuid('last_draft_id'),
    lastTransactionId: uuid('last_transaction_id'),
    replyMode: varchar('reply_mode', { length: 15 }).notNull().default('auto'),
    pending: jsonb('pending').notNull().default('{}'),
    accountResolved: boolean('account_resolved').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }
);

export type BotSession = typeof botSessions.$inferSelect;
export type NewBotSession = typeof botSessions.$inferInsert;
