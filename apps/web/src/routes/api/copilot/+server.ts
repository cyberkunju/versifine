/**
 * SSE proxy.
 *
 * The browser doesn't have a clean way to read a streaming POST response
 * with the Authorization header attached, so we proxy through SvelteKit's
 * server. The user's bearer token comes in on the request, we forward it
 * to the upstream API, and stream the body back unchanged.
 *
 * Keeps the upstream URL out of the browser bundle when we eventually run
 * behind a reverse proxy: the server-side env var is the only place the
 * actual API host is configured.
 */
import type { RequestHandler } from '@sveltejs/kit';
import { PUBLIC_API_URL } from '$lib/config';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const upstream = await fetch(`${PUBLIC_API_URL}/copilot/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: request.headers.get('authorization') ?? '',
    },
    body: await request.text(),
  });

  // Pass through whatever the API returned. SSE for the happy path,
  // a JSON error envelope when something goes wrong upstream.
  const headers = new Headers();
  const ct = upstream.headers.get('content-type') ?? 'text/event-stream';
  headers.set('content-type', ct);
  headers.set('cache-control', 'no-cache, no-transform');
  headers.set('x-accel-buffering', 'no');
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
};
