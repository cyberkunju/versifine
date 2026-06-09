/**
 * Reference Resolver — maps a natural-language reference like "the coffee one",
 * "that ₹500 lunch", "yesterday's uber", "last 3 entries" to concrete
 * transaction IDs. Powers corrections and deletes on non-last entries.
 *
 * Three complementary strategies, tried in order of reliability:
 *
 *   1. STRUCTURAL (always tried first, no AI)
 *      "last N" / "last one" / "last two" → recent N by created_at.
 *      "today's" / "yesterday's" → date-bounded.
 *      "the ₹500 one" / "the 500 rupees one" → exact amount match in recent.
 *
 *   2. KEYWORD (trigram + description/category filter, no embedding)
 *      "the coffee one" → ilike description %coffee%.
 *      "the swiggy one" → merchant match.
 *
 *   3. SEMANTIC (Cohere embedding cosine similarity — only when structural
 *      and keyword miss)
 *      Embeds the reference query and finds the closest transaction embedding.
 *
 * Returns up to MAX_MATCHES candidates ranked by confidence, so the caller can
 * ask "Did you mean ₹250 coffee?" when there is only one clear winner, or
 * "Which one? A) ₹500 lunch B) ₹250 coffee" when there are several.
 *
 * Never throws — returns [] on any failure so callers fall through gracefully.
 */
import { and, desc, eq, gte, ilike, isNull, lte, sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { transactionEmbeddings } from '../../db/schema/embeddings.ts';
import { embed, EMBEDDING_DIM } from '../ai/embed.ts';
import { extractAmount } from '../ai/parserRegex.ts';
import { log } from '../../utils/logger.ts';

export interface ResolvedTransaction {
  id: string;
  amount: number;
  currency: string;
  description: string;
  category: string | null;
  date: string;
  confidence: number; // 0-1
}

const MAX_MATCHES = 3;
// Conservative threshold: 0.65 over-matches for unrelated items (a "lunch"
// query semantically returning an "auto" entry). 0.80 keeps real synonyms
// (chai/tea, swiggy/zomato/food-delivery) while rejecting weak associations.
// If structural/keyword strategies miss AND nothing semantically matches at
// this threshold, the bot asks the user to clarify rather than mis-resolving.
const SEMANTIC_THRESHOLD = 0.80;

/** Date helpers (ISO YYYY-MM-DD) */
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Strategy 1: structural matching by count, date or exact amount. */
async function resolveStructural(
  spaceId: string,
  query: string,
): Promise<ResolvedTransaction[] | null> {
  const lower = query.toLowerCase();

  // "last N" / "last one/two/three"
  const lastNMap: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  };
  const lastN = /\blast\s+(\d+|one|two|three|four|five)\b/i.exec(lower);
  const n = lastN ? (lastNMap[lastN[1]!.toLowerCase()] ?? Number(lastN[1]!)) : null;
  if (n && n >= 1 && n <= 10) {
    const rows = await db.select()
      .from(transactions)
      .where(and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt)))
      .orderBy(desc(transactions.createdAt))
      .limit(n);
    return rows.map((r, i) => ({
      id: r.id, amount: Number(r.amount), currency: r.currency,
      description: r.description, category: r.category, date: r.date,
      confidence: 0.9 - i * 0.05,
    }));
  }

  // "today's" / "yesterday's" / "this morning's"
  const isToday = /\b(today'?s?|this morning'?s?|this evening'?s?)\b/i.test(lower);
  const isYest = /\b(yesterday'?s?|last night'?s?)\b/i.test(lower);
  if (isToday || isYest) {
    const date = isToday ? isoToday() : isoYesterday();
    const rows = await db.select()
      .from(transactions)
      .where(and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        eq(transactions.date, date),
      ))
      .orderBy(desc(transactions.createdAt))
      .limit(MAX_MATCHES);
    if (rows.length)
      return rows.map((r, i) => ({
        id: r.id, amount: Number(r.amount), currency: r.currency,
        description: r.description, category: r.category, date: r.date,
        confidence: 0.85 - i * 0.05,
      }));
  }

  // Exact amount: "the ₹500 one", "the 500 rupees one", "that 250 one"
  const amtEx = extractAmount(query);
  if (amtEx.amount !== null) {
    const amtStr = amtEx.amount.toFixed(2);
    const rows = await db.select()
      .from(transactions)
      .where(and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        drizzleSql`round(${transactions.amount}::numeric, 2) = ${amtStr}::numeric`,
      ))
      .orderBy(desc(transactions.createdAt))
      .limit(MAX_MATCHES);
    if (rows.length)
      return rows.map((r, i) => ({
        id: r.id, amount: Number(r.amount), currency: r.currency,
        description: r.description, category: r.category, date: r.date,
        confidence: 0.88 - i * 0.05,
      }));
  }

  return null;
}

