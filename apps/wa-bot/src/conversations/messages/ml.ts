/**
 * Malayalam (മലയാളം) message pack.
 *
 * Hand-translated copy in Malayalam script. Numbers stay in Latin digits
 * because users routinely read ₹450 the same way regardless of UI script,
 * and mixing Malayalam digits would break the curated merchant DB
 * patterns when the bot echoes user input back.
 */
import type { DraftSummary, MessagePack } from './types.ts';

function formatINR(value: number): string {
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
    '6. ಕನ್ನಡ\n\n' +
    "ഒരു നമ്പർ അയക്കൂ, അല്ലെങ്കിൽ 'മലയാളം' എന്ന് എഴുതൂ.",

  languageSet: (lang) => `ശരി. ഇനി ഞാൻ ${lang} ഭാഷയിലാണ് സംസാരിക്കുക.`,

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

  linkInvalid:
    'ഈ കോഡ് പ്രവർത്തിച്ചില്ല. വെബ് Settings → Link WhatsApp-ൽ പുതിയ കോഡ് നേടി LINK <code> അയക്കൂ.',

  helpCard:
    'ഞാൻ ഇതൊക്കെ ചെയ്യാം:\n' +
    "• ചെലവ് രേഖപ്പെടുത്തൂ — 'auto-inu 450 spent'\n" +
    "• വരുമാനം — 'salary 85000 kitti'\n" +
    "• ചിത്രങ്ങൾ — receipt അയക്കൂ, ഞാൻ വായിക്കാം\n" +
    '• വോയ്സ് നോട്ട് — 6 ഭാഷകളിൽ സംസാരിക്കാം\n' +
    "• ചോദ്യങ്ങൾ — 'ee maasam food-inu ethra?'\n" +
    "• ബജറ്റ് — 'set budget groceries 8000'\n" +
    "• തിരുത്തൽ — 'last one Food alla, Transport aanu'\n\n" +
    'കമാൻഡുകൾ: MENU · HELP · STATUS · UNDO · LANGUAGE · RESET · STOP',

  captureLogged: (amount, currency, category) =>
    category
      ? `✅ ${formatAmount(amount, currency)} ${category}-ൽ ചേർത്തു.`
      : `✅ ${formatAmount(amount, currency)} രേഖപ്പെടുത്തി.`,

  captureNeedsConfirm: (draft) =>
    `ഉറപ്പിക്കൂ: ${describeDraft(draft)}\n\nസേവ് ചെയ്യാൻ CONFIRM, മാറ്റാൻ EDIT, റദ്ദാക്കാൻ CANCEL.`,

  captureFollowup: (q) => q,

  captureCancelled: 'റദ്ദാക്കി. ഒന്നും സേവ് ചെയ്തിട്ടില്ല.',

  captureFailed:
    'ഇത് രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. വീണ്ടും ശ്രമിക്കൂ അല്ലെങ്കിൽ RESET അയക്കൂ.',

  queryAnswer: (text) => text,

  copilotNudge:
    'വിശദമായ ചോദ്യങ്ങൾക്ക് വെബ് copilot ഉപയോഗിക്കാം: versifine.com. ഇവിടെയും ചോദിക്കാം — ചോദ്യം നേരിട്ട് അയക്കൂ.',

  budgetAskCategory:
    'ഏത് കാറ്റഗറിക്കാണ്? (Groceries, Restaurants, Transportation പോലെ)',
  budgetAskAmount: (category) => `${category}-നു ഓരോ മാസവും എത്ര?`,
  budgetSet: (category, amount) =>
    `📊 ബജറ്റ് സെറ്റ്: ${category} → ${formatAmount(amount, 'INR')}/മാസം. 80%-ൽ ഞാൻ alert ചെയ്യാം.`,

  correctApplied: (newCategory) =>
    `✅ മാറ്റി. അവസാനത്തെ transaction ഇപ്പോൾ ${newCategory} ആണ്. ഇതേപോലെ വരുന്ന entries-ഉം ഇനി ഈ category-യിലേക്ക് വരും.`,
  correctNotPossible:
    'തിരുത്താൻ പാകത്തിൽ ഒരു transaction കണ്ടെത്താനായില്ല. അവസാന ചെലവ് ശരിയായ category-യോടെ വീണ്ടും അയക്കൂ.',

  statusLine: (state, language) =>
    `സ്റ്റാറ്റസ്: ലിങ്ക്ഡ്, ഭാഷ ${language}, നിലവിലെ ഘട്ടം: ${state.toLowerCase()}.`,

  resetDone:
    '🔄 റീസെറ്റ് ചെയ്തു. എന്ത് ചെയ്യാമെന്ന് കാണാൻ HELP അയക്കൂ.',

  stopAcknowledged:
    'ശരി, ഇനി ഞാൻ മറുപടി തരില്ല. എപ്പോൾ വേണമെങ്കിലും message അയച്ച് ഉണർത്താം.',

  unknown:
    "മനസ്സിലായില്ല. ഒരു ചെലവ് അയക്കൂ ('200 chai') അല്ലെങ്കിൽ HELP അയക്കൂ.",

  error:
    'എന്റെ ഭാഗത്ത് എന്തോ കുഴപ്പം. വീണ്ടും ശ്രമിക്കൂ അല്ലെങ്കിൽ RESET അയക്കൂ.',

  notLinked:
    'നിങ്ങളുടെ message കിട്ടി, പക്ഷേ ഈ നമ്പർ ലിങ്ക് ചെയ്തിട്ടില്ല. വെബിൽ നിന്ന് 6 അക്ക കോഡ് നേടി LINK <code> അയക്കൂ.',
};
