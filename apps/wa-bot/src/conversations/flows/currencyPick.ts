/**
 * Currency-disambiguation flow — "which riyal?".
 *
 * When the API returns `queryResult.kind === 'currency_choice'` (the user said
 * a generic "riyal"/"rial"/"dinar" with no country qualifier), the bot stashes
 * the options on the session and asks the user to pick. This flow handles the
 * follow-up reply: a number (1-N), a country name ("saudi"/"oman"), or a
 * direct ISO code ("SAR"/"OMR").
 *
 * Once resolved we re-issue `captureConfirm({draftId, edits:{currency}})` so
 * the FX layer converts at write time and the row records the user's chosen
 * country variant — no silent defaulting, no lost amount.
 */
import type { Session } from '../../types.ts';
import {
  type Currency,
  type CurrencyOption,
  AMBIGUOUS_CURRENCY_WORDS,
} from '@versifine/shared';
import { ApiClientError, captureConfirm } from '../../services/apiClient.ts';
import { setState, updateSession } from '../state.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';

/** TTL for a pending currency-pick — long enough for a thoughtful reply, short
 *  enough that an ignored prompt can't poison a fresh capture an hour later. */
const PICK_TTL_MS = 5 * 60_000;

interface PendingCurrencyChoice {
  draftId: string;
  word: string;
  options: CurrencyOption[];
  amount: number | null;
  ts: number;
}

/** Stash the API-returned options on the session so the next reply can resolve.
 *  We DON'T set state=CAPTURE_CONFIRM here — the currency-pick flow runs from
 *  the engine BEFORE the CAPTURE_CONFIRM state branch, so a CONFIRM-state
 *  handoff would intercept "saudi"/"1"/"OMR" as a free-form clarifier text. */
export function rememberCurrencyChoice(
  session: Session,
  draftId: string,
  word: string,
  options: CurrencyOption[],
  amount: number | null,
): void {
  const pending = { ...(session.pending ?? {}) };
  const choice: PendingCurrencyChoice = {
    draftId,
    word,
    options,
    amount,
    ts: Date.now(),
  };
  pending.currencyChoice = choice;
  updateSession(session.phone, {
    pending,
    lastDraftId: draftId,
  });
}

/** Read the pending currency-pick, or null if there's none / it expired. */
function readChoice(session: Session): PendingCurrencyChoice | null {
  const c = session.pending?.currencyChoice as PendingCurrencyChoice | undefined;
  if (!c || !c.draftId || !Array.isArray(c.options) || c.options.length === 0) return null;
  if (Date.now() - (c.ts ?? 0) > PICK_TTL_MS) return null;
  return c;
}

function clearChoice(session: Session): void {
  const pending = { ...(session.pending ?? {}) };
  delete pending.currencyChoice;
  updateSession(session.phone, { pending });
}

/** True when the session is awaiting a currency pick. */
export function hasPendingCurrencyChoice(session: Session): boolean {
  return readChoice(session) != null;
}

/**
 * Try to resolve `body` to one of the pending options. Match order:
 *   1. A bare number 1..N → the Nth option (visual order = popularity).
 *   2. An ISO code present in the option list ("SAR", "OMR").
 *   3. A country adjective/name ("saudi", "saudi arabia", "oman", "qatar"…)
 *      that maps via COUNTRY_ALIASES to a code in the option list.
 *   4. The bare currency word ("riyal" alone) → re-prompt (still ambiguous).
 *
 * Returns null when the input is clearly NOT a pick (so the engine can fall
 * through to other flows — a fresh expense like "spent 50 on lunch" should
 * NOT be hijacked by the picker).
 */
