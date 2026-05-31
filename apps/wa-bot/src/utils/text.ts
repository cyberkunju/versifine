/**
 * Universal command detection.
 *
 * The bot speaks six languages, but a small set of short commands always
 * works regardless of state or language: MENU, BACK, RESET, HELP, LANGUAGE,
 * HUMAN, STOP, STATUS, UNDO. Each command has equivalents in Hindi,
 * Kannada, Tamil, Telugu and Malayalam so the user can shout "मेनू" or
 * "ಮೆನು" and we still pick it up.
 *
 * `parseLinkCommand` separately handles the `LINK 482917` pairing flow.
 */

export type UniversalCommand =
  | 'MENU'
  | 'BACK'
  | 'RESET'
  | 'HELP'
  | 'LANGUAGE'
  | 'HUMAN'
  | 'STOP'
  | 'STATUS'
  | 'UNDO'
  | 'CONFIRM'
  | 'CANCEL'
  | 'EDIT';

const COMMAND_ALIASES: Array<{ command: UniversalCommand; patterns: string[] }> = [
  {
    command: 'MENU',
    patterns: ['menu', 'मेनू', 'मेन्यू', 'ಮೆನು', 'மெனு', 'మెను', 'മെനു'],
  },
  {
    command: 'BACK',
    patterns: ['back', 'पीछे', 'वापस', 'ಹಿಂದೆ', 'பின்', 'వెనుక', 'തിരികെ', 'പിന്നോട്ട്'],
  },
  {
    command: 'RESET',
    patterns: ['reset', 'रीसेट', 'ರೀಸೆಟ್', 'மீட்டமை', 'రీసెట్', 'റീസെറ്റ്'],
  },
  {
    command: 'HELP',
    patterns: ['help', 'मदद', 'ಸಹಾಯ', 'உதவி', 'సహాయం', 'സഹായം'],
  },
  {
    command: 'LANGUAGE',
    patterns: ['language', 'lang', 'भाषा', 'ಭಾಷೆ', 'மொழி', 'భాష', 'ഭാഷ'],
  },
  {
    command: 'HUMAN',
    patterns: ['human', 'agent', 'support', 'इंसान', 'ಮಾನವ', 'மனிதர்', 'మనిషి', 'മനുഷ്യൻ'],
  },
  {
    command: 'STOP',
    patterns: ['stop', 'रोको', 'ನಿಲ್ಲಿಸು', 'நிறுத்து', 'ఆపండి', 'നിർത്തുക'],
  },
  {
    command: 'STATUS',
    patterns: ['status', 'स्थिति', 'ಸ್ಥಿತಿ', 'நிலை', 'స్థితి', 'നില'],
  },
  {
    command: 'UNDO',
    patterns: ['undo', 'पूर्ववत', 'ರದ್ದು', 'திரும்ப', 'రద్దు', 'പിൻവലിക്കുക'],
  },
  {
    command: 'CONFIRM',
    patterns: ['confirm', 'yes', 'haan', 'haa', 'हाँ', 'पुष्टि', 'ಹೌದು', 'ஆம்', 'అవును', 'അതെ'],
  },
  {
    command: 'CANCEL',
    patterns: ['cancel', 'no', 'nahi', 'नहीं', 'ಬೇಡ', 'வேண்டாம்', 'వద్దు', 'വേണ്ട'],
  },
  {
    command: 'EDIT',
    patterns: ['edit', 'change', 'बदलें', 'ಬದಲಿಸಿ', 'திருத்து', 'మార్చు', 'തിരുത്തുക'],
  },
];

const ALIAS_LOOKUP: Map<string, UniversalCommand> = (() => {
  const map = new Map<string, UniversalCommand>();
  for (const row of COMMAND_ALIASES) {
    for (const alias of row.patterns) {
      map.set(alias.toLowerCase(), row.command);
    }
  }
  return map;
})();

/**
 * Detect a single-word universal command. The match is whole-string only —
 * "menu" yes, "menu please" no — so we don't accidentally swallow a sentence.
 */
export function parseUniversal(text: string): { command: UniversalCommand } | null {
  if (!text) return null;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  const cmd = ALIAS_LOOKUP.get(normalized);
  if (cmd) return { command: cmd };
  // Single-token but with stray punctuation: "menu!" → strip non-letters.
  const stripped = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  if (stripped !== normalized) {
    const hit = ALIAS_LOOKUP.get(stripped);
    if (hit) return { command: hit };
  }
  return null;
}

/** Parse `LINK 482917` (case-insensitive). Returns the six-digit code or null. */
export function parseLinkCommand(text: string): { code: string } | null {
  if (!text) return null;
  const match = text.trim().match(/^link\s+(\d{6})\s*$/i);
  if (!match) return null;
  return { code: match[1]! };
}

/**
 * Permissive email extractor for the onboarding "link your email" step.
 * Returns the first email-shaped token (lowercased) or null. We keep this
 * loose on purpose — the API re-validates with a strict schema, and a typo
 * just re-prompts rather than blocking onboarding.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function parseEmail(text: string): string | null {
  if (!text) return null;
  const match = text.match(EMAIL_RE);
  return match ? match[0].trim().toLowerCase() : null;
}

/**
 * Whether the user is declining the optional email step. Recognises "skip",
 * "no", "later", "don't need", typos ("skipp"), and full sentences like
 * "bro i dont need to link that" across the six supported languages — the
 * email step is OPTIONAL, so we err strongly toward "they want to move on".
 * Only a message that actually contains an email address is NOT a skip.
 */
const SKIP_TOKENS = [
  'skip',
  'skipp',
  'no',
  'nope',
  'naw',
  'nah',
  'later',
  'no thanks',
  'no thank',
  'not now',
  'dont',
  "don't",
  'do not',
  'no need',
  'not needed',
  'dont need',
  "don't need",
  'dont want',
  "don't want",
  'leave it',
  'forget it',
  'pass',
  'ignore',
  'cancel',
  'next',
  'continue',
  'proceed',
  'move on',
  'nahi',
  'नहीं',
  'बाद में',
  'छोड़ें',
  'വേണ്ട',
  'ഇല്ല',
  'പിന്നീട്',
  'பின்னர்',
  'வேண்டாம்',
  'తర్వాత',
  'వద్దు',
  'ಬೇಡ',
  'ನಂತರ',
].map((s) => s.toLowerCase());

export function looksLikeSkip(text: string): boolean {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  // A message carrying an actual email is never a skip.
  if (EMAIL_RE.test(normalized)) return false;
  // Any skip token appearing as a word/substring counts — covers typos and
  // full sentences ("bro i dont need to link that shit").
  return SKIP_TOKENS.some((tok) => normalized.includes(tok));
}

/** Chunk text into WhatsApp-friendly pieces; long bot replies get split. */
export function chunkText(text: string, maxLen = 1500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + maxLen);
    if (end < text.length) {
      // Prefer a clean break at a newline or sentence boundary.
      const window = text.slice(cursor, end);
      const lastNewline = window.lastIndexOf('\n');
      const lastSentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '));
      const breakAt = lastNewline > 200 ? lastNewline : lastSentence > 200 ? lastSentence + 1 : -1;
      if (breakAt !== -1) end = cursor + breakAt;
    }
    chunks.push(text.slice(cursor, end).trim());
    cursor = end;
  }
  return chunks;
}
