/**
 * Auth store.
 *
 * Svelte 5 rune-based singleton holding the current user and access token.
 * Refresh token survives across tabs in localStorage; the access token
 * lives in memory only because a JWT in storage is the worst of both
 * worlds (XSS-readable but rarely rotated).
 *
 * The api client calls back into this store on a 401 to drive the refresh
 * dance, so we register the {@link TokenSource} adapter once on app boot.
 */
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import type { TokenSource } from '$lib/api/client';
import { api, attachTokenSource } from '$lib/api/client';
import { socket } from '$lib/api/ws';
import type {
  GoogleAuthInput,
  LoginInput,
  RegisterInput,
  TokenPair,
  UserSummary,
} from '$lib/api/types';

const REFRESH_KEY = 'versifine.refresh';

function readRefreshToken(): string | null {
  if (!browser) return null;
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(token: string | null): void {
  if (!browser) return;
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    // storage may be blocked; we degrade to in-memory only
  }
}

class AuthStore {
  user = $state<UserSummary | null>(null);
  accessToken = $state<string | null>(null);
  refreshToken = $state<string | null>(readRefreshToken());
  /** True while we're in the middle of an auth network request. */
  loading = $state(false);
  /** Hydration flag: true once we've attempted an initial profile load. */
  ready = $state(false);
  /**
   * Dev-only preview mode. When active (local `vite dev` + no real session),
   * the app shell renders against a seeded fake user so the UI can be worked
   * on at `/dashboard` without logging in. Never set in production builds.
   */
  devPreview = $state(false);

  private inflightRefresh: Promise<boolean> | null = null;

  /** Convenience: do we have credentials right now? */
  get isAuthenticated(): boolean {
    return this.devPreview || Boolean(this.accessToken && this.user);
  }

  /**
   * Seed a fake user for local UI work. No network, no tokens — purely so
   * the authenticated shell + pages render. Gated by callers behind
   * `import.meta.env.DEV`; a no-op if a real session already exists.
   */
  enableDevPreview(): void {
    if (this.accessToken && this.user) return;
    this.devPreview = true;
    this.user = {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'preview@versifine.local',
      displayName: 'Preview User',
      primaryLanguage: 'en',
      baseCurrency: 'INR',
      activeSpaceId: '00000000-0000-0000-0000-000000000001',
      whatsappPhone: null,
      whatsappPhoneVerifiedAt: null,
      createdAt: new Date().toISOString(),
    } as UserSummary;
    this.ready = true;
  }

  async login(input: LoginInput): Promise<UserSummary> {
    this.loading = true;
    try {
      const result = await api.auth.login(input);
      this.applyTokens(result.tokens);
      this.user = result.user;
      this.connectRealtime();
      return result.user;
    } finally {
      this.loading = false;
    }
  }

  async register(input: RegisterInput): Promise<UserSummary> {
    this.loading = true;
    try {
      const result = await api.auth.register(input);
      this.applyTokens(result.tokens);
      this.user = result.user;
      this.connectRealtime();
      return result.user;
    } finally {
      this.loading = false;
    }
  }

  async loginWithGoogle(input: GoogleAuthInput): Promise<UserSummary> {
    this.loading = true;
    try {
      const result = await api.auth.google(input);
      this.applyTokens(result.tokens);
      this.user = result.user;
      this.connectRealtime();
      return result.user;
    } finally {
      this.loading = false;
    }
  }

  async logout(): Promise<void> {
    const refresh = this.refreshToken;
    try {
      if (this.accessToken && refresh) {
        await api.auth.logout(refresh);
      }
    } catch {
      // server-side revoke failed; we still want to clear locally
    }
    this.clear();
    socket.disconnect();
    if (browser) await goto('/login');
  }

  async refresh(): Promise<boolean> {
    if (this.inflightRefresh) return this.inflightRefresh;
    if (!this.refreshToken) return false;
    const tokenAtStart = this.refreshToken;
    this.inflightRefresh = (async () => {
      try {
        const result = await api.auth.refresh(tokenAtStart);
        this.applyTokens(result.tokens);
        return true;
      } catch {
        this.clear();
        return false;
      }
    })();
    try {
      return await this.inflightRefresh;
    } finally {
      this.inflightRefresh = null;
    }
  }

  /** Loads the current profile if we have any token available. */
  async loadProfile(): Promise<UserSummary | null> {
    if (!this.refreshToken && !this.accessToken) {
      this.ready = true;
      return null;
    }
    try {
      // If we don't yet have an access token (page reload), refresh first.
      if (!this.accessToken && this.refreshToken) {
        const ok = await this.refresh();
        if (!ok) {
          this.ready = true;
          return null;
        }
      }
      const result = await api.auth.me();
      this.user = result.user;
      this.connectRealtime();
      return result.user;
    } catch {
      this.clear();
      return null;
    } finally {
      this.ready = true;
    }
  }

  /** Internal: keep memory + storage in lockstep. */
  private applyTokens(tokens: TokenPair): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    writeRefreshToken(tokens.refreshToken);
  }

  private clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    writeRefreshToken(null);
  }

  /** Wire the realtime channel after a successful auth. */
  private connectRealtime(): void {
    if (!browser) return;
    socket.connect(() => this.accessToken);
  }
}

export const auth = new AuthStore();

const tokenSource: TokenSource = {
  getAccessToken: () => auth.accessToken,
  getRefreshToken: () => auth.refreshToken,
  refresh: () => auth.refresh(),
  forceLogout: () => {
    // In local dev-preview there's no real session; a 401 from a data call
    // must NOT bounce us to /login or we'd never see the UI we're editing.
    if (auth.devPreview) return;
    void auth.logout();
  },
};

attachTokenSource(tokenSource);
