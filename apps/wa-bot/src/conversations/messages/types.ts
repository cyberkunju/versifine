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

/**
 * Structured spending-query result the bot localises per language. Mirrors
 * the API's `QuerySummaryPayload` (services/capture/queryStubs.ts) but kept
 * independent so the bot doesn't import API runtime code.
 */
export interface QuerySummaryView {
  kind: 'spending' | 'summary' | 'forecast';
  total: number;
  currency: string;
  /** Stable period key (today, this_month, …) — null for forecast. */
  periodKey: string | null;
  /** English period label, used when there's no localized key. */
  periodLabel: string;
  category: string | null;
  topCategory: { category: string; total: number } | null;
  horizonDays: number | null;
}

/**
 * A lend/borrow ledger entry, as the API returns it. `direction='lent'` means
 * the counterparty owes the user; `borrowed` means the user owes them.
 */
export interface LedgerView {
  direction: 'lent' | 'borrowed';
  counterparty: string;
  amount: number;
  currency: string;
  outstanding: number;
  status: 'open' | 'partial' | 'settled';
}

/** A settlement result — a ledger entry that a repayment just decremented. */
export interface LedgerSettledView extends LedgerView {
  settledAmount: number;
  cleared: boolean;
}

/** Answer to a debt question: who owes the user, and whom the user owes. */
export interface DebtsView {
  scope: 'lent' | 'borrowed' | 'all';
  counterparty: string | null;
  receivables: Array<{ counterparty: string; outstanding: number }>;
  payables: Array<{ counterparty: string; outstanding: number }>;
  totalReceivable: number;
  totalPayable: number;
  currency: string;
}

/** A transfer between two of the user's own wallets (never a spend). */
export interface TransferView {
  amount: number;
  currency: string;
  fromName: string;
  toName: string;
}

export interface MessagePack {
  /** Initial reply when an unknown phone first messages the bot. */
  greeting: string;

  /** Sent after the user picks a language. */
  languageSet: (englishLanguageName: string) => string;

  /**
   * Onboarding step 2: ask for an email so the WhatsApp account and the web
   * account link automatically. Optional — the user can SKIP.
   */
  askEmail: string;

  /** Confirmation after the user gives an email that we'll link. */
  emailLinked: (email: string) => string;

  /** The user attached their phone to a pre-existing web/email account. */
  emailLinkedExisting: (email: string) => string;

  /** Couldn't read an email; re-prompt (still skippable). */
  emailInvalid: string;

  /** The user skipped the email step. */
  emailSkipped: string;

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
  captureLogged: (
    amount: number,
    currency: string,
    category: string | null,
    baseAmount?: number,
    baseCurrency?: string,
  ) => string;

  /** Confirmation after multiple transactions are logged from one message. */
  captureLoggedMany: (
    items: Array<{
      amount: number;
      currency: string;
      description: string;
      category: string | null;
    }>,
    total: number,
    currency: string,
  ) => string;

  /** Asks the user to confirm a draft before persisting. */
  captureNeedsConfirm: (draft: DraftSummary) => string;

  /**
   * Disambiguates a generic currency word ("riyal" / "rial" / "dinar") that
   * maps to multiple country variants. Renders a numbered list and asks the
   * user to pick — never silently defaults.
   */
  currencyChoicePrompt: (
    word: string,
    options: ReadonlyArray<{ code: string; country: string; name: string }>,
    amount: number | null,
  ) => string;

  /** Acknowledges the user's currency pick + shows the converted amount. */
  currencyChosen: (
    code: string,
    name: string,
    amount: number,
    baseAmount: number | null,
    baseCurrency: string | null,
  ) => string;

  /** User's reply to the currency picker didn't match any option. */
  currencyChoiceUnknown: (
    word: string,
    options: ReadonlyArray<{ code: string; country: string; name: string }>,
  ) => string;

  /** Universal-cancel acknowledgement — used when the user types CANCEL,
   *  STOP, "venda", etc. to close any open dialogue frame. */
  frameCancelled: string;

  /** A frame's resolver crashed — apologise + invite a retry without
   *  losing state. */
  frameError: string;

  /** Auto-clear after MAX_RETRIES of unparseable answers. */
  frameMaxRetriesSuffix: string;

  /** A user typed CONFIRM/CANCEL/EDIT but no draft is in confirmation state. */
  nothingToConfirm: string;

