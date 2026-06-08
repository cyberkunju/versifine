/**
 * Hindi (हिन्दी) message pack.
 *
 * Hand-translated copy in Devanagari, paired with the English helpers
 * for currency formatting (numbers stay in Latin digits — most Indian
 * users read ₹4,250 the same way regardless of UI language).
 */
import { resolveCurrencySymbol } from '@versifine/shared';
import type { DraftSummary, MessagePack, QuerySummaryView, LedgerView, LedgerSettledView, DebtsView, TransferView } from './types.ts';

const PERIOD_LABELS_HI: Record<string, string> = {
  today: 'आज',
  yesterday: 'कल',
  this_week: 'इस हफ्ते',
  last_week: 'पिछले हफ्ते',
  this_month: 'इस महीने',
  last_month: 'पिछले महीने',
  this_year: 'इस साल',
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
  if (d.splitPeople && d.splitPeople >= 2) parts.push(`${d.splitPeople} लोगों में बँटा`);
  if (d.date) parts.push(`(${d.date})`);
  return parts.join(' ');
}

export const hi: MessagePack = {
  greeting:
    'नमस्ते! मैं Versifine हूँ — आपका पर्सनल पैसे का साथी। अपनी भाषा चुनें:\n' +
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
    "एक नंबर भेजें या सीधे 'हिन्दी' लिखें।",

  languageSet: (lang) => `बढ़िया। अब मैं आपसे ${lang} में बात करूँगा।`,

  askEmail:
    'एक छोटी सी बात — इसे किस email से जोड़ूँ?\n\n' +
    'अगर आप वेब पर उसी email से sign in करेंगे, तो आपका WhatsApp और वेब ' +
    'अकाउंट अपने-आप जुड़ जाएगा। यहाँ password की ज़रूरत नहीं।\n\n' +
    'अपना email भेजें, या बाद के लिए SKIP लिखें।',

  emailLinked: (email) => `${email} से जोड़ दिया। ✅ वेब पर इसी email से sign in करें — वही अकाउंट रहेगा।`,

  emailLinkedExisting: (email) =>
    `वापसी पर स्वागत है! यह नंबर अब आपके ${email} अकाउंट से जुड़ गया है। ✅ सब कुछ एक ही जगह।`,

  emailInvalid: 'यह email सही नहीं लग रहा। एक वैध email भेजें (जैसे you@example.com), या SKIP लिखें।',

  emailSkipped: 'कोई बात नहीं — छोड़ दिया। आप बाद में वेब ऐप से email जोड़ सकते हैं।',

  onboardingReady:
    'आप तैयार हैं — कोई sign-up नहीं चाहिए। ✅\n\n' +
    'बस बताइए आपने क्या खर्च किया। जैसे:\n' +
    '• "200 चाय पे"\n' +
    '• बिल की फोटो भेजें\n' +
    '• या अपनी भाषा में वॉइस नोट भेजें\n\n' +
    'मैं क्या-क्या कर सकता हूँ देखने के लिए कभी भी HELP भेजें।',

  welcomeBack: (name) => (name ? `वापसी पर स्वागत है, ${name}! 👋` : 'वापसी पर स्वागत है! 👋'),

  linkPrompt:
    'यह नंबर मेरे साथ अभी लिंक नहीं है। तीन छोटे कदम:\n' +
    '1. वेब पर रजिस्टर करें: versifine.com\n' +
    '2. Settings → Link WhatsApp खोलें — 6 अंकों का कोड मिलेगा\n' +
    '3. यहाँ भेजें: LINK 482917 (अपना कोड)\n\n' +
    'लिंक होते ही मैं आपका हर खर्चा रिकॉर्ड कर दूँगा।',

  linkConfirmed: (name) =>
    name
      ? `✅ लिंक हो गया! स्वागत है ${name}। आज़माएँ: "200 चाय पे" या HELP भेजें।`
      : '✅ लिंक हो गया! आज़माएँ: "200 चाय पे" या HELP भेजें।',

  linkInvalid: 'यह कोड नहीं चला। वेब Settings → Link WhatsApp से नया कोड लें और LINK <कोड> भेजें।',

  helpCard:
    'मैं ये सब कर सकता हूँ:\n' +
    "• खर्चा लिखें — '450 रुपये ऑटो पर'\n" +
    "• आमदनी — 'salary 85000 आई'\n" +
    '• फोटो — रसीद भेजें, मैं पढ़ लूँगा\n' +
    '• वॉइस नोट — 6 भाषाओं में बोलें\n' +
    "• पूछें — 'इस महीने खाने पर कितना खर्च?'\n" +
    "• बजट — 'set budget groceries 8000'\n" +
    "• सुधार — 'पिछला Food नहीं Transport था'\n\n" +
    'त्वरित कमांड: MENU · HELP · STATUS · UNDO · LANGUAGE · RESET · STOP',

  captureLogged: (amount, currency, category, baseAmount, baseCurrency) => {
    const formatted = formatAmount(amount, currency);
    const converted =
      baseAmount && baseCurrency && baseCurrency !== currency
        ? ` (${formatAmount(baseAmount, baseCurrency)})`
        : '';
    return category
      ? `✅ ${formatted}${converted} ${category} में जोड़ दिया।`
      : `✅ ${formatted}${converted} रिकॉर्ड हो गया।`;
  },

  captureLoggedMany: (items, total, currency) => {
    const lines = items
      .map((item) => `- ${formatAmount(item.amount, item.currency)} - ${item.description}`)
      .join('\n');
    return `${items.length} खर्च दर्ज किए (${formatAmount(total, currency)} कुल):\n${lines}`;
  },

  captureNeedsConfirm: (draft) =>
    `पुष्टि करें: ${describeDraft(draft)}\n\nCONFIRM लिखें save करने के लिए, EDIT बदलने के लिए, या CANCEL।`,

  captureFollowup: (q) => q,

  captureAsk: (needs) => {
    if (needs.includes('amount')) return 'कितने का था?';
    if (needs.includes('description')) return 'किस चीज़ के लिए था?';
    if (needs.includes('wallet')) return 'कौन सा अकाउंट या वॉलेट इस्तेमाल किया?';
    if (needs.includes('currency')) return 'कौन सी करेंसी थी?';
    return 'बस एक और जानकारी चाहिए — किस लिए था?';
  },

  captureCancelled: 'रद्द कर दिया। कुछ save नहीं हुआ।',

  captureFailed: 'इसे रिकॉर्ड नहीं कर पाया। फिर से कोशिश करें या RESET भेजें।',

  queryAnswer: (text) => text,

  queryReply: (q: QuerySummaryView) => {
    const period = q.periodKey ? (PERIOD_LABELS_HI[q.periodKey] ?? q.periodLabel) : q.periodLabel;
    if (q.kind === 'forecast') {
      const days = q.horizonDays ?? 30;
      return `अगले ${days} दिनों में आपका अनुमानित खर्च लगभग ${formatAmount(q.total, q.currency)} है।`;
    }
    if (q.kind === 'spending') {
      const on = q.category ? `${q.category} पर ` : '';
      return q.total > 0
        ? `आपने ${period} ${on}${formatAmount(q.total, q.currency)} खर्च किए हैं।`
        : `${period} ${on}कोई खर्च दर्ज नहीं है।`;
    }
    // summary
    if (q.total <= 0) return `${period} अभी तक कोई खर्च दर्ज नहीं है।`;
    let msg = `आपने ${period} ${formatAmount(q.total, q.currency)} खर्च किए हैं।`;
    if (q.topCategory && q.topCategory.total > 0) {
      msg += ` सबसे ज़्यादा: ${q.topCategory.category} (${formatAmount(q.topCategory.total, q.currency)})।`;
    }
    return msg;
  },

  copilotNudge: 'गहरे सवाल के लिए वेब copilot आज़माएँ: versifine.com। यहाँ भी पूछ सकते हैं — सीधे सवाल भेजें।',

  ledgerLogged: (v: LedgerView) => {
    const amt = formatAmount(v.amount, v.currency);
    return v.direction === 'lent'
      ? `✅ नोट कर लिया — ${v.counterparty} पर आपके ${amt} बाकी हैं। जब तक वापस न मिलें, मैं याद रखूँगा।`
      : `✅ नोट कर लिया — आप पर ${v.counterparty} के ${amt} बाकी हैं। जब तक चुक न जाएँ, मैं याद रखूँगा।`;
  },

  ledgerSettled: (v: LedgerSettledView) => {
    const paid = formatAmount(v.settledAmount, v.currency);
    const left = formatAmount(v.outstanding, v.currency);
    if (v.direction === 'lent') {
      return v.cleared
        ? `✅ पूरा हिसाब साफ़ — ${v.counterparty} ने आपके पूरे पैसे लौटा दिए।`
        : `✅ ${v.counterparty} से ${paid} वापस मिले। अभी ${left} और बाकी हैं।`;
    }
    return v.cleared
      ? `✅ पूरा हिसाब साफ़ — आपने ${v.counterparty} के पूरे पैसे लौटा दिए।`
      : `✅ ${v.counterparty} को ${paid} चुकाए। अभी ${left} और बाकी हैं।`;
  },

  debtsSummary: (v: DebtsView) => {
    const lines: string[] = [];
    if (v.scope !== 'borrowed' && v.receivables.length > 0) {
      lines.push('💰 आपको मिलने हैं:');
      for (const r of v.receivables) {
        lines.push(`• ${r.counterparty} — ${formatAmount(r.outstanding, v.currency)}`);
      }
      lines.push(`कुल: ${formatAmount(v.totalReceivable, v.currency)}`);
    }
    if (v.scope !== 'lent' && v.payables.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('💸 आपको चुकाने हैं:');
      for (const p of v.payables) {
        lines.push(`• ${p.counterparty} — ${formatAmount(p.outstanding, v.currency)}`);
      }
      lines.push(`कुल: ${formatAmount(v.totalPayable, v.currency)}`);
    }
    if (lines.length === 0) {
      if (v.counterparty) return `${v.counterparty} के साथ आपका हिसाब बराबर है — कुछ बाकी नहीं। 🎉`;
      return 'अभी आपका कोई उधार बाकी नहीं है। 🎉';
    }
    return lines.join('\n');
  },

  transferLogged: (v: TransferView) =>
    `✅ ${formatAmount(v.amount, v.currency)} ${v.fromName} से ${v.toName} में भेज दिए। (यह खर्च में नहीं गिना जाता।)`,

  budgetAskCategory: 'किस कैटेगरी के लिए? (जैसे Groceries, Restaurants, Transportation)',
  budgetAskAmount: (category) => `${category} के लिए हर महीने कितना?`,
  budgetSet: (category, amount) =>
    `📊 बजट सेट: ${category} → ${formatAmount(amount, 'INR')}/महीना। 80% पर alert कर दूँगा।`,

  correctApplied: (newCategory) =>
    `✅ बदल दिया। पिछला transaction अब ${newCategory} है। आगे similar entries भी इसी कैटेगरी में जाएँगी।`,
  correctUpdated: (summary) => `✅ अपडेट कर दिया — पिछला transaction अब ${summary} है।`,
  correctNotPossible:
    'सुधारने के लिए कोई हाल का transaction नहीं मिला। पिछला खर्च सही कैटेगरी के साथ फिर से भेजें।',

  statusLine: (state, language) =>
    `स्थिति: लिंक्ड, भाषा ${language}, वर्तमान चरण: ${state.toLowerCase()}।`,

  languageChanged: (label) => `✅ हो गया — अब मैं आपसे ${label} में बात करूँगा।`,
  replyModeText: '✅ ठीक है — अब से सिर्फ़ टेक्स्ट में जवाब दूँगा।',
  replyModeVoice: '✅ हो गया — अब हर जवाब के साथ एक वॉइस नोट भेजूँगा।',
  replyModeAuto: '✅ हो गया — आप जैसे भेजेंगे वैसे जवाब दूँगा: वॉइस का वॉइस, टेक्स्ट का टेक्स्ट।',

  resetDone: '🔄 रीसेट हो गया। HELP भेजें यह देखने के लिए कि मैं क्या कर सकता हूँ।',

  stopAcknowledged: 'ठीक है, अब चुप हो जाता हूँ। कभी भी messages भेज कर फिर से जगा सकते हैं।',

  unknown: "समझ नहीं आया। कोई खर्चा लिखें (जैसे '200 चाय पे') या HELP भेजें।",

  error: 'मेरी तरफ़ से कुछ गड़बड़ हुई। फिर से कोशिश करें या RESET भेजें।',

  notLinked: 'आपका message मिल गया लेकिन यह नंबर अभी लिंक नहीं है। वेब से 6 अंकों का कोड लेकर LINK <कोड> भेजें।',
};
