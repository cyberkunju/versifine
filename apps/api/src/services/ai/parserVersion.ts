/**
 * Deterministic-parser version stamp for the utterance-memory cache.
 *
 * BUMP THIS whenever the deterministic extraction logic changes in a way that
 * could produce a DIFFERENT amount/currency/type for some inputs — i.e. edits
 * to parserRegex.ts (scale words, fractions, year discriminator, noise
 * stripping), debt.ts principal logic, or the parse merge in parser.ts.
 *
 * The utterance cache stamps each stored parse with this number; lookups
 * ignore rows below the current version. The effect: a parser upgrade
 * auto-invalidates exactly the utterances that predate it, so a returning
 * user who said "80 hazaar" (cached ₹80 under v0) re-parses once to ₹80,000
 * and re-caches under the new version — no full cache wipe, no stale numbers.
 *
 * History:
 *   1 — native scale words (hazaar/saavira/vela/lakh), L=lakh, phone/URL/card
 *       noise stripping, quantity-unit guard.
 *   2 — fractional/compound number words (dhai/sava/pona) + hundred scale,
 *       year-as-amount discriminator, fraction false-positive guard,
 *       LLM-mined temporal-year drop, loan-principal "for" head.
 */
export const CURRENT_PARSER_VERSION = 2;