  /** Generic engine-level "something went wrong, retry or RESET". */
  engineError: string;

  /** Voice transcription empty / silent. */
  voiceUnclear: string;

  /** Reference resolver — couldn't find a candidate matching the user's
   *  reference (e.g. "delete the coffee one"). */
  refNoMatch: string;

  /** Reference resolver — multiple candidates; ask the user to pick. */
  refMultipleCandidates: (
    verb: string,
    list: string,
    count: number,
  ) => string;

  /** Reference resolver — found the entry but missing what to update to. */
  refUpdateNeedsTarget: string;

  /** Reference resolver — pending pick was cancelled by the user. */
  refPickCancelled: string;

  /** "Send the missing detail or CANCEL" — when the user sends an empty
   *  message while a draft is awaiting clarification. */
  captureMissingDetail: string;

  /**
   * Image-acknowledgement prefix. Prepended to ANY image-origin reply so
   * the user always sees "I looked at the photo" before the reply body.
   * The empath subagent identified "image invisibility" as the worst feeling
   * — the user took the trouble to photograph a receipt, bot replied without
   * referencing the image. Function form (not literal) because we want to
   * say what we ACTUALLY SAW: "I see ₹450 — what was it for?" beats
   * "📷 Photo received." every time.
   */
  imageAck: (seen: {
    amount: number | null;
    currency: string | null;
    description: string | null;
  }) => string;

  /**
   * Image-extraction failed entirely (amount + description both null). The
   * bot acknowledges the photo, names the failure, and offers a recovery.
   */
  imageUnreadable: string;

  /** Free-form follow-up question forwarded from the API. */
  captureFollowup: (question: string) => string;

  /** Localized "one missing detail" clarifier, derived from the draft's needs. */
  captureAsk: (needs: ReadonlyArray<string>) => string;

  /** User said CANCEL on a draft. */
  captureCancelled: string;

  /** API or pipeline failure. */
  captureFailed: string;

  /** Free-form answer for query intents. */
  queryAnswer: (text: string) => string;

  /**
   * Localized spending/summary/forecast answer built from the API's
   * structured result, so hi/ml users don't get an English sentence.
   */
  queryReply: (q: QuerySummaryView) => string;

  /** Nudge the user toward the copilot for chat intent. */
  copilotNudge: string;

  /** Lend/borrow recorded → a ledger entry was created. */
  ledgerLogged: (v: LedgerView) => string;

  /** Multiple lend/borrow entries recorded from one message. */
  ledgerBatchLogged: (entries: ReadonlyArray<LedgerView>) => string;

  /** A repayment settled (fully or partially) a ledger entry. */
  ledgerSettled: (v: LedgerSettledView) => string;

  /** Answer to a debt question ("who owes me", "how much do I owe"). */
  debtsSummary: (v: DebtsView) => string;

  /** Transfer between the user's own wallets logged (not a spend). */
  transferLogged: (v: TransferView) => string;

  /** A savings goal was created from natural language. */
  goalSet: (name: string, targetAmount: number, deadline: string | null) => string;

  /** Budget set-budget flow */
  budgetAskCategory: string;
  budgetAskAmount: (category: string) => string;
  budgetSet: (category: string, amount: number) => string;
  /** Confirmation for an overall (all-spending) monthly cap. */
  budgetSetOverall: (amount: number) => string;

  /** Correction applied. */
  correctApplied: (newCategory: string) => string;

  /** Amount/description correction applied — summary is the new value (₹500 / "dinner"). */
  correctUpdated: (summary: string) => string;
  /** Correction failed (no recent transaction or API error). */
  correctNotPossible: string;

  /** Undo succeeded — summary describes the entry after reversal. */
  undone: (summary: string) => string;

  /** Nothing to undo. */
  nothingToUndo: string;

  /** Last transaction deleted (reversible). summary is e.g. "₹250 (coffee)". */
  deleted: (summary: string) => string;

  /** Status snapshot, replies to STATUS command. */
  statusLine: (state: string, language: string) => string;

  /** Confirmation when the user changes their language via natural language. */
  languageChanged?: (englishLanguageName: string) => string;
  /** Reply-mode confirmations (text-only / voice / auto). */
  replyModeText?: string;
  replyModeVoice?: string;
  replyModeAuto?: string;

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
