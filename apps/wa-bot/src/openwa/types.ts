/**
 * Minimal structural types for the bot's whatsapp-web.js usage.
 *
 * The library ships its own `.d.ts` files but they pull in puppeteer's
 * type universe and complicate the wa-bot's `tsc --noEmit`. We narrow to
 * the surface we actually call so the rest of the bot can typecheck even
 * when puppeteer's types aren't installed (e.g., when Chromium download
 * was skipped during install).
 */

export interface WhatsAppLikeMessageMediaCtor {
  new (mimetype: string, dataBase64: string): unknown;
}

export interface WhatsAppLikeClient {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  sendMessage(
    to: string,
    content: string | object,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  getState(): Promise<string | null>;
}

export interface QrSnapshot {
  raw: string;
  /** The rendered PNG bytes, kept in memory so /qr.png never races a
   * half-written file on disk and doesn't depend on filesystem paths. */
  png: Buffer | null;
  /** `data:image/png;base64,…` form of the PNG, inlined straight into the
   * /qr HTML so the browser never makes a second request that a proxy or
   * CDN (Cloudflare) could cache, 404, or misroute. */
  dataUri: string | null;
  /** SVG markup of the QR — crisp at any size and used as the scannable
   * fallback when images are blocked. */
  svg: string | null;
  pngPath: string | null;
  asciiPreview: string;
  generatedAt: number;
}
