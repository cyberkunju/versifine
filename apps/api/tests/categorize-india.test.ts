/**
 * Categorize — India-first deterministic coverage.
 *
 * Production lesson: "Spent 200000 on mandi" was logged under "Other".
 * "mandi" is a popular Arabian/Hyderabadi rice-and-meat restaurant dish, so
 * it must categorize WITHOUT the LLM tier. This suite locks in the curated
 * merchant catalogue (tier 2) so common Indian dishes, drinks, kirana terms
 * and code-mixed slang resolve to a sensible category — never "Other".
 *
 * Everything here exercises pure functions (`categorizeFromMerchantDB` after
 * `normalizeMerchant`), the same path the live pipeline uses, so no database
 * is required. Style mirrors tests/categorize.test.ts.
 */
import { expect, test } from 'bun:test';
import {
  categorizeFromMerchantDB,
  merchantCatalogueSize,
} from '../src/services/categorize/merchants.ts';
import { normalizeMerchant } from '../src/services/transactions/normalize.ts';

/** Normalize → look up, exactly like the live waterfall's tier 2. */
function catOf(raw: string): string | null {
  const hit = categorizeFromMerchantDB(normalizeMerchant(raw));
  return hit ? hit.category : null;
}

// --- The production regression --------------------------------------------

test('"Spent 200000 on mandi" no longer falls to Other', () => {
  // The full utterance the bot parses down to a description; "mandi" is the
  // only meaningful token after normalization (amounts are stripped).
  expect(catOf('Spent 200000 on mandi')).toBe('Restaurants');
  expect(catOf('mandi')).toBe('Restaurants');
  expect(catOf('chicken mandi')).toBe('Restaurants');
});

// --- Dishes & meals → Restaurants -----------------------------------------

test('common Indian dishes/meals map to Restaurants', () => {
  const dishes = [
    'biryani',
    'dum biryani',
    'dosa',
    'masala dosa',
    'idli',
    'vada',
    'sambar',
    'paratha',
    'roti',
    'naan',
    'thali',
    'meals',
    'puttu',
    'appam',
    'porotta',
    'kothu',
    'sadhya',
    'pongal',
    'upma',
    'poha',
    'butter chicken',
    'paneer',
    'dal makhani',
    'kebab',
    'chicken tikka',
    'fried rice',
    'shawarma',
  ];
  for (const dish of dishes) {
    expect(catOf(dish)).toBe('Restaurants');
  }
});

// --- Quick bites / street food → Fast Food --------------------------------

test('street food and quick bites map to Fast Food', () => {
  const bites = [
    'vada pav',
    'pav bhaji',
    'samosa',
    'pakora',
    'momos',
    'noodles',
    'manchurian',
    'sandwich',
    'burger',
    'pizza',
    'kathi roll',
    'frankie',
    'maggi',
    'chaat',
    'pani puri',
    'bhel puri',
  ];
  for (const bite of bites) {
    expect(catOf(bite)).toBe('Fast Food');
  }
});

// --- Beverages → Coffee & Beverages ---------------------------------------

test('beverages map to Coffee & Beverages', () => {
  const drinks = [
    'chai',
    'cutting chai',
    'kaapi',
    'filter coffee',
    'lassi',
    'buttermilk',
    'fresh juice',
    'milkshake',
    'tender coconut',
    'cool drink',
    'soda',
  ];
  for (const drink of drinks) {
    expect(catOf(drink)).toBe('Coffee & Beverages');
  }
});

// --- Kirana / grocery vocabulary → Groceries ------------------------------

test('kirana and grocery words map to Groceries', () => {
  const grocery = [
    'sabzi',
    'vegetables',
    'kirana',
    'provisions',
    'milk',
    'eggs',
    'atta',
    'rice bag',
    'cooking oil',
    'onion',
    'tomato',
  ];
  for (const item of grocery) {
    expect(catOf(item)).toBe('Groceries');
  }
});

// --- Service vocabulary across categories ---------------------------------

test('common service words map to sensible categories', () => {
  expect(catOf('auto to office')).toBe('Transportation');
  expect(catOf('metro ride')).toBe('Transportation');
  expect(catOf('cab fare')).toBe('Transportation');
  expect(catOf('petrol')).toBe('Gas & Fuel');
  expect(catOf('diesel')).toBe('Gas & Fuel');
  expect(catOf('jio recharge')).toBe('Bills & Utilities');
  expect(catOf('mobile recharge')).toBe('Bills & Utilities');
  expect(catOf('electricity bill')).toBe('Bills & Utilities');
  expect(catOf('medicine')).toBe('Healthcare');
  expect(catOf('movie ticket')).toBe('Entertainment');
});

// --- Brand patterns still win over generic dish keywords ------------------

test('specific brands win over generic dish/word keywords', () => {
  // "swiggy biryani" must stay Food Delivery (brand contains beats keyword).
  expect(catOf('swiggy biryani 250')).toBe('Food Delivery');
  // Paradise is a famous biryani restaurant brand → Fast Food entry exists.
  expect(catOf('paradise biryani')).toBe('Fast Food');
  // Blinkit grocery delivery beats the "milk"/"rice" keyword tier.
  expect(catOf('blinkit milk and rice')).toBe('Groceries');
  // Apollo pharmacy beats the "medicine" keyword.
  expect(catOf('apollo pharmacy medicine')).toBe('Healthcare');
});

// --- Word-boundary safety: no false positives -----------------------------

test('keyword matching does not fire on substrings of unrelated words', () => {
  // "rice" must not match inside "price"; "dal" not inside "sandal";
  // "tea" not inside "steam"; "roti" not inside "rotina".
  expect(catOf('price negotiation consulting')).toBeNull();
  expect(catOf('sandal purchase order zzqq')).not.toBe('Groceries');
});

// --- Catalogue size sanity -------------------------------------------------

test('catalogue grew with the India-first expansion', () => {
  // The base catalogue was ~250; the dish/drink/grocery expansion pushes it
  // well past 600 compiled entries.
  expect(merchantCatalogueSize()).toBeGreaterThanOrEqual(600);
});
