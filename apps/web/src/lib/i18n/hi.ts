/**
 * Hindi UI shell strings. Hand-translated for the seven primary pages and
 * common shell controls. Anything missing falls back to English.
 */
import type { MessagePack } from './index';
import { en } from './en';

const overrides: Partial<MessagePack> = {
  app: { ...en.app, tagline: 'आपके पैसों का संगीत, सही ताल पर।' },
  nav: {
    dashboard: 'डैशबोर्ड',
    transactions: 'लेनदेन',
    budgets: 'बजट',
    goals: 'लक्ष्य',
    forecast: 'पूर्वानुमान',
    reports: 'रिपोर्ट',
    settings: 'सेटिंग्स',
    askCopilot: 'विवियन से पूछें',
    signOut: 'साइन आउट',
  },
  topbar: {
    omnibarPlaceholder: 'जैसे: ऑटो पर 450 खर्च, या कुछ भी पूछें',
    omnibarShortcut: '⌘L',
    commandShortcut: '⌘K',
    voice: 'वॉइस नोट रिकॉर्ड करें',
    image: 'रसीद जोड़ें',
    privacyOn: 'प्राइवेसी मोड चालू है',
    privacyOff: 'प्राइवेसी मोड बंद है',
    theme: 'थीम',
    light: 'दिन',
    dark: 'रात',
    system: 'सिस्टम',
  },
  auth: {
    signIn: 'साइन इन',
    signUp: 'खाता बनाएं',
    email: 'ईमेल',
    password: 'पासवर्ड',
    displayName: 'नाम',
    primaryLanguage: 'मुख्य भाषा',
    needAccount: 'खाता नहीं है?',
    haveAccount: 'खाता पहले से है?',
    welcomeBack: 'वापसी पर स्वागत है',
    welcomeNew: 'Versifine में स्वागत है',
    invalidCredentials: 'ईमेल या पासवर्ड मेल नहीं खाता।',
  },
  dashboard: {
    ...en.dashboard,
    income: 'इस महीने की आमदनी',
    expense: 'इस महीने का खर्च',
    savingsRate: 'बचत दर',
    netWorth: 'कुल संपत्ति',
    recent: 'हाल के लेनदेन',
    forecast: 'अगले 30 दिन का पूर्वानुमान',
    topCategories: 'मुख्य श्रेणियाँ',
    budgetAlerts: 'बजट चेतावनी',
    quickPrompts: 'विवियन से पूछें',
  },
  common: {
    loading: 'लोड हो रहा है…',
    save: 'सहेजें',
    cancel: 'रद्द करें',
    delete: 'हटाएं',
    confirm: 'पुष्टि करें',
    edit: 'संपादित करें',
    add: 'जोड़ें',
    close: 'बंद करें',
    new: 'नया',
    yes: 'हाँ',
    no: 'नहीं',
    today: 'आज',
    yesterday: 'कल',
  },
};

export const hi: MessagePack = mergePack(en, overrides);

function mergePack(base: MessagePack, partial: Partial<MessagePack>): MessagePack {
  const out = { ...base } as MessagePack;
  for (const [section, values] of Object.entries(partial)) {
    out[section as keyof MessagePack] = {
      ...(base[section as keyof MessagePack] as Record<string, string>),
      ...(values as Record<string, string>),
    } as never;
  }
  return out;
}
