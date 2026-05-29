/**
 * Message-pack router.
 *
 * Three languages (en, hi, ml) ship with hand-translated copy; the other
 * three (ta, te, kn) borrow the English pack and route every outgoing
 * string through the API's translate service at send time. The router
 * keeps that decision in one place — every flow file just does:
 *
 *     const m = getMessages(session.language);
 *     await reply(m.captureLogged(450, 'INR', 'Transportation'));
 *
 * and the engine handles the per-language rendering.
 */
import type { Language } from '@versifine/shared';
import { en } from './en.ts';
import { hi } from './hi.ts';
import { ml } from './ml.ts';
import type { MessagePack } from './types.ts';

export type { MessagePack } from './types.ts';

const PACKS: Partial<Record<Language, MessagePack>> = {
  en,
  hi,
  ml,
};

/**
 * Return the best-fit message pack. ta/te/kn borrow English; the engine
 * is responsible for translating the rendered string before sending.
 */
export function getMessages(language: Language): MessagePack {
  return PACKS[language] ?? en;
}

/**
 * True when the language has a hand-translated pack and never needs
 * runtime translation. en/hi/ml return true; ta/te/kn return false.
 */
export function hasNativePack(language: Language): boolean {
  return PACKS[language] !== undefined;
}
