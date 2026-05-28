/**
 * WebSocket upgrade endpoint.
 *
 * `GET /ws` upgrades the connection. Auth is via the `Sec-WebSocket-Protocol`
 * header — the browser's WebSocket constructor takes a subprotocol array
 * and we encode the access token as `bearer.<jwt>`. We pick that out,
 * verify the JWT, and bind the socket to the resulting user id.
 *
 * Why subprotocol and not a query string: query strings end up in server
 * access logs. Subprotocols don't.
 *
 * The actual upgrade happens at the Bun.serve level (see `index.ts`); this
 * file just exposes a Hono handler that returns a 426 if the route is hit
 * with a regular GET and a small helper to validate the upgrade request.
 */
import { Hono } from 'hono';
import { errors } from '../utils/errors.ts';
import { verifyAccessToken } from '../services/auth/jwt.ts';

const app = new Hono();

app.get('/', (c) =>
  c.json(
    {
      success: false,
      error: {
        code: 'UPGRADE_REQUIRED',
        message:
          'Upgrade to WebSocket. Connect with `new WebSocket(url, ["bearer." + accessToken])`.',
      },
    },
    426,
  ),
);

export const wsRoutes = app;

export interface WsUpgradeAttempt {
  userId: string;
  activeSpaceId: string;
}

/** Inspect the upgrade request and return the authed user, or throw. */
export async function authoriseUpgrade(req: Request): Promise<WsUpgradeAttempt> {
  const protoHeader = req.headers.get('sec-websocket-protocol');
  let token: string | null = null;
  if (protoHeader) {
    for (const proto of protoHeader.split(',').map((s) => s.trim())) {
      if (proto.startsWith('bearer.')) {
        token = proto.slice('bearer.'.length);
        break;
      }
    }
  }
  // Accept Authorization header as a backup (curl-friendly during dev).
  if (!token) {
    const auth = req.headers.get('authorization');
    if (auth?.toLowerCase().startsWith('bearer ')) {
      token = auth.slice(7).trim();
    }
  }
  if (!token) throw errors.unauthorized('WebSocket upgrade requires a bearer token');
  const claims = await verifyAccessToken(token);
  return { userId: claims.sub, activeSpaceId: claims.asid };
}

export function selectedSubprotocol(req: Request): string | undefined {
  const protoHeader = req.headers.get('sec-websocket-protocol');
  if (!protoHeader) return undefined;
  for (const proto of protoHeader.split(',').map((s) => s.trim())) {
    if (proto.startsWith('bearer.')) return proto;
  }
  return undefined;
}
