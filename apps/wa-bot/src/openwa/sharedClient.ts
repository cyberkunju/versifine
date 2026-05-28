/**
 * Late-bound accessor for the WhatsApp client.
 *
 * `internalServer.ts` needs to call `sendMessage` from inside route
 * handlers, but the client hasn't been constructed when the server
 * starts. Importing `createClient.ts` directly would create a cycle
 * (the client's media handler imports the engine which imports … etc).
 *
 * The shared module is a tiny mailbox: `setClient(client)` from
 * `createClient.ts` once the client is ready, `getClient()` from
 * routes that need to send. Routes that fire before the client is ready
 * surface a "client not connected" error.
 */
import type { WhatsAppLikeClient } from './types.ts';

let bound: WhatsAppLikeClient | null = null;

export function setSharedClient(client: WhatsAppLikeClient): void {
  bound = client;
}

export function getSharedClient(): WhatsAppLikeClient | null {
  return bound;
}

export function clearSharedClient(): void {
  bound = null;
}
