/**
 * Public environment surface for the web client.
 *
 * In production we deploy behind nginx where everything is on the same
 * origin: `/` is the SvelteKit app, `/api/*` is the API, `/ws` is the
 * WebSocket. So the defaults are intentionally relative — same-origin
 * paths that work whether you're on https://versifine.com or any other
 * host.
 *
 * For local dev where api/web run on different ports, set the explicit
 * Vite env vars in `apps/web/.env` (or via the launcher's `--env-file`)
 * to point at the dev API.
 *
 * The deployment never compiles `localhost:5000` into the client bundle
 * because the build happens with no overrides; relative defaults win.
 */

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env ?? {};

function pick(key: string, fallback: string): string {
  return (
    env[`VITE_${key}`] ??
    env[`PUBLIC_${key}`] ??
    env[key] ??
    fallback
  );
}

/**
 * Base URL for the API. Defaults to '' (same origin) so fetch('/api/x')
 * works behind any nginx that proxies /api/. Override via VITE_API_URL
 * for cross-origin dev.
 */
export const PUBLIC_API_URL: string = pick('API_URL', '');

/**
 * WebSocket URL. Defaults to a same-origin upgrade — the runtime patches
 * 'ws://' or 'wss://' depending on `location.protocol`, with `/ws` path.
 */
function defaultWsUrl(): string {
  if (typeof window === 'undefined') return 'ws:///ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export const PUBLIC_WS_URL: string = pick('WS_URL', defaultWsUrl());

/** True when the running build embeds a non-default API URL (used by debug strips). */
export const IS_LOCAL_API: boolean = PUBLIC_API_URL.includes('localhost');
