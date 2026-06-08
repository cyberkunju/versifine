/**
 * Malayalam (മലയാളം) message pack.
 *
 * Hand-translated copy in Malayalam script. Numbers stay in Latin digits
 * because users routinely read ₹450 the same way regardless of UI script,
 * and mixing Malayalam digits would break the curated merchant DB
 * patterns when the bot echoes user input back.
 */
import { resolveCurrencySymbol } from '@versifine/shared';
import type { DraftSummary, MessagePack, QuerySummaryView, LedgerView, LedgerSettledView, DebtsView, TransferView } from './types.ts';

const PERIOD_LABELS_ML: Record<string, string> = {
  today: 'ഇന്ന്',
  yesterday: 'ഇന്നലെ',
  this_week: 'ഈ ആഴ്ച',
  last_week: 'കഴിഞ്ഞ ആഴ്ച',
  this_month: 'ഈ മാസം',
  last_month: 'കഴിഞ്ഞ മാസം',
  this_year: 'ഈ വർഷം',
};

function formatINR(value: number): string {
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

function describeDraft(d: DraftSummary): string {
  const parts: string[] = [];
  if (d.amount !== null && d.currency) parts.push(formatAmount(d.amount, d.currency));
  else if (d.amount !== null) parts.push(`₹${formatINR(d.amount)}`);
  if (d.description) parts.push(`— ${d.description}`);
  if (d.category) parts.push(`(${d.category})`);
  if (d.splitPeople && d.splitPeople >= 2) parts.push(`${d.splitPeople} പേർക്കിടയിൽ വിഭജിച്ചു`);
  if (d.date) parts.push(`(${d.date})`);
  return parts.join(' ');
}

export const ml: MessagePack = {
  greeting:
    'നമസ്കാരം! ഞാൻ Versifine — നിങ്ങളുടെ പേഴ്സണൽ പണ സഹായിയാണ്. ഭാഷ തിരഞ്ഞെടുക്കൂ:\n' +
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
    "ഒരു നമ്പർ അയക്കൂ, അല്ലെങ്കിൽ 'മലയാളം' എന്ന് എഴുതൂ.",

  languageSet: (lang) => `ശരി. ഇനി ഞാൻ ${lang} ഭാഷയിലാണ് സംസാരിക്കുക.`,

  askEmail:
    'ഒരു ചെറിയ കാര്യം — ഇത് ഏത് email-ലേക്ക് ലിങ്ക് ചെയ്യണം?\n\n' +
    'വെബിൽ അതേ email കൊണ്ട് sign in ചെയ്താൽ നിങ്ങളുടെ WhatsApp-ഉം വെബ് ' +
    'അക്കൗണ്ടും തനിയെ ഒന്നായി ചേരും. ഇവിടെ password വേണ്ട.\n\n' +
    'നിങ്ങളുടെ email അയക്കൂ, അല്ലെങ്കിൽ പിന്നീട് ചെയ്യാൻ SKIP എന്ന് അയക്കൂ.',

  emailLinked: (email) =>
    `${email}-ലേക്ക് ലിങ്ക് ചെയ്തു. ✅ വെബിൽ ഈ email കൊണ്ട് sign in ചെയ്യൂ — അതേ അക്കൗണ്ട്.`,

  emailLinkedExisting: (email) =>
    `വീണ്ടും സ്വാഗതം! ഈ നമ്പർ ഇപ്പോൾ നിങ്ങളുടെ ${email} അക്കൗണ്ടുമായി ചേർന്നു. ✅ എല്ലാം ഒരിടത്ത്.`,

  emailInvalid:
    'ഇത് email പോലെ തോന്നുന്നില്ല. ശരിയായ ഒന്ന് അയക്കൂ (you@example.com പോലെ), അല്ലെങ്കിൽ SKIP അയക്കൂ.',

  emailSkipped: 'കുഴപ്പമില്ല — ഒഴിവാക്കി. പിന്നീട് വെബ് ആപ്പിൽ നിന്ന് email ലിങ്ക് ചെയ്യാം.',

  onboardingReady:
    'നിങ്ങൾ തയ്യാർ — sign-up ഒന്നും വേണ്ട. ✅\n\n' +
    'നിങ്ങൾ എന്ത് ചെലവാക്കി എന്ന് പറഞ്ഞാൽ മതി. ഉദാഹരണത്തിന്:\n' +
    '• "auto-inu 200 spent"\n' +
    '• ബില്ലിന്റെ ഫോട്ടോ അയക്കൂ\n' +
    '• അല്ലെങ്കിൽ നിങ്ങളുടെ ഭാഷയിൽ വോയ്സ് നോട്ട് അയക്കൂ\n\n' +
    'ഞാൻ എന്തൊക്കെ ചെയ്യാമെന്ന് കാണാൻ എപ്പോൾ വേണമെങ്കിലും HELP അയക്കൂ.',

  welcomeBack: (name) => (name ? `വീണ്ടും സ്വാഗതം, ${name}! 👋` : 'വീണ്ടും സ്വാഗതം! 👋'),

  linkPrompt:
    'ഈ നമ്പർ എനിക്ക് ഇതുവരെ ലിങ്ക് ചെയ്തിട്ടില്ല. മൂന്ന് ചെറിയ പടികൾ:\n' +
    '1. വെബിൽ രജിസ്റ്റർ ചെയ്യൂ: versifine.com\n' +
    '2. Settings → Link WhatsApp തുറന്ന് 6 അക്ക കോഡ് നോക്കൂ\n' +
    '3. ഇവിടെ അയക്കൂ: LINK 482917 (നിങ്ങളുടെ കോഡ്)\n\n' +
    'ലിങ്ക് ചെയ്താൽ ഉടനെ നിങ്ങൾ അയക്കുന്ന ഓരോ ചെലവും ഞാൻ രേഖപ്പെടുത്തും.',

  linkConfirmed: (name) =>
    name
      ? `✅ ലിങ്ക് ചെയ്തു! സ്വാഗതം, ${name}. പരീക്ഷിക്കൂ: "200 chai" അല്ലെങ്കിൽ HELP അയക്കൂ.`
      : '✅ ലിങ്ക് ചെയ്തു! പരീക്ഷിക്കൂ: "200 chai" അല്ലെങ്കിൽ HELP അയക്കൂ.',

  linkInvalid: 'ഈ കോഡ് പ്രവർത്തിച്ചില്ല. വെബ് Settings → Link WhatsApp-ൽ പുതിയ കോഡ് നേടി LINK <code> അയക്കൂ.',

  helpCard:
    'ഞാൻ ഇതൊക്കെ ചെയ്യാം:\n' +
    "• ചെലവ് രേഖപ്പെടുത്തൂ — 'auto-inu 450 spent'\n" +
    "• വരുമാനം — 'salary 85000 kitti'\n" +
    '• ചിത്രങ്ങൾ — receipt അയക്കൂ, ഞാൻ വായിക്കാം\n' +
    '• വോയ്സ് നോട്ട് — 6 ഭാഷകളിൽ സംസാരിക്കാം\n' +
    "• ചോദ്യങ്ങൾ — 'ee maasam food-inu ethra?'\n" +
    "• ബജറ്റ് — 'set budget groceries 8000'\n" +
    "• തിരുത്തൽ — 'last one Food alla, Transport aanu'\n\n" +
    'കമാൻഡുകൾ: MENU · HELP · STATUS · UNDO · LANGUAGE · RESET · STOP',

  captureLogged: (amount, currency, category, baseAmount, baseCurrency) => {
    const formatted = formatAmount(amount, currency);
    const converted =
      baseAmount && baseCurrency && baseCurrency !== currency
        ? ` (${formatAmount(baseAmount, baseCurrency)})`
        : '';
    return category
      ? `✅ ${formatted}${converted} ${category}-ൽ ചേർത്തു.`
      : `✅ ${formatted}${converted} രേഖപ്പെടുത്തി.`;
  },

  captureLoggedMany: (items, total, currency) => {
    const lines = items
      .map((item) => `- ${formatAmount(item.amount, item.currency)} - ${item.description}`)
      .join('\n');
    return `${items.length} ചെലവുകൾ രേഖപ്പെടുത്തി (${formatAmount(total, currency)} മൊത്തം):\n${lines}`;
  },

  captureNeedsConfirm: (draft) =>
    `ഉറപ്പിക്കൂ: ${describeDraft(draft)}\n\nസേവ് ചെയ്യാൻ CONFIRM, മാറ്റാൻ EDIT, റദ്ദാക്കാൻ CANCEL.`,

  captureFollowup: (q) => q,

  captureAsk: (needs) => {
    if (needs.includes('amount')) return 'എത്ര രൂപയായിരുന്നു?';
    if (needs.includes('description')) return 'എന്തിനായിരുന്നു?';
    if (needs.includes('wallet')) return 'ഏത് അക്കൗണ്ട്/വാലറ്റ് ഉപയോഗിച്ചു?';
    if (needs.includes('currency')) return 'ഏത് കറൻസിയായിരുന്നു?';
    return 'ഒരു വിവരം കൂടി വേണം — എന്തിനായിരുന്നു?';
  },

  captureCancelled: 'റദ്ദാക്കി. ഒന്നും സേവ് ചെയ്തിട്ടില്ല.',

  captureFailed: 'ഇത് രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. വീണ്ടും ശ്രമിക്കൂ അല്ലെങ്കിൽ RESET അയക്കൂ.',

  queryAnswer: (text) => text,

  queryReply: (q: QuerySummaryView) => {
    const period = q.periodKey ? (PERIOD_LABELS_ML[q.periodKey] ?? q.periodLabel) : q.periodLabel;
    if (q.kind === 'forecast') {
      const days = q.horizonDays ?? 30;
      return `അടുത്ത ${days} ദിവസത്തിൽ ഏകദേശം ${formatAmount(q.total, q.currency)} ചെലവാകുമെന്ന് പ്രതീക്ഷിക്കുന്നു.`;
    }
    if (q.kind === 'spending') {
      const on = q.category ? `${q.category}-ന് ` : '';
      return q.total > 0
        ? `${period} നിങ്ങൾ ${on}${formatAmount(q.total, q.currency)} ചെലവാക്കി.`
        : `${period} ${on}ഒരു ചെലവും രേഖപ്പെടുത്തിയിട്ടില്ല.`;
    }
    // summary
    if (q.total <= 0) return `${period} ഇതുവരെ ഒരു ചെലവും രേഖപ്പെടുത്തിയിട്ടില്ല.`;
    let msg = `${period} നിങ്ങൾ ${formatAmount(q.total, q.currency)} ചെലവാക്കി.`;
    if (q.topCategory && q.topCategory.total > 0) {
      msg += ` ഏറ്റവും കൂടുതൽ: ${q.topCategory.category} (${formatAmount(q.topCategory.total, q.currency)}).`;
    }
    return msg;
  },

  copilotNudge:
    'വിശദമായ ചോദ്യങ്ങൾക്ക് വെബ് copilot ഉപയോഗിക്കാം: versifine.com. ഇവിടെയും ചോദിക്കാം — ചോദ്യം നേരിട്ട് അയക്കൂ.',

  ledgerLogged: (v: LedgerView) => {
    const amt = formatAmount(v.amount, v.currency);
    return v.direction === 'lent'
      ? `✅ കുറിച്ചുവെച്ചു — ${v.counterparty} നിങ്ങൾക്ക് ${amt} തരാനുണ്ട്. തിരികെ കിട്ടുന്നതുവരെ ഞാൻ ഓർത്തുവെക്കാം.`
      : `✅ കുറിച്ചുവെച്ചു — നിങ്ങൾ ${v.counterparty}-ന് ${amt} കൊടുക്കാനുണ്ട്. തീരുന്നതുവരെ ഞാൻ ഓർത്തുവെക്കാം.`;
  },

  ledgerBatchLogged: (entries) => {
    const lines = entries.map((e) =>
      e.direction === 'lent'
        ? `• ${e.counterparty} നിങ്ങൾക്ക് ${formatAmount(e.amount, e.currency)} തരാനുണ്ട്`
        : `• നിങ്ങൾ ${e.counterparty}-ന് ${formatAmount(e.amount, e.currency)} കൊടുക്കാനുണ്ട്`,
    );
    return `✅ ${entries.length} എൻട്രികൾ കുറിച്ചു:\n${lines.join('\n')}\nഎല്ലാം ഞാൻ ഓർത്തുവെക്കാം.`;
  },

  ledgerSettled: (v: LedgerSettledView) => {
    const paid = formatAmount(v.settledAmount, v.currency);
    const left = formatAmount(v.outstanding, v.currency);
    if (v.direction === 'lent') {
      return v.cleared
        ? `✅ കണക്ക് തീർന്നു — ${v.counterparty} മുഴുവൻ പണവും തിരികെ തന്നു.`
        : `✅ ${v.counterparty}-ൽ നിന്ന് ${paid} തിരികെ കിട്ടി. ഇനിയും ${left} ബാക്കിയുണ്ട്.`;
    }
    return v.cleared
      ? `✅ കണക്ക് തീർന്നു — നിങ്ങൾ ${v.counterparty}-ന് മുഴുവൻ പണവും തിരികെ കൊടുത്തു.`
      : `✅ ${v.counterparty}-ന് ${paid} കൊടുത്തു. ഇനിയും ${left} ബാക്കിയുണ്ട്.`;
  },

  debtsSummary: (v: DebtsView) => {
    const lines: string[] = [];
    if (v.scope !== 'borrowed' && v.receivables.length > 0) {
      lines.push('💰 നിങ്ങൾക്ക് കിട്ടാനുള്ളത്:');
      for (const r of v.receivables) {
        lines.push(`• ${r.counterparty} — ${formatAmount(r.outstanding, v.currency)}`);
      }
      lines.push(`ആകെ: ${formatAmount(v.totalReceivable, v.currency)}`);
    }
    if (v.scope !== 'lent' && v.payables.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('💸 നിങ്ങൾ കൊടുക്കാനുള്ളത്:');
      for (const p of v.payables) {
        lines.push(`• ${p.counterparty} — ${formatAmount(p.outstanding, v.currency)}`);
      }
      lines.push(`ആകെ: ${formatAmount(v.totalPayable, v.currency)}`);
    }
    if (lines.length === 0) {
      if (v.counterparty) return `${v.counterparty}-യുമായി കണക്ക് ശരിയാണ് — ഒന്നും ബാക്കിയില്ല. 🎉`;
      return 'ഇപ്പോൾ ബാക്കിയുള്ള കടമൊന്നുമില്ല. 🎉';
    }
    return lines.join('\n');
  },

  transferLogged: (v: TransferView) =>
    `✅ ${formatAmount(v.amount, v.currency)} ${v.fromName}-ൽ നിന്ന് ${v.toName}-ലേക്ക് മാറ്റി. (ഇത് ചെലവായി കണക്കാക്കില്ല.)`,

  goalSet: (name, targetAmount, deadline) =>
    `🎯 ലക്ഷ്യം സെറ്റ് ചെയ്തു: ${name} — ${formatAmount(targetAmount, 'INR')} സമ്പാദിക്കണം${deadline ? ` ${deadline}-നകം` : ''}. നിങ്ങളുടെ പുരോഗതി ഞാൻ ട്രാക്ക് ചെയ്യാം.`,

  budgetAskCategory: 'ഏത് കാറ്റഗറിക്കാണ്? (Groceries, Restaurants, Transportation പോലെ)',
  budgetAskAmount: (category) => `${category}-നു ഓരോ മാസവും എത്ര?`,
  budgetSet: (category, amount) =>
    `📊 ബജറ്റ് സെറ്റ്: ${category} → ${formatAmount(amount, 'INR')}/മാസം. 80%-ൽ ഞാൻ alert ചെയ്യാം.`,
  budgetSetOverall: (amount) =>
    `📊 മാസ ബജറ്റ് സെറ്റ്: ${formatAmount(amount, 'INR')} (എല്ലാ ചെലവും ചേർത്ത്). 80%-ൽ ഞാൻ alert ചെയ്യാം.`,

  correctApplied: (newCategory) =>
    `✅ മാറ്റി. അവസാനത്തെ transaction ഇപ്പോൾ ${newCategory} ആണ്. ഇതേപോലെ വരുന്ന entries-ഉം ഇനി ഈ category-യിലേക്ക് വരും.`,
  correctNotPossible:
    'തിരുത്താൻ പാകത്തിൽ ഒരു transaction കണ്ടെത്താനായില്ല. അവസാന ചെലവ് ശരിയായ category-യോടെ വീണ്ടും അയക്കൂ.',
  correctUpdated: (summary) => `✅ അപ്ഡേറ്റ് ചെയ്തു — അവസാന transaction ഇപ്പോൾ ${summary} ആണ്.`,

  statusLine: (state, language) =>
    `സ്റ്റാറ്റസ്: ലിങ്ക്ഡ്, ഭാഷ ${language}, നിലവിലെ ഘട്ടം: ${state.toLowerCase()}.`,

  languageChanged: (label) => `✅ ശരി — ഇനി ഞാൻ നിങ്ങളോട് ${label}-ൽ സംസാരിക്കും.`,
  replyModeText: '✅ ശരി — ഇനി ടെക്സ്റ്റ് ആയി മാത്രം മറുപടി തരും.',
  replyModeVoice: '✅ ശരി — ഓരോ മറുപടിയോടൊപ്പവും ഒരു വോയ്സ് നോട്ട് അയക്കും.',
  replyModeAuto: '✅ ശരി — നിങ്ങൾ അയക്കുന്നത് പോലെ മറുപടി തരും: വോയ്സിന് വോയ്സ്, ടെക്സ്റ്റിന് ടെക്സ്റ്റ്.',

  resetDone: '🔄 റീസെറ്റ് ചെയ്തു. എന്ത് ചെയ്യാമെന്ന് കാണാൻ HELP അയക്കൂ.',

  stopAcknowledged: 'ശരി, ഇനി ഞാൻ മറുപടി തരില്ല. എപ്പോൾ വേണമെങ്കിലും message അയച്ച് ഉണർത്താം.',

  unknown: "മനസ്സിലായില്ല. ഒരു ചെലവ് അയക്കൂ ('200 chai') അല്ലെങ്കിൽ HELP അയക്കൂ.",

  error: 'എന്റെ ഭാഗത്ത് എന്തോ കുഴപ്പം. വീണ്ടും ശ്രമിക്കൂ അല്ലെങ്കിൽ RESET അയക്കൂ.',

  notLinked:
    'നിങ്ങളുടെ message കിട്ടി, പക്ഷേ ഈ നമ്പർ ലിങ്ക് ചെയ്തിട്ടില്ല. വെബിൽ നിന്ന് 6 അക്ക കോഡ് നേടി LINK <code> അയക്കൂ.',
};
