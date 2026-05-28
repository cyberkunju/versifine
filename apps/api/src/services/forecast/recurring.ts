/**
 * Recurring detector.
 *
 * Spots repeating expenses by walking the last 90 days of transactions,
 * grouping by normalized merchant, and asking three questions of every
 * group with three or more occurrences:
 *
 *   1. Are the amounts steady? coefficient of variation ≤ 0.15.
 *   2. Are the dates evenly spaced? median diff falls inside one of three
 *      tolerated bands (weekly / monthly / quarterly).
 *   3. Does the math support a confidence ≥ 0.5?
 *
 * Anything that survives gets upserted into `recurring_items`. We key on
 * `(space_id, merchant_normalized)` so the second pass updates rather than
 * duplicates. New rows fire `recurring.detected` over the WS bus; updates
 * stay quiet — the user already knows about that subscription.
 *
 * Confidence score: `0.5 + (occurrences/20)*0.3 + (1-cv)*0.2`. Twenty hits
 * earns the full streak bonus, a flat amount earns the full stability bonus,
 * and we cap at 0.99 to leave room for "this exists" rather than "this is
 * absolutely certain". The threshold is loose by design — false positives
 * cost a single dismiss click, false negatives cost a missed forecast.
 */
import { and, eq, gte, isNull, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  recurringItems,
  type NewRecurringItem,
  type RecurringItem,
} from '../../db/schema/recurring.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { log } from '../../utils/logger.ts';
import { errors } from '../../utils/errors.ts';
import { emit } from '../events/bus.ts';
import { normalizeMerchant } from '../transactions/normalize.ts';

const LOOKBACK_DAYS = 90;
const MIN_OCCURRENCES = 3;
const MAX_AMOUNT_CV = 0.15;

interface FrequencyBand {
  label: 'weekly' | 'monthly' | 'quarterly';
  min: number;
  max: number;
}

const FREQUENCY_BANDS: FrequencyBand[] = [
  { label: 'weekly', min: 6, max: 8 },
  { label: 'monthly', min: 28, max: 32 },
  { label: 'quarterly', min: 88, max: 92 },
];

interface Candidate {
  merchantNormalized: string;
  displayName: string;
  amounts: number[];
  dates: Date[];
  currency: string;
}

export interface DetectorResult {
  created: number;
  updated: number;
  total: number;
}

/**
 * Run the detector for a space and persist every accepted candidate.
 * The userId is only used to address WS broadcasts — detection itself
 * is space-scoped.
 */
export async function runDetector(
  userId: string,
  spaceId: string,
): Promise<DetectorResult> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
  const sinceIso = since.toISOString().slice(0, 10);

  const rows = await db
    .select({
      amount: transactions.baseAmount,
      currency: transactions.currency,
      description: transactions.description,
      date: transactions.date,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        gte(transactions.date, sinceIso),
      ),
    );

  // Group by normalized merchant. Empty keys (description that normalized
  // to nothing) fall on the floor — those are typically cash/UPI ghosts.
  const groups = new Map<string, Candidate>();
  for (const row of rows) {
    const merchant = normalizeMerchant(row.description);
    if (!merchant) continue;
    let bucket = groups.get(merchant);
    if (!bucket) {
      bucket = {
        merchantNormalized: merchant,
        displayName: row.description.trim().slice(0, 200),
        amounts: [],
        dates: [],
        currency: row.currency,
      };
      groups.set(merchant, bucket);
    }
    bucket.amounts.push(Number(row.amount));
    bucket.dates.push(new Date(`${row.date}T00:00:00Z`));
  }

  let created = 0;
  let updated = 0;
  let evaluated = 0;

  for (const candidate of groups.values()) {
    if (candidate.amounts.length < MIN_OCCURRENCES) continue;
    evaluated += 1;

    const stats = analyseCandidate(candidate);
    if (!stats) continue;

    const upsert = await persistCandidate(spaceId, candidate, stats);
    if (upsert.didCreate) {
      created += 1;
      emit(userId, {
        type: 'recurring.detected',
        entityId: upsert.row.id,
        data: {
          recurringId: upsert.row.id,
          displayName: upsert.row.displayName,
          averageAmount: Number(upsert.row.averageAmount),
          frequencyDays: upsert.row.frequencyDays,
        },
      });
    } else {
      updated += 1;
    }
  }

  log.info('RECURRING_DETECT_OK', {
    spaceId,
    candidates: evaluated,
    created,
    updated,
  });

  return { created, updated, total: created + updated };
}

interface CandidateStats {
  averageAmount: number;
  frequencyDays: number;
  occurrences: number;
  confidence: number;
  nextExpectedDate: string;
}

