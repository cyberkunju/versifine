# 04 · Database Schema

> 16 tables, 3 migrations, 4 extensions. PostgreSQL 16.14 + pgvector 0.8.2 native install. Drizzle ORM owns the type definitions; SQL migrations are the executable contract.

## Connection

| | |
| --- | --- |
| Database (dev) | `versifine_dev` |
| Database (test) | `versifine_test` |
| Role | `versifine` / `versifine` |
| Host | `localhost:5432` |
| URL (dev) | `postgres://versifine:versifine@localhost:5432/versifine_dev` |
| URL (test) | `postgres://versifine:versifine@localhost:5432/versifine_test` |

Both URLs live in the repo-root `.env` as `DATABASE_URL` and `DATABASE_URL_TEST`. The API picks the test URL when `NODE_ENV=test`.

## Extensions

| | Version | Purpose |
| --- | --- | --- |
| `pgcrypto` | 1.3 | `gen_random_uuid()` for primary keys |
| `pg_trgm` | 1.6 | GIN trigram index on `transactions.description` for fast `ILIKE` search |
| `citext` | 1.6 | Case-insensitive `users.email` column |
| `vector` | 0.8.2 | `vector(1536)` column on `transaction_embeddings`, IVFFlat cosine index |

Bootstrap script `scripts/db-init.ts` (run via `bun run db:init`) creates both databases, the role, grants schema permissions, and enables the four extensions. Idempotent — running it again cleanly resets the role password and recreates the databases.

## Tables (Drizzle types live in `apps/api/src/db/schema/`)

### `users` (8 columns)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | default `gen_random_uuid()` |
| `email` | citext NOT NULL | unique index |
| `password_hash` | text NOT NULL | bcrypt cost 12 |
| `display_name` | varchar(80) | nullable |
| `primary_language` | varchar(4) NOT NULL DEFAULT 'en' | one of `en/hi/ml/ta/te/kn` |
| `base_currency` | char(3) NOT NULL DEFAULT 'INR' | always INR for MVP |
| `active_space_id` | uuid | FK → `spaces.id` ON DELETE SET NULL (added in `0001_*`) |
| `whatsapp_phone` | varchar(20) | nullable, partial unique index |
| `whatsapp_phone_verified_at` | timestamptz | nullable |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | standard, soft-delete supported |

### `phone_link_otps` (5 columns)

OTP table for phone-linking flow. Six-digit codes with 10-minute TTL, single-use.

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `user_id` (FK CASCADE), `code` (varchar 6), `expires_at`, `consumed_at`, `created_at` | | |

### `refresh_tokens` (6 columns)

Hashed refresh tokens for JWT rotation.

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `user_id` (FK CASCADE), `token_hash` (text, unique), `expires_at`, `rotated_at`, `revoked_at`, `created_at` | | |

### `spaces` (6 columns)

| `id`, `name`, `type` (`personal`/`household`/`business`, default `personal`), `base_currency`, `created_by` (FK users SET NULL), `created_at`, `updated_at` | | |

### `space_members` (4 columns)

Composite PK `(space_id, user_id)`. `role` is `owner`/`editor`/`viewer`. MVP only inserts an `owner` row at registration; v2 will populate.

### `wallets` (8 columns)

| `id`, `space_id` (FK CASCADE), `name` (varchar 80), `type` (`cash`/`bank`/`upi`/`credit_card`/`wallet`), `currency` (char 3, default INR), `archived_at` (soft delete), `created_at`, `updated_at` | | |

Index: `(space_id, archived_at)`.

### `transactions` (22 columns) — the central table

```
id                  uuid PK
space_id            uuid NOT NULL FK
wallet_id           uuid NOT NULL FK (ON DELETE RESTRICT — wallets never disappear under transactions)
type                varchar(20) — 'income' / 'expense' / 'transfer' / 'opening_balance'
amount              numeric(14,2) NOT NULL — always positive
currency            char(3) NOT NULL — ISO 4217
base_amount         numeric(14,2) NOT NULL — converted to wallet currency
fx_rate             numeric(18,8) — null when currency == base
description         text NOT NULL — searchable
category            varchar(40) — one of CATEGORIES (23 entries)
category_confidence numeric(3,2) — 0..1
categorized_by      varchar(16) — user / overrides / merchants / minilm / llm / client / default
date                date NOT NULL — value-date
notes               text — user-supplied
tags                text[] NOT NULL DEFAULT ARRAY[]::text[]
source              varchar(24) NOT NULL — manual_web / whatsapp_text / whatsapp_voice / whatsapp_image / csv_import / recurring_engine
transfer_id         uuid — set on both sides of a transfer
needs_fx_resolution boolean NOT NULL DEFAULT false — set when FX lookup failed
metadata            jsonb NOT NULL DEFAULT '{}' — JSONB blob (e.g. transfer side, original amount)
created_at          timestamptz
updated_at          timestamptz
deleted_at          timestamptz — soft delete; queries filter IS NULL by default
```

