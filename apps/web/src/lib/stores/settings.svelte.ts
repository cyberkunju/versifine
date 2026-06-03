/**
 * Settings store.
 *
 * Theme + UI language + privacy mode + base currency live here. Theme
 * routes through `mode-watcher` for system-aware dark mode; language and
 * privacy mode are persisted to localStorage so the choice survives a
 * reload.
 */
import { browser } from '$app/environment';
import type { Currency, Language } from '@versifine/shared';

type Theme = 'light' | 'dark' | 'system';

const KEYS = {
  theme: 'versifine.theme',
  language: 'versifine.language',
  privacy: 'versifine.privacy',
  currency: 'versifine.currency',
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

function applyThemeAttribute(_theme: Theme): void {
  if (!browser) return;
  // Versifine ships a single light theme anchored on the brand navy.
  // We always apply 'light' regardless of the stored preference so the
  // editorial palette stays consistent across the app.
  document.documentElement.dataset.theme = 'light';
}

class SettingsStore {
  theme = $state<Theme>('light');
  language = $state<Language>((readStorage(KEYS.language) as Language | null) ?? 'en');
  privacyMode = $state<boolean>(readStorage(KEYS.privacy) === '1');
  baseCurrency = $state<Currency>((readStorage(KEYS.currency) as Currency | null) ?? 'INR');
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
