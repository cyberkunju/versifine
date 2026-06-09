/**
 * Currency disambiguation — "which riyal/rial/dinar?".
 *
 * The API returns `queryResult.kind === 'currency_choice'` when the user
 * said a generic ambiguous currency word with no country qualifier. We
 * stash an `openFrame` and ask the user to pick. The next inbound goes
 * through the openFrame resolver BEFORE settings/copilot/capture (engine
 * ordering), so a bare `Omr`, `1`, or `saudi` resolves the picker rather
 * than being mis-routed to onboarding.
 *
 * Match order in the resolver:
 *   1. Numeric pick (1..N)
 *   2. ISO code that's in the option list
 *   3. Country name/adjective ("saudi", "kuwait", "iran")
 *   4. The bare ambiguous word ("riyal" again) → re-prompt
 *   5. Anything else → release the frame; engine handles fresh.
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
import {
  type FrameOption,
  type OpenFrame,
  type ResolverVerdict,
  openFrame as setOpenFrame,
  registerResolver,
} from '../openFrame.ts';

interface CurrencyChoiceContext extends Record<string, unknown> {
  draftId: string;
  word: string;
  amount: number | null;
  /** Full option set (with country names + native code) so the resolver can
   *  re-render the prompt on a retry without re-fetching from the API. */
  options: CurrencyOption[];
}

/** ISO-code → country adjective alternatives for the country-name matcher.
 *  Pipe-separated alternation; each alternative is a complete word the user
 *  might send. Hyphenated forms ("saudi-arabia") and compact spellings
 *  ("saudia", "ksa") are normalised before the regex sees the input, so we
 *  don't need to enumerate them here. */
const COUNTRY_ADJECTIVES: Partial<Record<string, string>> = {
  SAR: 'saudi|ksa|saudia',
  OMR: 'omani|oman',
  QAR: 'qatari|qatar',
  YER: 'yemeni|yemen',
  IRR: 'iranian|iran|persian',
  KWD: 'kuwaiti|kuwait',
  BHD: 'bahraini|bahrain',
  JOD: 'jordanian|jordan',
  IQD: 'iraqi|iraq',
  LYD: 'libyan|libya',
  TND: 'tunisian|tunisia',
};

/** Strip outer whitespace + outer punctuation so "saudi please!" / "Yeah, saudi."
 *  resolve to the bare country name. Internal whitespace is preserved so
 *  "saudi arabia" still matches its country regex. */
function tidyAnswer(body: string): string {
  return body
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stash a currency-choice frame on the session. Called by renderCaptureResponse
 * when the API returns `queryResult.kind === 'currency_choice'`.
 */
export function rememberCurrencyChoice(
  session: Session,
  draftId: string,
  word: string,
  options: CurrencyOption[],
  amount: number | null,
): void {
  const frameOptions: FrameOption[] = options.map((o) => ({
    id: o.code,
    label: `${o.name} (${o.code})`,
    payload: o,
  }));
  const m = getMessages(session.language);
  setOpenFrame(session, {
    kind: 'currency_choice',
    prompt: m.currencyChoicePrompt(word, options, amount),
    options: frameOptions,
    context: { draftId, word, amount, options } satisfies CurrencyChoiceContext,
  });
  // Track the lastDraftId so confirm-state recovery (image upload mid-frame,
  // CONFIRM/CANCEL) still has the draft to operate against.
  updateSession(session.phone, { lastDraftId: draftId });
}

/** Resolve `body` to one of the known options. */
function resolvePick(
  body: string,
  options: CurrencyOption[],
):
  | { kind: 'option'; code: Currency; option: CurrencyOption }
  | { kind: 'unknown' }
  | { kind: 'unrelated' } {
  const trimmed = tidyAnswer(body);
  if (!trimmed) return { kind: 'unrelated' };
  const lower = trimmed.toLowerCase();

  // 1) Numeric pick — supports up to 99 options (we cap UX at ~10 but the
  //    matcher is forward-compatible). Whole message must be a bare number.
  const numMatch = /^([1-9][0-9]?)$/.exec(trimmed);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    const opt = options[idx];
    if (opt) return { kind: 'option', code: opt.code, option: opt };
    // Number out of range — user is trying to answer but missed. Keep frame.
    return { kind: 'unknown' };
  }

  // 2) Direct ISO code (whole message is exactly 3 letters).
  const codeMatch = /^([a-z]{3})$/i.exec(trimmed);
  if (codeMatch) {
    const upper = codeMatch[1]!.toUpperCase();
    const opt = options.find((o) => o.code === upper);
    if (opt) return { kind: 'option', code: opt.code, option: opt };
    // 3-letter code that's NOT in the option set (e.g. user types "USD" mid
    // riyal-flow). Keep the frame open and re-prompt — most likely an
    // attempted answer that just hit the wrong code, not a brand-new utterance.
    return { kind: 'unknown' };
  }

  // 3) Country name / adjective. Short single-line answers only — anything
  //    longer is much more likely a fresh utterance ("spent 50 on chai").
  if (trimmed.length > 30 || /[\n]/.test(trimmed)) return { kind: 'unrelated' };
  for (const opt of options) {
    const country = opt.country.toLowerCase();
    const adj = COUNTRY_ADJECTIVES[opt.code];
    const re = new RegExp(
      `^(?:${country}|${country.replace(/\s+/g, '')}${adj ? `|${adj}` : ''})$`,
      'i',
    );
    if (re.test(lower)) return { kind: 'option', code: opt.code, option: opt };
  }

  // 4) Bare ambiguous word again → user is confused, re-prompt.
  if (Object.keys(AMBIGUOUS_CURRENCY_WORDS).includes(lower)) return { kind: 'unknown' };

  // 5) Anything else — release the frame; engine handles fresh.
  return { kind: 'unrelated' };
}

const currencyResolver = async (
  session: Session,
  body: string,
  frame: OpenFrame,
): Promise<ResolverVerdict> => {
  const ctx = frame.context as CurrencyChoiceContext;
  if (!ctx?.draftId || !Array.isArray(ctx.options)) return { kind: 'unrelated' };

  const m = getMessages(session.language);
  const verdict = resolvePick(body, ctx.options);

  if (verdict.kind === 'unrelated') return { kind: 'unrelated' };
  if (verdict.kind === 'unknown') {
    return { kind: 'unknown', text: m.currencyChoiceUnknown(ctx.word, ctx.options) };
  }

  // Resolved — confirm with the chosen currency.
  try {
    const history = (session.pending?.history as any[]) || [];
    const response = await captureConfirm(session.phone, {
      draftId: ctx.draftId,
      edits: { currency: verdict.code },
      history,
    });
    if (!response.needsConfirmation) {
      updateSession(session.phone, { lastDraftId: null });
      setState(session.phone, 'LINKED_MAIN');
    }
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
      return { kind: 'consumed', text, speakable: true };
    }
    // Fallback acknowledgement when the API didn't finish the persist (e.g.
    // wallet still missing) — render the picked currency and let the next
    // turn fill the gap.
    const text = m.currencyChosen(
      verdict.option.code,
      verdict.option.name,
      ctx.amount ?? 0,
      null,
      null,
    );
    return { kind: 'consumed', text, speakable: true };
  } catch (err) {
    log.warn('CURRENCY_PICK_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    // KEEP the frame open — a transient API failure shouldn't lose state.
    // The user can retry the same pick OR send "cancel" to escape.
    return {
      kind: 'unknown',
      text: m.error + '\n\n' + m.currencyChoiceUnknown(ctx.word, ctx.options),
    };
  }
};

registerResolver('currency_choice', currencyResolver);