**Indexes**:
- `(space_id, date DESC)` — primary list query
- `(space_id, category)` — filter by category
- `(space_id, wallet_id)` — wallet detail
- `(space_id, type)` — income vs expense aggregates
- `(transfer_id)` — transfer pair lookup
- `USING gin (description gin_trgm_ops)` — full-text-ish search

### `category_overrides` (7 columns)

The personalization layer. When a user corrects a category, the (`merchant_normalized`, `category`) mapping is upserted here. Future transactions with the same normalized merchant get the corrected label instantly.

| `id`, `space_id` (FK CASCADE), `merchant_normalized` (text), `category` (text), `occurrences` (text default '1' — counted via increment), `created_at`, `updated_at` | | |

Unique index `(space_id, merchant_normalized)` (added in migration `0002`) so upsert collapses to a single statement.

### `category_corrections` (5 columns)

Audit history. Every category change writes a row. We never delete from this table — even if you correct your correction, both events stay in the log.

| `id`, `space_id` (FK), `transaction_id` (FK CASCADE), `from_category` (text, nullable), `to_category` (text), `created_at` | | |

### `transaction_embeddings` (5 columns)

Vector index for the copilot RAG retriever. One row per non-deleted transaction, keyed by transaction id.

| `transaction_id` PK FK CASCADE, `space_id` FK, `embedding` vector(1536), `text` text, `created_at` | | |

Indexes:
- `USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)` — cosine similarity, list count tuned in migration `0001`
- `(space_id)` — filter to user's space before vector search

Embeddings come from `text-embedding-3-small`; written by the background queue in `services/transactions/embed.ts`.

### `budgets` (11 columns)

Allocations per category, recurrence-aware.

| `id`, `space_id` (FK CASCADE), `name` (varchar 80), `recurrence` (`monthly`/`custom`), `period_start`, `period_end` (only for `custom`), `allocations` jsonb (`{ "Groceries": 5000, "Dining": 3000 }`), `warn_threshold` smallint default 80, `exceed_threshold` smallint default 100, `created_at`, `updated_at` | | |

Index `(space_id)`. Threshold alerts fire on `services/budgets/index.ts:recomputeAffectedBudgets()` after every transaction event.

### `goals` (10 columns)

Savings targets.

| `id`, `space_id` (FK CASCADE), `name`, `target_amount` numeric(14,2), `current_amount` numeric(14,2) default 0, `deadline` date (nullable), `linked_category` varchar(40) (nullable; auto-progress from that category), `status` (`active`/`achieved`/`archived`), `created_at`, `updated_at` | | |

Indexes: `(space_id, status)` and `(space_id, linked_category)`.

### `ledger_entries` (14 columns) and `ledger_settlements` (6 columns)

Lend / borrow tracking. Every entry has a `direction` (`lent`/`borrowed`), `counterparty_name`, `amount`, `currency`, `base_amount`, `outstanding`, `status` (`open`/`partial`/`settled`). Settlements deduct from `outstanding`; on `outstanding = 0` the status flips to `settled`.

`ledger_settlements` rows can optionally link to a real wallet transaction (`linked_transaction_id`) so the settlement creates an income/expense as well.

### `recurring_items` (13 columns)

Detected subscriptions / EMI / rent etc.

| `id`, `space_id` (FK CASCADE), `merchant_normalized` (text), `display_name`, `average_amount`, `currency`, `frequency_days` int, `next_expected_date` date, `occurrences` int, `confidence` numeric(3,2), `status` (`active`/`dismissed`), `detected_at`, `updated_at` | | |

Unique index `(space_id, merchant_normalized)`. Status `active` ones feed the forecast.

### `fx_rates` (4 columns)

| `base` char(3), `quote` char(3), `rate` numeric(18,8), `fetched_at` | | |