/** Strategy 2: keyword/trigram on description+category. */
async function resolveKeyword(
  spaceId: string,
  query: string,
): Promise<ResolvedTransaction[] | null> {
  // Strip common filler words and possessives to get the merchant/item token.
  const token = query
    .replace(/\b(the|that|a|an|my|this|one|for|on|please|last|delete|remove|fix|edit|change|undo|it|entry|transaction|expense|purchase)\b/gi, ' ')
    .replace(/'s\b/gi, '')
    .replace(/[₹$€£¥]/g, '')
    .replace(/\d[\d,]*(?:\.\d+)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!token || token.length < 2) return null;

  const rows = await db.select()
    .from(transactions)
    .where(and(
      eq(transactions.spaceId, spaceId),
      isNull(transactions.deletedAt),
      ilike(transactions.description, `%${token}%`),
    ))
    .orderBy(desc(transactions.createdAt))
    .limit(MAX_MATCHES);
  if (rows.length)
    return rows.map((r, i) => ({
      id: r.id, amount: Number(r.amount), currency: r.currency,
      description: r.description, category: r.category, date: r.date,
      confidence: 0.78 - i * 0.08,
    }));

  // Also try category match.
  const catRows = await db.select()
    .from(transactions)
    .where(and(
      eq(transactions.spaceId, spaceId),
      isNull(transactions.deletedAt),
      ilike(transactions.category, `%${token}%`),
    ))
    .orderBy(desc(transactions.createdAt))
    .limit(MAX_MATCHES);
  if (catRows.length)
    return catRows.map((r, i) => ({
      id: r.id, amount: Number(r.amount), currency: r.currency,
      description: r.description, category: r.category, date: r.date,
      confidence: 0.70 - i * 0.08,
    }));

  return null;
}

/** Strategy 3: semantic embedding cosine search via pgvector. */
async function resolveSemantic(
  spaceId: string,
  query: string,
): Promise<ResolvedTransaction[] | null> {
  let qVec: number[];
  try {
    qVec = await embed(query);
  } catch {
    return null;
  }
  const vecLit = `[${qVec.join(',')}]`;
  try {
    const rows = await db
      .select({
        transactionId: transactionEmbeddings.transactionId,
        similarity: drizzleSql<number>`1 - (embedding <=> ${vecLit}::vector(${drizzleSql.raw(String(EMBEDDING_DIM))}))`,
      })
      .from(transactionEmbeddings)
      .innerJoin(
        transactions,
        and(
          eq(transactions.id, transactionEmbeddings.transactionId),
          eq(transactions.spaceId, spaceId),
          isNull(transactions.deletedAt),
        ),
      )
      .orderBy(drizzleSql`embedding <=> ${vecLit}::vector(${drizzleSql.raw(String(EMBEDDING_DIM))})`)
      .limit(MAX_MATCHES);

    const strong = rows.filter((r) => r.similarity >= SEMANTIC_THRESHOLD);
    if (!strong.length) return null;

    const ids = strong.map((r) => r.transactionId);
    const txs = await db.select()
      .from(transactions)
      .where(and(
        eq(transactions.spaceId, spaceId),
        drizzleSql`${transactions.id} = any(${ids})`,
        isNull(transactions.deletedAt),
      ));

    return strong.map((r) => {
      const tx = txs.find((t) => t.id === r.transactionId);
      if (!tx) return null;
      return {
        id: tx.id, amount: Number(tx.amount), currency: tx.currency,
        description: tx.description, category: tx.category, date: tx.date,
        confidence: r.similarity,
      };
    }).filter(Boolean) as ResolvedTransaction[];
  } catch {
    return null;
  }
}

/**
 * Resolve a natural-language reference ("the coffee one", "that ₹500 lunch",
 * "last 3") to transaction candidates. Returns up to MAX_MATCHES ranked by
 * confidence. Returns [] when nothing matches or on any failure.
 *
 * `intent='mutate'` (default for change/delete commands) DISABLES the semantic
 * fallback so a fuzzy embedding match can never silently corrupt the ledger.
 * For destructive ops we want a strong structural/keyword match or nothing —
 * the bot then asks the user to clarify rather than guessing.
 * `intent='read'` allows the full waterfall (structural → keyword → semantic).
 */
export async function resolveReference(
  spaceId: string,
  query: string,
  intent: 'read' | 'mutate' = 'mutate',
): Promise<ResolvedTransaction[]> {
  if (!query?.trim()) return [];
  try {
    const structural = await resolveStructural(spaceId, query);
    if (structural?.length) return structural.slice(0, MAX_MATCHES);
    const keyword = await resolveKeyword(spaceId, query);
    if (keyword?.length) return keyword.slice(0, MAX_MATCHES);
    if (intent === 'mutate') return []; // do NOT semantic-match destructive ops
    const semantic = await resolveSemantic(spaceId, query);
    return (semantic ?? []).slice(0, MAX_MATCHES);
  } catch (err) {
    log.warn('REF_RESOLVER_FAIL', { error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    return [];
  }
}
