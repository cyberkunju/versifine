/**
 * In-memory draft cache.
 *
 * When a capture cannot be persisted directly (low confidence, missing
 * amount, or an image that always needs review) the parsed payload
 * lives here keyed by a short id. The user gets that id back in the
 * response and uses it to confirm or amend.
 *
 * TTL is 5 minutes. The capture flow is meant to be conversational —
 * if the user wandered off and came back an hour later we'd rather ask
 * fresh questions than commit a half-remembered draft.
 *
 * The store is per-process. Distributing it would require Redis; not a
 * hackathon need. Drafts are scoped to the originating user/space so
 * a stray draftId from another tenant cannot be redeemed.
 */
import { isLanguage, type Language } from '@finehance/shared';
import { type ParsedExpense } from '../ai/parser.ts';

export interface DraftRecord {
  id: string;
  spaceId: string;
  userId: string;
  origin: 'text' | 'voice' | 'image';
  /** Original utterance / OCR result so the timeline can render it. */
  source: string;
  locale: Language | null;
  draft: ParsedExpense;
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const drafts = new Map<string, DraftRecord>();
let lastSweep = 0;

function maybeSweep(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [id, record] of drafts) {
    if (record.expiresAt <= now) drafts.delete(id);
  }
}

function shortId(): string {
  // Compact, URL-safe id. We don't need ULID's monotonic ordering here.
  // crypto.randomUUID() is universally available in Bun and Node 20+.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 22);
}

export interface DraftSeed {
  spaceId: string;
  userId: string;
  origin: 'text' | 'voice' | 'image';
  source: string;
  locale?: string | null;
  draft: ParsedExpense;
}

export function storeDraft(seed: DraftSeed): DraftRecord {
  maybeSweep();
  const id = shortId();
  const now = Date.now();
  const locale: Language | null = seed.locale && isLanguage(seed.locale) ? (seed.locale as Language) : null;
  const record: DraftRecord = {
    id,
    spaceId: seed.spaceId,
    userId: seed.userId,
    origin: seed.origin,
    source: seed.source,
    locale,
    draft: seed.draft,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  drafts.set(id, record);
  return record;
}

export function getDraft(id: string): DraftRecord | null {
  maybeSweep();
  const record = drafts.get(id);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    drafts.delete(id);
    return null;
  }
  return record;
}

export function consumeDraft(id: string): DraftRecord | null {
  const record = getDraft(id);
  if (!record) return null;
  drafts.delete(id);
  return record;
}

/** Test/debug only. */
export function _resetDraftStoreForTests(): void {
  drafts.clear();
  lastSweep = 0;
}
