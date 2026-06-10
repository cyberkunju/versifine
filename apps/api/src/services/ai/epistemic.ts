/**
 * Epistemic gate — does the user actually ASSERT a money event, or are they
 * negating / supposing / planning one?
 *
 * The whole pipeline treats "a number is present" as "a transaction happened".
 * Humans constantly say amounts they did NOT spend:
 *
 *   "I didn't pay the 500 rent yet"          → negated
 *   "if I buy the iPhone it'll cost 80000"   → hypothetical
 *   "should I spend 5000 on a watch?"        → hypothetical (a question)
 *   "rent will be 15000 next month"          → future intent
 *
 * Each of those currently mints a phantom transaction (or a confirm draft the
 * user reflexively taps). Inventing money is the single most trust-destroying
 * thing a finance bot can do, and it just got MORE likely now that the planner
 * executes compound baskets.
 *
 * DESIGN PRINCIPLE — precision over recall. A false BLOCK fails the user's
 * core action ("why didn't it log my chai?!"), which is exactly the complaint
 * we're fixing. So we only block when we are confident, and we use a
 * clause-level rule: if the message contains AT LEAST ONE plainly-asserted
 * money clause, we let it through (normal routing / the planner handle the
 * rest). We block only when EVERY money-bearing clause is non-assertive.
 *
 * Deterministic + multilingual. No LLM call — this runs on every inbound text
 * before classification, so it must be instant and free.
 */

/** Split a message into rough clauses on connectors + contrast markers. The
 *  contrast markers ("but", "lekin", "pakshe") matter most: "I didn't spend
 *  much but 200 on chai" must keep the asserted "200 on chai" clause alive. */
const CLAUSE_SPLIT =
  /\s*(?:,|;|\.|\band\b|\bbut\b|\bthen\b|\bso\b|\baur\b|\bya\b|\blekin\b|\bmagar\b|\bpinne\b|\bpakshe\b|\bennaal\b|\baana\b|\bumm\b)\s+/i;

/** A clause is "money-bearing" if it carries a digit run (the dominant trigger
 *  for a mint). Worded-only amounts are rare in the phantom cases and handled
 *  downstream; keeping this to digits avoids over-blocking. */
function hasMoney(clause: string): boolean {
  return /\d/.test(clause);
}

/** Negation cues — specific, verb-anchored where possible so a bare "no"/"not"
 *  can't nuke a real log. EN + romanised hi/ml/ta (Latin, \b-bounded). */
const NEGATION_RE =
  /\b(?:didn'?t|did\s+not|doesn'?t|does\s+not|don'?t|do\s+not|won'?t|will\s+not|haven'?t|have\s+not|hadn'?t|had\s+not|wasn'?t|isn'?t|never\s+(?:paid|spent|bought)|not\s+(?:yet\s+)?(?:pay|paid|paying|spend|spent|spending|buy|bought|buying|going|gonna)|no\s+longer)\b/i;
/** Romanised Indic negation. `mat`(Hindi don't) and `nai`(barber/name) are
 *  DROPPED — they collide with English "mat" and names, and the assertive-verb
 *  override would not always rescue them. */
const NEGATION_ROMAN_RE = /\b(?:nahi+n?|illa|venda|alla|illai|vendaam?)\b/i;
/** Native-script negation. Bounded with Unicode letter+mark lookarounds (\b
 *  does NOT work on Indic scripts), so വേണ്ട can't match inside വേണ്ടി ("for")
 *  and नहीं-family cues don't match inside longer words. */
const NEGATION_NATIVE_RE =
  /(?<![\p{L}\p{M}])(?:ഇല്ല|വേണ്ട|അല്ല|नहीं|नही|இல்லை|வேண்டாம்)(?![\p{L}\p{M}])/u;

/** An explicit PAST/perfective money verb. When present with the amount it
 *  OVERRIDES soft hypothetical/future cues: "spent 5000 considering it's
 *  diwali" is a real log, not a hypothetical. (Negation still wins — it
 *  attaches to the verb itself, "didn't pay".) */
const STRONG_ASSERTION_RE =
  /\b(?:spent|paid|bought|purchased|got|received|earned|sent|gave|given|lent|loaned|borrowed|withdrew|deposited|recharged)\b/i;

