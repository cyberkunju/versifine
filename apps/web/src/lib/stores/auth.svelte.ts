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
import type { LoginInput, RegisterInput, TokenPair, UserSummary } from '$lib/api/types';

const REFRESH_KEY = 'finehance.refresh';

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

  private inflightRefresh: Promise<boolean> | null = null;

  /** Convenience: do we have credentials right now? */
  get isAuthenticated(): boolean {
    return Boolean(this.accessToken && this.user);
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
    void auth.logout();
  },
};

attachTokenSource(tokenSource);
