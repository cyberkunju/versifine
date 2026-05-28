/**
 * English message pack. The bot's "default" copy and the source for the
 * runtime-translated languages (ta/te/kn).
 *
 * Every user-visible string for English flows through here. Numbers are
 * formatted with the Indian comma convention (12,34,567) because Finehance
 * is INR-first. Currency rendering keeps `₹` for INR and falls back to
 * the ISO code for everything else.
 */
import type { DraftSummary, MessagePack } from './types.ts';

function formatINR(value: number): string {
  // Indian-style comma grouping: last 3 digits, then 2-digit groups.
  const intPart = Math.abs(Math.floor(value));
  const fraction = Math.round((Math.abs(value) - intPart) * 100);
  const intStr = intPart.toString();
  const lastThree = intStr.slice(-3);
  const head = intStr.slice(0, -3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  const sign = value < 0 ? '-' : '';
  return fraction > 0 ? `${sign}${grouped}.${String(fraction).padStart(2, '0')}` : `${sign}${grouped}`;
}

function formatAmount(value: number, currency: string): string {
  if (currency === 'INR') return `₹${formatINR(value)}`;
  return `${currency} ${formatINR(value)}`;
}

function describeDraft(d: DraftSummary): string {
  const parts: string[] = [];
  if (d.amount !== null && d.currency) {
    parts.push(formatAmount(d.amount, d.currency));
  } else if (d.amount !== null) {
    parts.push(`₹${formatINR(d.amount)}`);
  }
  if (d.description) parts.push(`for ${d.description}`);
  if (d.category) parts.push(`(${d.category})`);
  if (d.splitPeople && d.splitPeople >= 2) parts.push(`split ${d.splitPeople} ways`);
  if (d.date) parts.push(`on ${d.date}`);
  return parts.join(' ');
}

export const en: MessagePack = {
  greeting:
    "Hi! I'm Finehance — your personal money assistant. Pick your language:\n" +
    '1. English\n' +
    '2. हिन्दी\n' +
    '3. മലയാളം\n' +
    '4. தமிழ்\n' +
    '5. తెలుగు\n' +
    '6. ಕನ್ನಡ\n\n' +
    "Reply with a number, or just say 'English'.",

  languageSet: (lang) => `Got it. I'll talk to you in ${lang}.`,

  linkPrompt:
    "I don't know this number yet. Quick steps:\n" +
    '1. Register on the web at finehance.app\n' +
    "2. Open Settings → Link WhatsApp → you'll see a 6-digit code\n" +
    '3. Send: LINK 482917 (your code)\n\n' +
    "Once linked, I'll log every expense you send me.",

  linkConfirmed: (name) =>
    name
      ? `✅ Linked! Welcome, ${name}. Try: "spent 200 on coffee" or send HELP anytime.`
      : '✅ Linked! Try: "spent 200 on coffee" or send HELP anytime.',

  linkInvalid:
    "That code didn't work. Open the web app's Settings → Link WhatsApp to get a fresh one, then send LINK <code> here.",

  helpCard:
    "Here's what I can do:\n" +
    "• Log expenses — 'spent 450 on auto'\n" +
    "• Income — 'got salary 85000'\n" +
    "• Photos — send a receipt and I'll extract it\n" +
    "• Voice notes — talk in any of 6 languages\n" +
    "• Queries — 'how much on food this month?'\n" +
    "• Budgets — 'set budget groceries 8000'\n" +
    "• Corrections — 'last one was Transport not Food'\n\n" +
    'Quick commands: MENU · HELP · STATUS · UNDO · LANGUAGE · RESET · STOP',

  captureLogged: (amount, currency, category) =>
    category
      ? `✅ Logged ${formatAmount(amount, currency)} under ${category}.`
      : `✅ Logged ${formatAmount(amount, currency)}.`,

  captureNeedsConfirm: (draft) =>
    `Almost! ${describeDraft(draft)}\n\nReply CONFIRM to save, EDIT to change, or CANCEL.`,

  captureFollowup: (q) => q,

  captureCancelled: 'Cancelled. Nothing saved.',

  captureFailed: "Couldn't log that. Try again or send RESET.",

  queryAnswer: (text) => text,

  copilotNudge:
    'For deep questions, try the web copilot at finehance.app — I can also try here, just send the question.',

  budgetAskCategory:
    'Which category? (e.g., Groceries, Restaurants, Transportation)',
  budgetAskAmount: (category) => `How much per month for ${category}?`,
  budgetSet: (category, amount) =>
    `📊 Budget set: ${category} → ${formatAmount(amount, 'INR')}/month. I'll warn at 80%.`,

  correctApplied: (newCategory) =>
    `✅ Updated. The last transaction is now ${newCategory}. Future similar entries will use this category too.`,
  correctNotPossible:
    "I couldn't find a recent transaction to correct. Send your last expense again with the right category.",

  statusLine: (state, language) =>
    `Status: linked, language ${language}, current step: ${state.toLowerCase()}.`,

  resetDone: '🔄 Reset. Send HELP to see what I can do.',

  stopAcknowledged:
    "Okay, I'll stop replying. Message me again anytime to wake me up.",

  unknown:
    "I didn't catch that. Try logging an expense ('spent 200 on coffee') or send HELP.",

  error:
    'Something went sideways on my end. Try again, or send RESET to start fresh.',

  notLinked:
    "I see your message but this number isn't linked yet. Send LINK <6-digit code> from the web app.",
};
