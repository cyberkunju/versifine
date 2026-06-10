/**
 * English message pack. The bot's "default" copy and the source for the
 * runtime-translated languages (ta/te/kn).
 *
 * Every user-visible string for English flows through here. Numbers are
 * formatted with the Indian comma convention (12,34,567) because Versifine
 * is INR-first. Currency rendering keeps `₹` for INR and falls back to
 * the ISO code for everything else.
 */
import { resolveCurrencySymbol } from '@versifine/shared';
import type { DraftSummary, MessagePack, QuerySummaryView, LedgerView, LedgerSettledView, DebtsView, TransferView } from './types.ts';

const PERIOD_LABELS_EN: Record<string, string> = {
  today: 'today',
  yesterday: 'yesterday',
  this_week: 'this week',
  last_week: 'last week',
  this_month: 'this month',
  last_month: 'last month',
  this_year: 'this year',
};

function formatINR(value: number): string {
  // Indian-style comma grouping: last 3 digits, then 2-digit groups.
  const intPart = Math.abs(Math.floor(value));
  const fraction = Math.round((Math.abs(value) - intPart) * 100);
  const intStr = intPart.toString();
  const lastThree = intStr.slice(-3);
  const head = intStr.slice(0, -3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  const sign = value < 0 ? '-' : '';
  return fraction > 0
    ? `${sign}${grouped}.${String(fraction).padStart(2, '0')}`
    : `${sign}${grouped}`;
}

function formatAmount(value: number, currency: string): string {
  const upper = currency.toUpperCase();
  const symbol = resolveCurrencySymbol(upper);
  const separator = symbol === upper ? ' ' : '';
  if (upper === 'INR') return `₹${formatINR(value)}`;
  return `${symbol}${separator}${formatINR(value)}`;
}

/**
 * Render the total line for a multi-item log. NEVER sums across currencies — a
 * mixed "$100 hotel + ₹2000 food" batch shows "$100 + ₹2,000", not a
 * meaningless "$2,100". Everything is derived from the items themselves
 * (currency keys normalised, each amount rounded before accumulating) so the
 * total can never drift from the line items the user sees.
 */
function formatGroupedTotal(items: ReadonlyArray<{ amount: number; currency: string }>): string {
  const byCurrency = new Map<string, number>();
  for (const it of items) {
    const key = (it.currency || 'INR').trim().toUpperCase();
    byCurrency.set(key, (byCurrency.get(key) ?? 0) + Math.round(it.amount * 100) / 100);
  }
  return Array.from(byCurrency.entries())
    .map(([c, a]) => formatAmount(a, c))
    .join(' + ');
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
    "Hi! I'm Versifine — your personal money assistant. Pick your language:\n" +
    '1. English\n' +
    '2. हिन्दी\n' +
    '3. മലയാളം\n' +
    '4. தமிழ்\n' +
    '5. తెలుగు\n' +
    '6. ಕನ್ನಡ\n' +
    '7. বাংলা\n' +
    '8. मराठी\n' +
    '9. ગુજરાતી\n' +
    '10. ਪੰਜਾਬੀ\n' +
    '11. ଓଡ଼ିଆ\n\n' +
    "Reply with a number, or just say 'English'.",

  languageSet: (lang) => `Got it. I'll talk to you in ${lang}.`,

  askEmail:
    'One quick thing — what email should I link this to?\n\n' +
    'If you ever sign in on the web with the same email, your WhatsApp and ' +
    'web accounts join up automatically. No password needed here.\n\n' +
    'Send your email, or reply SKIP to do it later.',

  emailLinked: (email) =>
    `Linked to ${email}. ✅ Sign in on the web with this email and it's the same account.`,

  emailLinkedExisting: (email) =>
    `Welcome back! This number is now connected to your ${email} account. ✅ Everything's in one place.`,

  emailInvalid:
    "That doesn't look like an email. Send a valid one (like you@example.com), or reply SKIP.",

  emailSkipped: 'No problem — skipped. You can link an email later from the web app.',

  onboardingReady:
    "You're all set — no sign-up needed. ✅\n\n" +
    'Just tell me what you spent. For example:\n' +
    '• "spent 200 on tea"\n' +
    '• send a photo of a bill\n' +
    '• or send a voice note in your language\n\n' +
    'Send HELP anytime to see everything I can do.',

  welcomeBack: (name) => (name ? `Welcome back, ${name}! 👋` : 'Welcome back! 👋'),

  linkPrompt:
    "I don't know this number yet. Quick steps:\n" +
    '1. Register on the web at versifine.com\n' +
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
    '• Voice notes — talk in any of 6 languages\n' +
    "• Queries — 'how much on food this month?'\n" +
    "• Budgets — 'set budget groceries 8000'\n" +
    "• Corrections — 'last one was Transport not Food'\n\n" +
    'Quick commands: MENU · HELP · STATUS · UNDO · LANGUAGE · RESET · STOP',

  captureLogged: (amount, currency, category, baseAmount, baseCurrency) => {
    // Log PRIMARY in the user's base currency (their wallet/account currency)
    // and note the FOREIGN original parenthetically when they spent in another
    // currency. Same data, clearer mental model: "I spent ₹110 (originally
    // SAR 5)" — the user always sees how it hits their balance + what they
    // physically paid in their pocket.
    const isForeign = baseAmount && baseCurrency && baseCurrency !== currency;
    const primary = isForeign
      ? formatAmount(baseAmount!, baseCurrency!)
      : formatAmount(amount, currency);
    const original = isForeign ? ` (originally ${formatAmount(amount, currency)})` : '';
    return category
      ? `✅ Logged ${primary}${original} under ${category}.`
      : `✅ Logged ${primary}${original}.`;
  },

  captureLoggedMany: (items) => {
    const lines = items
      .map((item) => `- ${formatAmount(item.amount, item.currency)} - ${item.description}`)
      .join('\n');
    return `Logged ${items.length} expenses (${formatGroupedTotal(items)} total):\n${lines}`;
  },

  captureNeedsConfirm: (draft) =>
    `Almost! ${describeDraft(draft)}\n\nReply CONFIRM to save, EDIT to change, or CANCEL.`,

  currencyChoicePrompt: (word, options, amount) => {
    const lines = options.map(
      (o, i) => `${i + 1}. ${o.name} (${o.code}) — ${o.country}`,
    );
    const amt = amount != null ? `${amount} ${word}` : word;
    return (
      `Which ${word}? You said "${amt}" — please pick one:\n${lines.join('\n')}\n\n` +
      `Reply with the number (1-${options.length}), the country (e.g. Saudi), or the code (e.g. SAR).`
    );
  },

  currencyChosen: (code, name, amount, baseAmount, baseCurrency) => {
    const inBase =
      baseAmount != null && baseCurrency && baseCurrency !== code
        ? ` ≈ ${formatAmount(baseAmount, baseCurrency)}`
        : '';
    return `Got it — ${name} (${code}) ${formatAmount(amount, code)}${inBase}. Logging now...`;
  },

  currencyChoiceUnknown: (word, options) => {
    const codes = options.map((o) => o.code).join(' / ');
    return `I didn't catch which ${word}. Reply with the number (1-${options.length}) or one of ${codes}.`;
  },

  frameCancelled: 'Cancelled. What would you like to do?',
  frameError: 'Something went wrong. Please try again, or type CANCEL to skip.',
  frameMaxRetriesSuffix: '\n\n(Cancelled — too many tries. Send a fresh message when ready.)',
  nothingToConfirm: 'Nothing to confirm right now. Send HELP for commands.',
  engineError: 'Something went wrong. Try again or send RESET.',
  voiceUnclear: "🎤 I couldn't make out that voice note. Could you try again or type it?",
  refNoMatch:
    "I couldn't find a matching transaction. Try mentioning the amount, the merchant, or the date — e.g. \"delete the ₹250 coffee\" or \"change yesterday's lunch to 350\".",
  refMultipleCandidates: (verb, list, count) =>
    `Which one do you want to ${verb}?\n${list}\nReply with the number (1-${count}) or CANCEL.`,
  refUpdateNeedsTarget: 'Found the entry but I need to know what to change it to.',
  refPickCancelled: 'Cancelled.',
  captureMissingDetail:
    'I need one missing detail. Type it here, or send CANCEL to discard this draft.',
  imageAck: (seen) => {
    const amt = seen.amount;
    const cur = seen.currency ?? 'INR';
    const desc = seen.description?.trim();
    if (amt != null && desc) {
      // Both — strongest "I saw what you sent".
      return `📷 I see ${formatAmount(amt, cur)} for ${desc}.`;
    }
    if (amt != null) {
      return `📷 I see ${formatAmount(amt, cur)} on this receipt.`;
    }
    if (desc) {
      return `📷 I see a ${desc} receipt.`;
    }
    return '📷 Photo received.';
  },
  imageUnreadable:
    "📷 I see the image but couldn't read it clearly. Could you type the total and what it was for, or send a sharper photo?",
  queryLastEntry: (tx) => {
    const isForeign = tx.baseAmount != null && tx.baseAmount > 0 && tx.currency !== 'INR';
    const primary = isForeign
      ? `₹${formatINR(tx.baseAmount!)}`
      : formatAmount(tx.amount, tx.currency);
    const original = isForeign ? ` (originally ${formatAmount(tx.amount, tx.currency)})` : '';
    const cat = tx.category ? ` · ${tx.category}` : '';
    const verb = tx.type === 'income' ? 'Last income' : 'Last entry';
    return `${verb}: ${primary}${original} — ${tx.description}${cat} (${tx.date}).`;
  },
  queryLastEntryEmpty: "You haven't logged anything yet — send me an expense to begin.",
  undoHint: (token) => ` · undo: ${token}`,
  undoByTokenDone: (summary) => `↩️ Undone — ${summary} removed. It's like it never happened.`,
  undoTokenNotFound: "I couldn't find that undo code. It may have expired or already been used.",
  undoTokenAlready: 'That one was already undone — nothing more to do.',

  captureFollowup: (q) => q,

  captureAsk: (needs) => {
    if (needs.includes('amount')) return 'How much was it?';
    if (needs.includes('description')) return 'What was it for?';
    if (needs.includes('wallet')) return 'Which account or wallet did you use?';
    if (needs.includes('currency')) return 'Which currency was that?';
    return 'I just need one more detail — what was it for?';
  },

  captureCancelled: 'Cancelled. Nothing saved.',

  captureFailed: "Couldn't log that. Try again or send RESET.",

  queryAnswer: (text) => text,

  queryReply: (q: QuerySummaryView) => {
    const period = q.periodKey ? (PERIOD_LABELS_EN[q.periodKey] ?? q.periodLabel) : q.periodLabel;
    if (q.kind === 'forecast') {
      return `You're projected to spend about ${formatAmount(q.total, q.currency)} over the ${period}.`;
    }
    if (q.kind === 'spending') {
      const on = q.category ? ` on ${q.category}` : '';
      return q.total > 0
        ? `You've spent ${formatAmount(q.total, q.currency)}${on} ${period}.`
        : `No spending${on} recorded ${period}.`;
    }
    // summary
    if (q.total <= 0) return `No spending recorded ${period} yet.`;
    let msg = `You've spent ${formatAmount(q.total, q.currency)} ${period}.`;
    if (q.topCategory && q.topCategory.total > 0) {
      msg += ` Biggest: ${q.topCategory.category} (${formatAmount(q.topCategory.total, q.currency)}).`;
    }
    return msg;
  },

  copilotNudge:
    'For deep questions, try the web copilot at versifine.com — I can also try here, just send the question.',

  ledgerLogged: (v: LedgerView) => {
    const amt = formatAmount(v.amount, v.currency);
    return v.direction === 'lent'
      ? `✅ Noted — ${v.counterparty} owes you ${amt}. I'll keep track until it's paid back.`
      : `✅ Noted — you owe ${v.counterparty} ${amt}. I'll keep track until it's cleared.`;
  },

  ledgerBatchLogged: (entries) => {
    const lines = entries.map((e) =>
      e.direction === 'lent'
        ? `• ${e.counterparty} owes you ${formatAmount(e.amount, e.currency)}`
        : `• You owe ${e.counterparty} ${formatAmount(e.amount, e.currency)}`,
    );
    return `✅ Noted ${entries.length} entries:\n${lines.join('\n')}\nI'll keep track of all of them.`;
  },

  ledgerSettled: (v: LedgerSettledView) => {
    const paid = formatAmount(v.settledAmount, v.currency);
    const left = formatAmount(v.outstanding, v.currency);
    if (v.direction === 'lent') {
      return v.cleared
        ? `✅ All settled — ${v.counterparty} has paid you back in full.`
        : `✅ Got ${paid} back from ${v.counterparty}. ${left} still to go.`;
    }
    return v.cleared
      ? `✅ All settled — you've paid ${v.counterparty} back in full.`
      : `✅ Paid ${paid} to ${v.counterparty}. ${left} left to clear.`;
  },

  debtsSummary: (v: DebtsView) => {
    const lines: string[] = [];
    if (v.scope !== 'borrowed' && v.receivables.length > 0) {
      lines.push('💰 Owed to you:');
      for (const r of v.receivables) {
        lines.push(`• ${r.counterparty} — ${formatAmount(r.outstanding, v.currency)}`);
      }
      lines.push(`Total: ${formatAmount(v.totalReceivable, v.currency)}`);
    }
    if (v.scope !== 'lent' && v.payables.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('💸 You owe:');
      for (const p of v.payables) {
        lines.push(`• ${p.counterparty} — ${formatAmount(p.outstanding, v.currency)}`);
      }
      lines.push(`Total: ${formatAmount(v.totalPayable, v.currency)}`);
    }
    if (lines.length === 0) {
      if (v.counterparty) return `You're all square with ${v.counterparty} — nothing outstanding. 🎉`;
      return 'You have no open debts right now. 🎉';
    }
    return lines.join('\n');
  },

  transferLogged: (v: TransferView) =>
    `✅ Moved ${formatAmount(v.amount, v.currency)} from ${v.fromName} to ${v.toName}. (This isn't counted as spending.)`,

  goalSet: (name, targetAmount, deadline) =>
    `🎯 Goal set: ${name} — save ${formatAmount(targetAmount, 'INR')}${deadline ? ` by ${deadline}` : ''}. I'll track your progress.`,

  budgetAskCategory: 'Which category? (e.g., Groceries, Restaurants, Transportation)',
  budgetAskAmount: (category) => `How much per month for ${category}?`,
  budgetSet: (category, amount) =>
    `📊 Budget set: ${category} → ${formatAmount(amount, 'INR')}/month. I'll warn at 80%.`,
  budgetSetOverall: (amount) =>
    `📊 Monthly budget set: ${formatAmount(amount, 'INR')} across all spending. I'll warn at 80%.`,

  correctApplied: (newCategory) =>
    `✅ Updated. The last transaction is now ${newCategory}. Future similar entries will use this category too.`,
  correctUpdated: (summary) => `✅ Updated — the last transaction is now ${summary}.`,
  correctNotPossible:
    "I couldn't find a recent transaction to correct. Send your last expense again with the right category.",
  undone: (summary) => `↩️ Undone — ${summary}.`,
  nothingToUndo: "Nothing to undo right now.",
  deleted: (summary) => `🗑️ Deleted ${summary}. Reply UNDO to restore it.`,

  statusLine: (state, language) =>
    `Status: linked, language ${language}, current step: ${state.toLowerCase()}.`,

  languageChanged: (label) => `✅ Done — I'll talk to you in ${label} from now on.`,
  replyModeText: '✅ Got it — text replies only from now on.',
  replyModeVoice: "✅ Done — I'll send you a voice note with each reply.",
  replyModeAuto: "✅ Done — I'll mirror you: voice for voice, text for text.",

  resetDone: '🔄 Reset. Send HELP to see what I can do.',

  stopAcknowledged: "Okay, I'll stop replying. Message me again anytime to wake me up.",

  unknown: "I didn't catch that. Try logging an expense ('spent 200 on coffee') or send HELP.",

  error: 'Something went sideways on my end. Try again, or send RESET to start fresh.',

  notLinked:
    "I see your message but this number isn't linked yet. Send LINK <6-digit code> from the web app.",
};
