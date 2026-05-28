/**
 * Settings store.
 *
 * Theme + UI language + privacy mode + base currency live here. Theme
 * routes through `mode-watcher` for system-aware dark mode; language and
 * privacy mode are persisted to localStorage so the choice survives a
 * reload.
 */
import { browser } from '$app/environment';
import type { Currency, Language } from '@finehance/shared';

type Theme = 'light' | 'dark' | 'system';

const KEYS = {
  theme: 'finehance.theme',
  language: 'finehance.language',
  privacy: 'finehance.privacy',
  currency: 'finehance.currency',
} as const;

function readStorage(key: string): string | null {
  if (!browser) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (!browser) return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function applyThemeAttribute(theme: Theme): void {
  if (!browser) return;
  const html = document.documentElement;
  if (theme === 'system') {
    const matches = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.dataset.theme = matches ? 'dark' : 'light';
  } else {
    html.dataset.theme = theme;
  }
}

class SettingsStore {
  theme = $state<Theme>((readStorage(KEYS.theme) as Theme | null) ?? 'system');
  language = $state<Language>(((readStorage(KEYS.language) as Language | null) ?? 'en'));
  privacyMode = $state<boolean>(readStorage(KEYS.privacy) === '1');
  baseCurrency = $state<Currency>(
    (readStorage(KEYS.currency) as Currency | null) ?? 'INR',
  );
  /** True while the privacy-mode model is loading or refusing to load. */
  privacyModeStatus = $state<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
  privacyModeMessage = $state<string | null>(null);

  constructor() {
    if (browser) {
      applyThemeAttribute(this.theme);
      // Re-apply on system preference change when set to system.
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (this.theme === 'system') applyThemeAttribute('system');
      };
      mql.addEventListener?.('change', onChange);
    }
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    writeStorage(KEYS.theme, theme);
    applyThemeAttribute(theme);
  }

  setLanguage(language: Language): void {
    this.language = language;
    writeStorage(KEYS.language, language);
    if (browser) document.documentElement.lang = language;
  }

  setBaseCurrency(currency: Currency): void {
    this.baseCurrency = currency;
    writeStorage(KEYS.currency, currency);
  }

  setPrivacyMode(enabled: boolean): void {
    this.privacyMode = enabled;
    writeStorage(KEYS.privacy, enabled ? '1' : '0');
  }

  setPrivacyModeStatus(
    status: SettingsStore['privacyModeStatus'],
    message: string | null = null,
  ): void {
    this.privacyModeStatus = status;
    this.privacyModeMessage = message;
  }
}

export const settings = new SettingsStore();
