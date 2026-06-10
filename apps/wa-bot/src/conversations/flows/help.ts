/**
 * Universal HELP / STATUS / RESET / STOP / LANGUAGE handlers.
 *
 * These commands are valid regardless of state — the engine intercepts
 * them before any state-specific dispatch. Output is always the localized
 * pack; ta/te/kn callers translate the result before sending.
 */
import type { Session } from '../../types.ts';
import { LANGUAGE_META } from '@versifine/shared';
import { getMessages } from '../messages/index.ts';
import { resetSession, setState, updateSession } from '../state.ts';
import { effectiveLanguage } from '../../utils/langDetect.ts';

export function handleHelp(session: Session): { text: string } {
  return { text: getMessages(effectiveLanguage(session)).helpCard };
}

export function handleStatus(session: Session): { text: string } {
  const m = getMessages(effectiveLanguage(session));
  return {
    text: m.statusLine(session.state, LANGUAGE_META[session.language].englishName),
  };
}

export function handleReset(session: Session): { text: string } {
  // RESET means "start over from onboarding". Wipe the session, then drop
  // the user at the language menu directly. We mark accountResolved so the
  // engine's first-contact whoami shortcut doesn't immediately pull a known
  // user back into LINKED_MAIN — RESET must always re-run onboarding
  // (language → email), even for an already-provisioned number.
  resetSession(session.phone);
  setState(session.phone, 'AWAITING_LANGUAGE');
  updateSession(session.phone, { accountResolved: true });
  const m = getMessages(effectiveLanguage(session));
  return { text: `${m.resetDone}\n\n${m.greeting}` };
}

export function handleStop(session: Session): { text: string } {
  setState(session.phone, 'ERROR'); // engine treats ERROR + non-command as silent
  updateSession(session.phone, { replyMode: 'text' });
  return { text: getMessages(effectiveLanguage(session)).stopAcknowledged };
}

export function handleLanguageSwitch(session: Session): { text: string } {
  // Drop back into language-pick mode; reuses the GREETING menu.
  setState(session.phone, 'AWAITING_LANGUAGE');
  return { text: getMessages(effectiveLanguage(session)).greeting };
}
