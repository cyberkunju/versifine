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
import { effectiveLanguage } from '../../utils/langDetect.ts';
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
  const m = getMessages(effectiveLanguage(session));
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

/** Resolve `body` to one of the known options. Exported for unit tests. */
export function resolvePick(
  body: string,
  options: CurrencyOption[],
):
  | { kind: 'option'; code: Currency; option: CurrencyOption }
  | { kind: 'unknown' }
  | { kind: 'unrelated' } {
  const trimmed = tidyAnswer(body);
  if (!trimmed) return { kind: 'unrelated' };
  const lower = trimmed.toLowerCase();

  // 1) Numeric pick — bare 1-99, OR a single number token among ≤3 tokens
  //    so "1 i think" / "no 2" / "maybe 3 please" resolve like the user
  //    intended. Real users hedge — the resolver shouldn't punish them.
  const numMatchExact = /^([1-9][0-9]?)$/.exec(trimmed);
  if (numMatchExact) {
    const idx = Number(numMatchExact[1]) - 1;
    const opt = options[idx];
    if (opt) return { kind: 'option', code: opt.code, option: opt };
    return { kind: 'unknown' };
  }
  // Short hedged form — exactly one numeric token in ≤4 short tokens.
  const earlyTokens = lower.split(/\s+/).filter((t) => t.length > 0);
  if (earlyTokens.length <= 4 && trimmed.length <= 30) {
    const numericTokens = earlyTokens.filter((t) => /^[1-9][0-9]?$/.test(t));
    if (numericTokens.length === 1) {
      const idx = Number(numericTokens[0]) - 1;
      const opt = options[idx];
      if (opt) return { kind: 'option', code: opt.code, option: opt };
    }
  }

  // 2) Country name / adjective AND token-level ISO code match. Tried
  //    BEFORE the strict whole-message ISO code matcher so multi-token
  //    answers ("Omr i think", "Saudi please", "1 i think") resolve.
  //    Multi-token tolerance: ≤4 tokens AND any token matches an
  //    adjective OR an option's ISO code. This is the fix for the
  //    production failure where the user typed "Omr i think" and the
  //    bot routed to chat instead of picking OMR.
  // tidyAnswer collapses newlines/tabs into single spaces above, so the
  // length cap alone is enough to keep the resolver focused on short replies.
  if (trimmed.length > 30) return { kind: 'unrelated' };
  const tokens = earlyTokens;
  for (const opt of options) {
    const country = opt.country.toLowerCase();
    const adj = COUNTRY_ADJECTIVES[opt.code];
    const exact = new RegExp(
      `^(?:${country}|${country.replace(/\s+/g, '')}${adj ? `|${adj}` : ''})$`,
      'i',
    );
    if (exact.test(lower)) return { kind: 'option', code: opt.code, option: opt };
    if (tokens.length <= 4) {
      // Adjective token match.
      const tokenRe = new RegExp(`^(?:${country.replace(/\s+/g, '')}${adj ? `|${adj}` : ''})$`, 'i');
      if (tokens.some((t) => tokenRe.test(t))) {
        return { kind: 'option', code: opt.code, option: opt };
      }
      // ISO-code token match — token.toUpperCase() === opt.code.
      // Catches "Omr i think", "I want OMR", "no SAR".
      if (tokens.some((t) => t.toUpperCase() === opt.code)) {
        return { kind: 'option', code: opt.code, option: opt };
      }
    }
  }

  // 3) Direct ISO code (whole message is exactly 3 letters and matches a
  //    known currency code that ISN'T in the option set). User typed
  //    something like "USD" mid-flow — keep the frame open and re-prompt.
  const codeMatch = /^([a-z]{3})$/i.exec(trimmed);
  if (codeMatch) {
    // The option-set match was already attempted above (token level); if we
    // got here, the code didn't belong to this picker → re-prompt.
    return { kind: 'unknown' };
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

  const m = getMessages(effectiveLanguage(session));
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