function analyseCandidate(candidate: Candidate): CandidateStats | null {
  const amounts = candidate.amounts;
  const dates = [...candidate.dates].sort((a, b) => a.getTime() - b.getTime());

  const mean = average(amounts);
  if (mean <= 0) return null;
  const stddev = sampleStddev(amounts, mean);
  const cv = stddev / mean;
  if (cv > MAX_AMOUNT_CV) return null;

  // Use sorted unique dates so multiple charges on one day count once for
  // cadence purposes. We keep the original count for the occurrence number.
  const sortedUnique = uniqueSortedDates(dates);
  if (sortedUnique.length < MIN_OCCURRENCES) return null;
  const diffs: number[] = [];
  for (let i = 1; i < sortedUnique.length; i += 1) {
    const a = sortedUnique[i - 1];
    const b = sortedUnique[i];
    if (!a || !b) continue;
    const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
    if (days > 0) diffs.push(days);
  }
  if (diffs.length === 0) return null;
  const medianDiff = Math.round(median(diffs));
  const band = FREQUENCY_BANDS.find((b) => medianDiff >= b.min && medianDiff <= b.max);
  if (!band) return null;

  const occurrences = candidate.amounts.length;
  const occurrenceBoost = Math.min(occurrences / 20, 1) * 0.3;
  const stabilityBoost = (1 - Math.min(cv, 1)) * 0.2;
  const confidence = Math.min(0.5 + occurrenceBoost + stabilityBoost, 0.99);

  const last = sortedUnique[sortedUnique.length - 1];
  if (!last) return null;
  const next = new Date(last);
  next.setUTCDate(next.getUTCDate() + medianDiff);

  return {
    averageAmount: round2(mean),
    frequencyDays: medianDiff,
    occurrences,
    confidence: roundConfidence(confidence),
    nextExpectedDate: next.toISOString().slice(0, 10),
  };
}

interface UpsertResult {
  row: RecurringItem;
  didCreate: boolean;
}

async function persistCandidate(
  spaceId: string,
  candidate: Candidate,
  stats: CandidateStats,
): Promise<UpsertResult> {
  const insertValues: NewRecurringItem = {
    spaceId,
    merchantNormalized: candidate.merchantNormalized,
    displayName: candidate.displayName,
    averageAmount: stats.averageAmount.toFixed(2),
    currency: candidate.currency,
    frequencyDays: stats.frequencyDays,
    nextExpectedDate: stats.nextExpectedDate,
    occurrences: stats.occurrences,
    confidence: stats.confidence.toFixed(2),
  };

  // `xmax = 0` is Postgres's tell that the row was a fresh insert vs an
  // update via ON CONFLICT. We surface that to know whether to fire the
  // `recurring.detected` event.
  const result = await db
    .insert(recurringItems)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [recurringItems.spaceId, recurringItems.merchantNormalized],
      set: {
        displayName: insertValues.displayName,
        averageAmount: insertValues.averageAmount,
        currency: insertValues.currency,
        frequencyDays: insertValues.frequencyDays,
        nextExpectedDate: insertValues.nextExpectedDate,
        occurrences: insertValues.occurrences,
        confidence: insertValues.confidence,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: recurringItems.id,
      spaceId: recurringItems.spaceId,
      merchantNormalized: recurringItems.merchantNormalized,
      displayName: recurringItems.displayName,
      averageAmount: recurringItems.averageAmount,
      currency: recurringItems.currency,
      frequencyDays: recurringItems.frequencyDays,
      nextExpectedDate: recurringItems.nextExpectedDate,
      occurrences: recurringItems.occurrences,
      confidence: recurringItems.confidence,
      status: recurringItems.status,
      detectedAt: recurringItems.detectedAt,
      updatedAt: recurringItems.updatedAt,
      created: drizzleSql<boolean>`(xmax = 0)`,
    });

  const first = result[0];
  if (!first) throw errors.internal('Failed to upsert recurring item');
  const { created, ...row } = first;
  return { row: row as RecurringItem, didCreate: Boolean(created) };
}

export interface ListRecurringOptions {
  status?: 'active' | 'dismissed';
}

export async function listRecurring(
  spaceId: string,
  opts: ListRecurringOptions = {},
): Promise<RecurringItem[]> {
  const filters = [eq(recurringItems.spaceId, spaceId)];
  if (opts.status) filters.push(eq(recurringItems.status, opts.status));
  return await db
    .select()
    .from(recurringItems)
    .where(and(...filters));
}

export async function dismissRecurring(
  spaceId: string,
  recurringId: string,
): Promise<RecurringItem> {
  return await setRecurringStatus(spaceId, recurringId, 'dismissed');
}

export async function setRecurringStatus(
  spaceId: string,
  recurringId: string,
  status: 'active' | 'dismissed',
): Promise<RecurringItem> {
  const [row] = await db
    .update(recurringItems)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(recurringItems.id, recurringId), eq(recurringItems.spaceId, spaceId)),
    )
    .returning();
  if (!row) throw errors.notFound('Recurring item not found');
  return row;
}

// ---------- maths helpers ----------

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function sampleStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  let s = 0;
  for (const v of values) s += (v - mean) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

function uniqueSortedDates(dates: Date[]): Date[] {
  const seen = new Set<number>();
  const out: Date[] = [];
  for (const d of dates) {
    const key = d.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    if (a === undefined || b === undefined) return 0;
    return (a + b) / 2;
  }
  return sorted[mid] ?? 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

export type { RecurringItem };
