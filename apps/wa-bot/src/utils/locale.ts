/**
 * Locale normalization for the bot → API contract.
 *
 * The API's /capture/* `locale` field is a short language enum
 * (en/hi/ml/ta/te/kn). Callers sometimes hold a BCP-47 tag like `en-IN`
 * (from LANGUAGE_META.bcp47) which the API's zod enum rejects with a 400.
 * Collapse any tag to its primary subtag and drop anything that isn't a
 * supported language so a bad locale degrades to "no locale" instead of
 * failing the whole request.
 */
const SUPPORTED_LOCALES = new Set(['en', 'hi', 'ml', 'ta', 'te', 'kn']);

export function normalizeLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return SUPPORTED_LOCALES.has(primary) ? primary : undefined;
}
