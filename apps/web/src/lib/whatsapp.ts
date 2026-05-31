/**
 * WhatsApp demo deep-link.
 *
 * The landing page funnels visitors to the bot through a wa.me link that
 * pre-fills an EXACT phrase. The bot grants demo access to any number that
 * sends this phrase (see apps/wa-bot/src/services/allowlist.ts), so the two
 * strings MUST stay byte-identical — keep them in sync if either changes.
 */

/** The operator's bot number, digits only (country code + number, no '+'). */
export const WA_DEMO_NUMBER = '918330040958';

/**
 * The pre-filled message. Byte-identical to `DEMO_REQUEST_PHRASE` in
 * apps/wa-bot/src/services/allowlist.ts. The bot match is punctuation- and
 * case-tolerant, but we send the canonical form.
 */
export const WA_DEMO_TEXT = 'Hi, Requesting whatsapp demo for versifine.';

/** Ready-to-use wa.me deep link with the demo phrase pre-filled. */
export const WA_DEMO_LINK = `https://wa.me/${WA_DEMO_NUMBER}?text=${encodeURIComponent(WA_DEMO_TEXT)}`;
