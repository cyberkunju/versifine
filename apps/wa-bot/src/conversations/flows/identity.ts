/**
 * Identity / onboarding flow — phone-first.
 *
 * A message from a WhatsApp number is, by WhatsApp's own delivery, proof the
 * sender controls that number. So there is NO separate verification step and
 * NO web sign-up requirement: we auto-provision an account keyed by the phone
 * the moment the user picks a language.
 *
 * First contact:
 *   1. `resolveFirstContact` asks the API whether this number already has an
 *      account (whoami). If yes → adopt its language, mark linked, and let the
 *      engine process the user's ACTUAL message (we never throw the first
 *      message away). If no → show the language menu.
 *   2. The user picks a language (number 1-6, a name, or — via the engine's
 *      voice path — a detected spoken language).
 *   3. `handleLanguagePick` provisions the account (find-or-create) and drops
 *      the user straight into LINKED_MAIN with a "you're all set" message.
 *
 * The old "register on the web, then send LINK <code>" gate is gone for the
 * common case. `LINK <code>` still works (engine routes it) for the advanced
 * path where someone wants to bind this number to a pre-existing web account.
 */
import type { Language } from '@versifine/shared';
import { isLanguage, LANGUAGE_META, LANGUAGES } from '@versifine/shared';
import type { Session } from '../../types.ts';
import { botEnsureUser, botWhoami } from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';
import { setLanguage, setLinked, setState, updateSession } from '../state.ts';

const NUMBER_TO_LANG: Record<string, Language> = {
  '1': 'en',
  '2': 'hi',
  '3': 'ml',
  '4': 'ta',
  '5': 'te',
  '6': 'kn',
};

const NAME_TO_LANG: Record<string, Language> = {
  english: 'en',
  hindi: 'hi',
  हिन्दी: 'hi',
  हिंदी: 'hi',
  malayalam: 'ml',
  മലയാളം: 'ml',
  tamil: 'ta',
  தமிழ்: 'ta',
  telugu: 'te',
  తెలుగు: 'te',
  kannada: 'kn',
  ಕನ್ನಡ: 'kn',
};

function pickLanguage(text: string): Language | null {
  const trimmed = text.trim().toLowerCase();
  if (NUMBER_TO_LANG[trimmed]) return NUMBER_TO_LANG[trimmed];
  if (isLanguage(trimmed)) return trimmed as Language;
  if (NAME_TO_LANG[trimmed]) return NAME_TO_LANG[trimmed];
  for (const lang of LANGUAGES) {
    if (trimmed === LANGUAGE_META[lang].englishName.toLowerCase()) return lang;
    if (trimmed === LANGUAGE_META[lang].nativeName.toLowerCase()) return lang;
  }
  return null;
}

export interface FirstContactResult {
  /** When set, the engine should reply with this text and stop. */
  reply?: string;
  /** When true, the account was recognised/created; the engine continues to
   * process the user's original message in LINKED_MAIN. */
  proceed: boolean;
  /** Optional one-line "welcome back" the engine prepends to its reply. */
  welcomePrefix?: string;
}

/**
 * Runs once per session, on the very first message. Decides between:
 *   - returning user  → adopt saved language + linked, PROCEED (don't discard
 *                       the message; show a short welcome-back prefix once),
 *   - new user        → show the language menu and wait for a pick.
 *
 * Network failures degrade gracefully to the language menu (so the bot is
 * never bricked by a transient API blip), but they do NOT mark the account
 * resolved, so the next message retries the check.
 */
export async function resolveFirstContact(session: Session, body: string): Promise<FirstContactResult> {
  try {
    const who = await botWhoami(session.phone);
    if (who.exists) {
      const language = (isLanguage(who.language) ? who.language : session.language) as Language;
      setLanguage(session.phone, language);
      updateSession(session.phone, { linked: true, accountResolved: true });
      setState(session.phone, 'LINKED_MAIN');
      const m = getMessages(language);
      // If the first message is itself a real action ("spent 200 on tea"),
      // proceed so the engine handles it; prepend a one-time welcome-back.
      return { proceed: true, welcomePrefix: m.welcomeBack(who.displayName) };
    }
  } catch (err) {
    log.warn('WHOAMI_FAIL', {
      phone: session.phone,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    // Fall through to the language menu; leave accountResolved=false so the
    // next message retries rather than getting permanently stuck.
    const m = getMessages(session.language);
    setState(session.phone, 'AWAITING_LANGUAGE');
    return { proceed: false, reply: m.greeting };
  }

  // Unknown number → onboard. Show the language menu (each option in its own
  // script so non-readers recognise their language by shape).
  setState(session.phone, 'AWAITING_LANGUAGE');
  updateSession(session.phone, { accountResolved: true });
  const m = getMessages(session.language);
  return { proceed: false, reply: m.greeting };
}

export interface LanguagePickResult {
  text: string;
  state: Session['state'];
}

/**
 * Handle the language selection for a NEW user, then auto-provision the
 * account and move straight to LINKED_MAIN. No verification, no LINK step.
 */
export async function handleLanguagePick(session: Session, body: string): Promise<LanguagePickResult> {
  const picked = pickLanguage(body);
  if (!picked) {
    // Couldn't parse a language — re-show the menu in the current language.
    const m = getMessages(session.language);
    return { text: m.greeting, state: 'AWAITING_LANGUAGE' };
  }

  setLanguage(session.phone, picked);
  const localized = getMessages(picked);

  try {
    const account = await botEnsureUser(session.phone, picked);
    setLinked(session.phone, { userId: account.userId, spaceId: account.spaceId });
    updateSession(session.phone, { accountResolved: true });
    setState(session.phone, 'LINKED_MAIN');
    const text = `${localized.languageSet(LANGUAGE_META[picked].englishName)}\n\n${localized.onboardingReady}`;
    return { text, state: 'LINKED_MAIN' };
  } catch (err) {
    log.warn('ENSURE_USER_FAIL', {
      phone: session.phone,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    // Provisioning failed — keep the chosen language, stay in AWAITING_LANGUAGE
    // so the next message retries provisioning rather than stranding the user.
    setState(session.phone, 'AWAITING_LANGUAGE');
    return { text: localized.error, state: 'AWAITING_LANGUAGE' };
  }
}
