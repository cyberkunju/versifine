/**
 * Categorize service — unit tests.
 *
 * Three behaviours we care about right now:
 *   1. The curated merchant catalogue maps a typical Indian transaction
 *      ("swiggy biryani 250") into a sensible expense category.
 *   2. The MiniLM tier degrades gracefully when no ONNX artifact is on
 *      disk — every call returns null, no exception escapes.
 *   3. `upsertOverride` + `getOverride` round-trip a (space, merchant)
 *      pair, and a second upsert with a different category replaces it
 *      while incrementing `occurrences`.
 *
 * The override test needs a real Postgres instance with the migrations
 * applied. If that isn't available in the test environment we skip the
 * round-trip rather than failing the suite — the other two assertions
 * still run and exercise the pure code paths.
 */
import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, sql as rawSql } from '../src/db/client.ts';
import { categoryOverrides } from '../src/db/schema/overrides.ts';
import { spaces } from '../src/db/schema/spaces.ts';
import {
  categorizeFromMerchantDB,
  merchantCatalogueSize,
} from '../src/services/categorize/merchants.ts';
import { categorizeWithMiniLM } from '../src/services/categorize/minilm.ts';
import { getOverride, upsertOverride } from '../src/services/categorize/overrides.ts';
import { normalizeMerchant } from '../src/services/transactions/normalize.ts';

// --- DB bootstrap --------------------------------------------------------
// We try to claim a fresh space row up-front. If the DB isn't reachable or
// the schema isn't migrated, we mark the round-trip skipped and keep the
// pure-function tests running.
let testSpaceId: string | null = null;
let dbReady = false;

try {
  const [row] = await db
    .insert(spaces)
    .values({
      name: 'Categorize Test Space',
      type: 'personal',
      baseCurrency: 'INR',
    })
    .returning({ id: spaces.id });
  if (row) {
    testSpaceId = row.id;
    dbReady = true;
  }
} catch {
  dbReady = false;
}

afterAll(async () => {
  if (testSpaceId) {
    try {
      await db.delete(spaces).where(eq(spaces.id, testSpaceId));
    } catch {
      // Best effort — the test DB may have been torn down between calls.
    }
  }
  // Close the pg pool so the bun test runner can exit promptly.
  try {
    await rawSql.end({ timeout: 1 });
  } catch {
    // ignore
  }
});

// --- Tier 2 (curated merchants) ------------------------------------------

test('merchant DB hits "swiggy biryani 250" with a sensible category', () => {
  expect(merchantCatalogueSize()).toBeGreaterThanOrEqual(250);

  // Mirror what the live pipeline does: normalize first, then look up.
  const normalized = normalizeMerchant('swiggy biryani 250');
  expect(normalized).toContain('swiggy');

  const hit = categorizeFromMerchantDB(normalized);
  expect(hit).not.toBeNull();
  // Swiggy is the food-delivery brand; Behrouz / paradise / blues biryani
  // patterns don't substring-match this input, so the result should be
  // Food Delivery.
  expect(hit?.category).toBe('Food Delivery');
  expect(hit?.confidence).toBe(0.95);
});

test('merchant DB returns null for empty / unknown strings', () => {
  expect(categorizeFromMerchantDB('')).toBeNull();
  expect(categorizeFromMerchantDB('zzqq totally unknown vendor')).toBeNull();
});

test('merchant DB categorizes common WhatsApp item words', () => {
  expect(categorizeFromMerchantDB(normalizeMerchant('coffee'))?.category).toBe(
    'Coffee & Beverages',
  );
  expect(categorizeFromMerchantDB(normalizeMerchant('coffie'))?.category).toBe(
    'Coffee & Beverages',
  );
  expect(categorizeFromMerchantDB(normalizeMerchant('lunch'))?.category).toBe('Restaurants');
  expect(categorizeFromMerchantDB(normalizeMerchant('food'))?.category).toBe('Restaurants');
});

// --- Tier 3 (MiniLM) -----------------------------------------------------

test('MiniLM tier returns null when no ONNX artifact is available', async () => {
  // The HF repo ships safetensors only — onnx/ is empty until someone runs
  // optimum-cli. The loader should detect that and return null forever
  // without throwing.
  const a = await categorizeWithMiniLM('uber ride to airport');
  const b = await categorizeWithMiniLM('zomato food order');
  expect(a).toBeNull();
  expect(b).toBeNull();
});

// --- Tier 1 (overrides) — DB-backed --------------------------------------

test.skipIf(!dbReady)('upsertOverride + getOverride round-trip and bump occurrences', async () => {
  if (!testSpaceId) throw new Error('expected testSpaceId after dbReady === true');
  const merchant = 'cafe test xyz';

  // First write: creates the row.
  await upsertOverride(testSpaceId, merchant, 'Coffee & Beverages');
  let hit = await getOverride(testSpaceId, merchant);
  expect(hit?.category).toBe('Coffee & Beverages');

  // Second write with a different category should replace + bump occurrences.
  await upsertOverride(testSpaceId, merchant, 'Restaurants');
  hit = await getOverride(testSpaceId, merchant);
  expect(hit?.category).toBe('Restaurants');

  const [row] = await db
    .select({ occurrences: categoryOverrides.occurrences })
    .from(categoryOverrides)
    .where(eq(categoryOverrides.spaceId, testSpaceId))
    .limit(1);
  expect(row).toBeDefined();
  // numeric(6,0) round-trips as a string in postgres-js.
  expect(Number(row?.occurrences ?? '0')).toBe(2);
});

test.skipIf(!dbReady)('getOverride returns null for unknown merchant', async () => {
  if (!testSpaceId) throw new Error('expected testSpaceId after dbReady === true');
  const hit = await getOverride(testSpaceId, 'never seen before merchant');
  expect(hit).toBeNull();
});
