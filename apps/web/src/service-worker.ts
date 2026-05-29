/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Service worker.
 *
 * Three caching strategies, each tuned to the asset class:
 *
 *   - App shell + JS chunks: cache-first (precache on install). The shell
 *     stays usable when offline so dashboards render last-known data.
 *   - Static models (`/models/...`): cache-first with no expiry. The
 *     30 MB MiniLM bundle should hit network exactly once per device.
 *   - Everything else (HTML, GET requests to `/api`-style paths): network-
 *     first with a stale-while-revalidate fallback so we serve cached
 *     content if the network is down but immediately rehydrate when it
 *     returns.
 *
 * The omnibar uses a separate IndexedDB queue (`pendingCaptures`) for
 * write-side offline buffering. The SW's job is purely the read side
 * plus the background-sync trigger that drains the write queue when
 * connectivity returns.
 */
import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const SHELL_CACHE = `versifine-shell-${version}`;
const MODELS_CACHE = 'versifine-models-v1'; // version-independent — bundle rarely changes
const RUNTIME_CACHE = `versifine-runtime-${version}`;

// Everything SvelteKit emits as a build artefact + everything we ship
// under `static/` is precached on install. `build` already includes
// fingerprinted hashes so version-cycles invalidate cleanly.
const PRECACHE: string[] = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE);
      // Take over immediately on the next page load.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, MODELS_CACHE, RUNTIME_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isModelAsset(url: URL): boolean {
  return url.origin === self.location.origin && url.pathname.startsWith('/models/');
}

function isShellAsset(url: URL): boolean {
  return (
    url.origin === self.location.origin &&
    (PRECACHE.includes(url.pathname) ||
      url.pathname.startsWith('/_app/') ||
      url.pathname === '/manifest.webmanifest' ||
      url.pathname === '/favicon.svg')
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Pass through cross-origin requests untouched.
  if (url.origin !== self.location.origin) return;

  if (isModelAsset(url)) {
    event.respondWith(cacheFirst(request, MODELS_CACHE));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  // Page navigations and everything else: stale-while-revalidate so we
  // get instant repeat loads with a fresh copy in the background.
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// Tab-side script can ping the SW to drain the offline capture queue
// after `online`. The queue itself lives in IndexedDB on the page side
// so the SW just relays the message to active clients.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (!data || typeof data.type !== 'string') return;
  if (data.type === 'SYNC_PENDING_CAPTURES') {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'DRAIN_QUEUE' });
        }
      })(),
    );
  }
  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Don't await the put — we already have the response we need.
      void cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Last-ditch: return a synthetic 504 so the page can render an
    // offline state instead of throwing a network error.
    return new Response(`offline: ${(err as Error).message}`, {
      status: 504,
      statusText: 'Offline',
    });
  }
}

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch((err) => {
      // If we have a cached copy we'll surface that below; otherwise
      // bubble the error so the caller can render an offline UI.
      if (cached) return cached;
      return new Response(`offline: ${(err as Error).message}`, {
        status: 504,
        statusText: 'Offline',
      });
    });
  return cached ?? network;
}

export {};