/** Hypothetical / conditional cues. Deliberately exclude bare "maybe"/"might"
 *  (too common in genuine casual logs) and keep the if/should/plan family. */
const HYPOTHETICAL_RE =
  /\b(?:if\s+i|should\s+i|shall\s+i|thinking\s+of|think\s+i\s+(?:should|might)|planning\s+to|plan\s+to|planning\s+on|considering|what\s+if|would\s+(?:it\s+)?(?:cost|be)|how\s+much\s+would|may\s+i\s+(?:spend|buy)|wanna\s+buy|want\s+to\s+buy)\b/i;
const HYPOTHETICAL_ROMAN_RE = /\b(?:agar|aanenkil|enkil|venuma|vaangalaama|edukkano)\b/i;
const HYPOTHETICAL_NATIVE_RE =
  /(?<![\p{L}\p{M}])(?:വേണോ|വാങ്ങണോ|ഉദ്ദേശി|എങ്കിൽ|अगर|खरीदूँ)(?![\p{L}\p{M}])/u;

/** Future-intent cues — anchored to a money verb (with a trailing \b so "will
 *  pay" can't match "will paid") so "next month" alone doesn't trip it. */
const FUTURE_RE =
  /\b(?:will\s+(?:pay|spend|buy|cost|be)|going\s+to\s+(?:pay|spend|buy)|gonna\s+(?:pay|spend|buy)|i'?ll\s+(?:pay|spend|buy)|about\s+to\s+(?:pay|spend|buy))\b/i;
/** Romanised Indic future-give/do markers ("kal 500 dunga", "naale tharum"). */
const FUTURE_ROMAN_RE = /\b(?:dunga|doonga|denge|karunga|karenge|lunga|loonga|tharum|tharaam|aakum|cheyyum|kodukkum)\b/i;

export type EpistemicReason = 'negated' | 'hypothetical' | 'future';

export interface EpistemicVerdict {
  /** true = at least one clause asserts a real money event → proceed normally.
   *  false = every money-bearing clause is non-assertive → do NOT mint. */
  assertive: boolean;
  reason: EpistemicReason | null;
}

function clauseStatus(clause: string): EpistemicReason | 'assertive' {
  // Negation is the strongest signal and binds to the verb ("didn't pay 500").
  if (NEGATION_RE.test(clause) || NEGATION_ROMAN_RE.test(clause) || NEGATION_NATIVE_RE.test(clause))
    return 'negated';
  // An explicit past-tense spend/income verb means it HAPPENED — this beats a
  // soft hypothetical/future cue elsewhere in the clause ("spent 5000
  // considering it's diwali", "paid 500, will pay rest later").
  if (STRONG_ASSERTION_RE.test(clause)) return 'assertive';
  if (HYPOTHETICAL_RE.test(clause) || HYPOTHETICAL_ROMAN_RE.test(clause) || HYPOTHETICAL_NATIVE_RE.test(clause))
    return 'hypothetical';
  if (FUTURE_RE.test(clause) || FUTURE_ROMAN_RE.test(clause)) return 'future';
  return 'assertive';
}

/**
 * Classify whether `text` asserts a money event. Returns `assertive:true`
 * (proceed) unless the message carries money ONLY inside non-assertive
 * clauses, in which case `assertive:false` with the dominant reason.
 */
export function classifyEpistemic(text: string): EpistemicVerdict {
  if (!text || !/\d/.test(text)) return { assertive: true, reason: null };

  const clauses = text
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  const scope = clauses.length > 0 ? clauses : [text];

  const moneyClauses = scope.filter(hasMoney);
  if (moneyClauses.length === 0) return { assertive: true, reason: null };

  const statuses = moneyClauses.map(clauseStatus);
  if (statuses.some((s) => s === 'assertive')) return { assertive: true, reason: null };

  // Every money clause is non-assertive → block. Pick a stable dominant reason
  // (negation is the strongest signal, then hypothetical, then future).
  const reason: EpistemicReason = statuses.includes('negated')
    ? 'negated'
    : statuses.includes('hypothetical')
      ? 'hypothetical'
      : 'future';
  return { assertive: false, reason };
}
