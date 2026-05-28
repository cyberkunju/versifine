/**
 * Universal HELP / STATUS / RESET / STOP / LANGUAGE handlers.
 *
 * These commands are valid regardless of state — the engine intercepts
 * them before any state-specific dispatch. Output is always the localized
 * pack; ta/te/kn callers translate the result before sending.
 */
import type { Session } from '../../types.ts';
import { LANGUAGE_META } from '@finehance/shared';
import { getMessages } from '../messages/index.ts';
import { resetSession, setState, updateSession } from '../state.ts';

export function handleHelp(session: Session): { text: string } {
  return { text: getMessages(session.language).helpCard };
}

export function handleStatus(session: Session): { text: string } {
  const m = getMessages(session.language);
  return {
    text: m.statusLine(session.state, LANGUAGE_META[session.language].englishName),
  };
}

export function handleReset(session: Session): { text: string } {
  resetSession(session.phone);
  return { text: getMessages(session.language).resetDone };
}

export function handleStop(session: Session): { text: string } {
  setState(session.phone, 'ERROR'); // engine treats ERROR + non-command as silent
  updateSession(session.phone, { replyMode: 'text' });
  return { text: getMessages(session.language).stopAcknowledged };
}

export function handleLanguageSwitch(session: Session): { text: string } {
  // Drop back into language-pick mode; reuses the GREETING menu.
  setState(session.phone, 'AWAITING_LANGUAGE');
  return { text: getMessages(session.language).greeting };
}
