/**
 * Public environment surface for the web client.
 *
 * Vite exposes `VITE_*` variables on `import.meta.env` at build time. We
 * also accept the project-wide `PUBLIC_*` names for parity with the API.
 * Falling back to localhost defaults keeps `bun run dev` working without
 * a dotenv file in `apps/web/`.
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

export const PUBLIC_API_URL: string = pick('API_URL', 'http://localhost:5000');
export const PUBLIC_WS_URL: string = pick('WS_URL', 'ws://localhost:5000/ws');

/** True when the running build embeds a non-default API URL (used by debug strips). */
export const IS_LOCAL_API: boolean = PUBLIC_API_URL.includes('localhost');
