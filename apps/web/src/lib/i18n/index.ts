/**
 * UI shell i18n.
 *
 * Three hand-translated message packs (en/hi/ml) cover the UI shell.
 * Tamil, Telugu and Kannada fall back to English for the layout shell;
 * dynamic content (chat replies, transaction descriptions) translate
 * separately through the API's translate service.
 *
 * The pack shape is the same everywhere — picking a missing key is a
 * compile-time error, missing translations fall back gracefully.
 */
import type { Language } from '@versifine/shared';
import { en } from './en';
import { hi } from './hi';
import { ml } from './ml';

export interface MessagePack {
  app: {
    title: string;
    tagline: string;
  };
  nav: {
    dashboard: string;
    transactions: string;
    budgets: string;
    goals: string;
    forecast: string;
    reports: string;
    settings: string;
    askCopilot: string;
    signOut: string;
  };
  topbar: {
    omnibarPlaceholder: string;
    omnibarShortcut: string;
    commandShortcut: string;
    voice: string;
    image: string;
    privacyOn: string;
    privacyOff: string;
    theme: string;
    light: string;
    dark: string;
    system: string;
  };
  auth: {
    signIn: string;
    signUp: string;
    email: string;
    password: string;
    displayName: string;
    primaryLanguage: string;
    needAccount: string;
    haveAccount: string;
    welcomeBack: string;
    welcomeNew: string;
    invalidCredentials: string;
  };
  dashboard: {
    income: string;
    expense: string;
    savingsRate: string;
    netWorth: string;
    recent: string;
    forecast: string;
    topCategories: string;
    budgetAlerts: string;
    quickPrompts: string;
    promptWhereDidMyMoneyGo: string;
    promptForecast30: string;
    promptOverspending: string;
    promptCompareLastMonth: string;
    emptyTransactions: string;
    emptyAlerts: string;
  };
  transactions: {
    title: string;
    filters: string;
    from: string;
    to: string;
    type: string;
    category: string;
    wallet: string;
    search: string;
    importCsv: string;
    exportCsv: string;
    bulkChangeCategory: string;
    bulkDelete: string;
    edit: string;
    delete: string;
    saved: string;
    deleted: string;
    correctCategory: string;
    none: string;
  };
  budgets: {
    title: string;
    totalAllocated: string;
    totalSpent: string;
    totalRemaining: string;
    create: string;
    edit: string;
    name: string;
    recurrence: string;
    monthly: string;
    custom: string;
    warnAt: string;
    exceededAt: string;
    noBudgets: string;
  };
  goals: {
    title: string;
    create: string;
    contribute: string;
    target: string;
    current: string;
    deadline: string;
    projected: string;
    atRisk: string;
    noGoals: string;
  };
  forecast: {
    title: string;
    next30: string;
    recurring: string;
    variable: string;
    anomalies: string;
    method: string;
    noData: string;
  };
  reports: {
    title: string;
    range: string;
    thisMonth: string;
    lastMonth: string;
    quarter: string;
    year: string;
    custom: string;
    income: string;
    expense: string;
    savings: string;
    savingsRate: string;
    topCategory: string;
    byCategory: string;
    topMerchants: string;
    budgetAdherence: string;
    exportCsv: string;
  };
  settings: {
    title: string;
    account: string;
    language: string;
    baseCurrency: string;
    privacy: string;
    privacyHelp: string;
    privacyDownload: string;
    privacyReady: string;
    privacyUnavailable: string;
    phone: string;
    phoneHelp: string;
    phoneStart: string;
    phoneCode: string;
    wallets: string;
    addWallet: string;
    save: string;
    cancel: string;
  };
  copilot: {
    title: string;
    placeholder: string;
    streaming: string;
    error: string;
  };
  common: {
    loading: string;
    save: string;
    cancel: string;
    delete: string;
    confirm: string;
    edit: string;
    add: string;
    close: string;
    new: string;
    yes: string;
    no: string;
    today: string;
    yesterday: string;
  };
}

const PACKS: Record<Language, MessagePack> = {
  en,
  hi,
  ml,
  ta: en,
  te: en,
  kn: en,
};

export function getMessages(lang: Language): MessagePack {
  return PACKS[lang] ?? en;
}

export { en, hi, ml };
