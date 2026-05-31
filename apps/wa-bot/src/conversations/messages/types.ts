/**
 * MessagePack contract.
 *
 * One shape per language. Every user-visible string the bot might emit
 * lives here so flow files never carry hard-coded English. Functions
 * accept the variables they need and return a finished string — that
 * keeps interpolation, pluralisation, and currency formatting in one
 * place per language.
 */

export interface DraftSummary {
  amount: number | null;
  currency: string | null;
  description: string | null;
  category: string | null;
  date: string | null;
  splitPeople: number | null;
}

export interface MessagePack {
  /** Initial reply when an unknown phone first messages the bot. */
  greeting: string;

  /** Sent after the user picks a language. */
  languageSet: (englishLanguageName: string) => string;

  /**
   * Shown right after a phone-first account is auto-provisioned. No link
   * step — the user can start logging money immediately. This is the
   * everyday onboarding success message.
   */
  onboardingReady: string;

  /**
   * Greets a returning, already-provisioned user in their saved language.
   * Kept to one short line so it never crowds out the actual reply.
   */
  welcomeBack: (displayName: string | null) => string;

  /** Asks an unlinked user to register on the web and send LINK. */
  linkPrompt: string;

  /** Successful link. */
  linkConfirmed: (displayName: string | null) => string;

  /** OTP didn't match. */
  linkInvalid: string;

  /** Universal HELP card. */
  helpCard: string;

  /** Confirmation after a transaction is logged automatically. */
  captureLogged: (amount: number, currency: string, category: string | null) => string;

  /** Asks the user to confirm a draft before persisting. */
  captureNeedsConfirm: (draft: DraftSummary) => string;

  /** Free-form follow-up question forwarded from the API. */
  captureFollowup: (question: string) => string;

  /** User said CANCEL on a draft. */
  captureCancelled: string;

  /** API or pipeline failure. */
  captureFailed: string;

  /** Free-form answer for query intents. */
  queryAnswer: (text: string) => string;

  /** Nudge the user toward the copilot for chat intent. */
  copilotNudge: string;

  /** Budget set-budget flow */
  budgetAskCategory: string;
  budgetAskAmount: (category: string) => string;
  budgetSet: (category: string, amount: number) => string;

  /** Correction applied. */
  correctApplied: (newCategory: string) => string;
  /** Correction failed (no recent transaction or API error). */
  correctNotPossible: string;

  /** Status snapshot, replies to STATUS command. */
  statusLine: (state: string, language: string) => string;

  /** Reset feedback. */
  resetDone: string;

  /** Stop / mute. */
  stopAcknowledged: string;

  /** Unknown command fallback. */
  unknown: string;

  /** Generic error message. */
  error: string;

  /** Sent when an allowlisted but unverified number tries to chat (DEMO_MODE off). */
  notLinked: string;
}
