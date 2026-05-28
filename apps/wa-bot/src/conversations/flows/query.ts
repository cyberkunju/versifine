/**
 * Fast-path matcher for "how much on X (this month)?" style questions.
 *
 * The full intent classifier on the API already handles these — this is
 * a local pattern that lets us skip a network hop when the user types a
 * recognisable shape. Returns null when we should hand the message back
 * to the regular capture pipeline.
 */
const QUERY_PATTERNS: ReadonlyArray<RegExp> = [
  /^how\s+much\s+(?:did\s+i\s+)?(?:spent|spend|spending|paid)\s+(?:on|for)\s+([a-z &-]+?)\s*(this\s+month)?\??$/i,
  /^what(?:'s| is)?\s+my\s+(?:spend|spending|expense|expenses)\s+on\s+([a-z &-]+?)\s*(this\s+month)?\??$/i,
];

export interface FastQueryHit {
  category: string;
  scope: 'this_month';
}

export function parseFastQuery(text: string): FastQueryHit | null {
  const trimmed = text.trim();
  for (const pattern of QUERY_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return {
        category: match[1].trim(),
        scope: 'this_month',
      };
    }
  }
  return null;
}
