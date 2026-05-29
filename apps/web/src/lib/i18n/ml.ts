/**
 * Malayalam UI shell strings. Hand-translated keys covering nav, dashboard,
 * and the auth flow. Other strings fall back to English.
 */
import type { MessagePack } from './index';
import { en } from './en';

const overrides: Partial<MessagePack> = {
  app: { ...en.app, tagline: 'പണത്തിന്റെ ഈണം, ഭദ്രമായി.' },
  nav: {
    dashboard: 'ഡാഷ്ബോർഡ്',
    transactions: 'ഇടപാടുകൾ',
    budgets: 'ബജറ്റ്',
    goals: 'ലക്ഷ്യങ്ങൾ',
    forecast: 'പ്രവചനം',
    reports: 'റിപ്പോർട്ടുകൾ',
    settings: 'സജ്ജീകരണങ്ങൾ',
    askCopilot: 'വിവിയനോട് ചോദിക്കൂ',
    signOut: 'പുറത്തുകടക്കുക',
  },
  topbar: {
    omnibarPlaceholder: 'ഉദാ: ഓട്ടോക്ക് 450 ചെലവായി, അല്ലെങ്കിൽ എന്തും ചോദിക്കൂ',
    omnibarShortcut: '⌘L',
    commandShortcut: '⌘K',
    voice: 'വോയിസ് നോട്ട് റെക്കോർഡ് ചെയ്യുക',
    image: 'രസീത് ചേർക്കുക',
    privacyOn: 'പ്രൈവസി മോഡ് ഓൺ ആണ്',
    privacyOff: 'പ്രൈവസി മോഡ് ഓഫ് ആണ്',
    theme: 'തീം',
    light: 'പകൽ',
    dark: 'രാത്രി',
    system: 'സിസ്റ്റം',
  },
  auth: {
    signIn: 'സൈൻ ഇൻ',
    signUp: 'അക്കൗണ്ട് സൃഷ്ടിക്കുക',
    email: 'ഇമെയിൽ',
    password: 'പാസ്‌വേഡ്',
    displayName: 'പ്രദർശന നാമം',
    primaryLanguage: 'പ്രധാന ഭാഷ',
    needAccount: 'അക്കൗണ്ട് ഇല്ലേ?',
    haveAccount: 'ഇതിനോടകം അക്കൗണ്ട് ഉണ്ടോ?',
    welcomeBack: 'വീണ്ടും സ്വാഗതം',
    welcomeNew: 'Versifine ലേക്ക് സ്വാഗതം',
    invalidCredentials: 'ഇമെയിലും പാസ്‌വേഡും പൊരുത്തപ്പെടുന്നില്ല.',
  },
  dashboard: {
    ...en.dashboard,
    income: 'ഈ മാസത്തെ വരുമാനം',
    expense: 'ഈ മാസത്തെ ചെലവ്',
    savingsRate: 'സമ്പാദ്യ നിരക്ക്',
    netWorth: 'ആകെ ആസ്തി',
    recent: 'സമീപ ഇടപാടുകൾ',
    forecast: 'അടുത്ത 30 ദിവസത്തിന്റെ പ്രവചനം',
    topCategories: 'പ്രധാന വിഭാഗങ്ങൾ',
    budgetAlerts: 'ബജറ്റ് മുന്നറിയിപ്പുകൾ',
    quickPrompts: 'വിവിയനോട് ചോദിക്കൂ',
  },
  common: {
    loading: 'ലോഡ് ചെയ്യുന്നു…',
    save: 'സംരക്ഷിക്കുക',
    cancel: 'റദ്ദാക്കുക',
    delete: 'ഇല്ലാതാക്കുക',
    confirm: 'ഉറപ്പാക്കുക',
    edit: 'എഡിറ്റ്',
    add: 'ചേർക്കുക',
    close: 'അടയ്ക്കുക',
    new: 'പുതിയത്',
    yes: 'അതെ',
    no: 'ഇല്ല',
    today: 'ഇന്ന്',
    yesterday: 'ഇന്നലെ',
  },
};

export const ml: MessagePack = mergePack(en, overrides);

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