function resolvePick(
  body: string,
  options: CurrencyOption[],
): { code: Currency; option: CurrencyOption } | 'unknown' | 'pass' {
  const trimmed = body.trim();
  if (!trimmed) return 'pass';
  const lower = trimmed.toLowerCase();

  // 1) Numeric pick — must be a bare number (1..N) with no other words.
  const num = /^([1-9])$/.exec(trimmed);
  if (num) {
    const idx = Number(num[1]) - 1;
    const opt = options[idx];
    if (opt) return { code: opt.code, option: opt };
    return 'unknown';
  }

  // 2) Direct ISO code — only when it's the WHOLE message (so "i had 5 SAR
  //    coffee" doesn't get hijacked as a currency pick for the previous
  //    expense). Case-insensitive.
  const codeOnly = /^([a-z]{3})$/i.exec(trimmed);
  if (codeOnly) {
    const upper = codeOnly[1]!.toUpperCase();
    const opt = options.find((o) => o.code === upper);
    if (opt) return { code: opt.code, option: opt };
    return 'unknown';
  }

  // 3) Country adjective/name. Allow short, single-line answers only.
  if (trimmed.length > 30 || /[.\n!?]/.test(trimmed)) return 'pass';
  for (const opt of options) {
    const country = opt.country.toLowerCase();
    const adjective = COUNTRY_ADJECTIVES[opt.code]; // optional alternative form
    const re = new RegExp(
      `^(?:${country}|${country.replace(/\s+/g, '')}${adjective ? `|${adjective}` : ''})$`,
      'i',
    );
    if (re.test(lower)) return { code: opt.code, option: opt };
  }

  // 4) Bare ambiguous word again ("riyal") → re-prompt.
  if (Object.keys(AMBIGUOUS_CURRENCY_WORDS).includes(lower)) return 'unknown';

  // Anything else — let the engine try other flows. The user might be sending
  // a brand-new expense and the picker is stale.
  return 'pass';
}

/** ISO-code → country adjective (short form) for the country-name matcher. */
const COUNTRY_ADJECTIVES: Partial<Record<string, string>> = {
  SAR: 'saudi',
  OMR: 'omani|oman',
  QAR: 'qatari|qatar',
  YER: 'yemeni|yemen',
  IRR: 'iranian|iran',
  KWD: 'kuwaiti|kuwait',
  BHD: 'bahraini|bahrain',
  JOD: 'jordanian|jordan',
  IQD: 'iraqi|iraq',
  LYD: 'libyan|libya',
  TND: 'tunisian|tunisia',
};

/**
 * Engine integration point — called BEFORE the reference resolver and
 * correction shortcuts. Returns the localized reply when the body resolved a
 * pending currency pick (or asks the user to retry); null when there is no
 * pending pick OR the body clearly isn't a pick (so the engine continues).
 */
export async function tryResolveCurrencyChoice(
  session: Session,
  body: string,
): Promise<{ text: string; speakable?: string } | null> {
  const choice = readChoice(session);
  if (!choice) return null;

  const m = getMessages(session.language);
  const verdict = resolvePick(body, choice.options);

  if (verdict === 'pass') {
    // Not a pick — let the engine try other flows. We do NOT clear the
    // pending state here so a subsequent "1" or "saudi" still works (within
    // PICK_TTL_MS).
    return null;
  }

  if (verdict === 'unknown') {
    return { text: m.currencyChoiceUnknown(choice.word, choice.options) };
  }

  // Resolved — call captureConfirm with the chosen currency.
  try {
    const history = (session.pending?.history as any[]) || [];
    const response = await captureConfirm(session.phone, {
      draftId: choice.draftId,
      edits: { currency: verdict.code },
      history,
    });
    clearChoice(session);
    if (!response.needsConfirmation) {
      updateSession(session.phone, { lastDraftId: null });
      setState(session.phone, 'LINKED_MAIN');
    }
    // The API's persist response carries baseAmount/baseCurrency on the row;
    // surface it so the user sees both the chosen currency AND its INR value.
    const tx = response.queryResult?.transaction as
      | {
          id?: string;
          amount: number;
          currency: string;
          baseAmount?: number;
          baseCurrency?: string;
          category: string | null;
          description?: string;
        }
      | undefined;
    if (tx) {
      const text = m.captureLogged(
        tx.amount,
        tx.currency,
        tx.category,
        tx.baseAmount,
        tx.baseCurrency,
      );
      return { text, speakable: text };
    }
    // Fallback acknowledgement when the API didn't return a finished tx
    // (e.g. wallet still missing) — render the structured choice and let the
    // next clarifier round complete the draft.
    const text = m.currencyChosen(
      verdict.option.code,
      verdict.option.name,
      choice.amount ?? 0,
      null,
      null,
    );
    return { text, speakable: text };
  } catch (err) {
    log.warn('CURRENCY_PICK_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    clearChoice(session);
    return { text: m.error };
  }
}