Composite PK `(base, quote)`. 6-hour cache; `services/fx/client.ts` owns refresh.

## Migrations

```
apps/api/src/db/migrations/
├── 0000_mysterious_pet_avengers.sql      Initial 16 tables, all indexes
├── 0001_add_cyclic_fk_and_index_tuning.sql  users.active_space_id → spaces FK; ivfflat WITH (lists=100)
├── 0002_unique_category_overrides_index.sql Unique (space_id, merchant_normalized) for upsert
└── meta/_journal.json                    Drizzle's tracker
```

Migration runner is `apps/api/scripts/migrate.ts`. Idempotent. Applied via `bun run --cwd apps/api db:migrate`.

## Schema invariants enforced in code (not in SQL)

These are application-level rules the database doesn't itself check:

1. **Tenant isolation**: every query filters by `space_id` derived from the authenticated user's active space. The Drizzle helper queries in `services/*` always include this filter.
2. **Soft delete semantics**: queries filter `WHERE deleted_at IS NULL` by default. Audit queries opt in.
3. **Money sign convention**: `amount` is always positive. Sign is encoded by `type`. UI flips display sign for expenses.
4. **Transfer atomicity**: a transfer creates exactly two rows sharing a `transfer_id` inside one DB transaction.
5. **FX consistency**: `currency` and `base_amount` are always set; `original_amount`/`original_currency` live in `metadata` for transfers.
6. **Categorization personalization**: a category change writes BOTH a `category_corrections` row AND upserts `category_overrides`.
7. **No fabricated numbers in copilot**: enforced by tool-calling, not by SQL — but the audit trail (`category_corrections`) is the data side of that promise.

## Common queries

### Wallet balance (single SQL pass)

```sql
SELECT
  w.id, w.name, w.currency,
  COALESCE(SUM(
    CASE
      WHEN t.deleted_at IS NOT NULL THEN 0
      WHEN t.type IN ('income', 'opening_balance') THEN t.amount
      WHEN t.type = 'expense' THEN -t.amount
      WHEN t.type = 'transfer' THEN
        CASE WHEN t.metadata->>'side' = 'to' THEN t.amount ELSE -t.amount END
      ELSE 0
    END
  ), 0) AS balance
FROM wallets w
LEFT JOIN transactions t ON t.wallet_id = w.id
WHERE w.space_id = $1
GROUP BY w.id;
```

This is verbatim what `routes/wallets.ts` builds via Drizzle.

### Top-5 categories this month

```sql
SELECT category, SUM(base_amount) AS total
FROM transactions
WHERE space_id = $1
  AND type = 'expense'
  AND deleted_at IS NULL
  AND date >= date_trunc('month', CURRENT_DATE)
  AND date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
GROUP BY category
ORDER BY total DESC
LIMIT 5;
```

### PgVector cosine search

```sql
SELECT t.id, t.date, t.description, t.amount, t.category
FROM transaction_embeddings te
JOIN transactions t ON t.id = te.transaction_id
WHERE te.space_id = $1
  AND t.deleted_at IS NULL
ORDER BY te.embedding <=> $2::vector
LIMIT 20;
```

The `<=>` operator is cosine distance; the IVFFlat index makes it sub-millisecond for our scale.

## Reset / seed

```bash
bun run db:init                       # nuke databases + role, recreate, enable extensions
bun run --cwd apps/api db:migrate     # apply all migrations
bun run --cwd apps/api db:reset       # drop tables in dependency order, re-migrate, re-seed (stub)
bun run --cwd apps/api db:seed        # seed (stub today; will populate the demo dataset)
```

The seed needs filling in for hackathon demo readiness — a 90-day realistic Indian dataset (subscriptions, salary, UPI merchants, FX scenarios, split bills, anomalies). That's task 11 in the spec, currently deferred.

## Backup / portability notes

For a hackathon laptop, no formal backup. For a demo-day move-the-laptop scenario:

```bash
pg_dump -U versifine -h localhost -d versifine_dev > versifine_dev.dump
psql -U versifine -h localhost -d versifine_dev < versifine_dev.dump
```

The Postgres data directory is the standard `C:\Program Files\PostgreSQL\16\data`. The pgvector binaries live in `C:\Program Files\PostgreSQL\16\{lib,share/extension,include/server/extension}` — these came from a community repo and should be reinstalled on a fresh machine before `bun run db:init`.
