#!/usr/bin/env bun
/**
 * Banned-phrase CI lint.
 *
 * The empath subagent named "Manglish in → English lecture out" the cardinal
 * sin. L1-3 fixes every existing site by switching to `effectiveLanguage`
 * + localized message-pack keys. This lint stops the regression: any string
 * literal in a runtime code path that emits one of the banned English
 * fallback phrases fails CI.
 *
 * The phrases are exactly the ones the empath flagged as "performative
 * confusion" — they communicate that the bot didn't understand AND offer no
 * actionable next move. We outlaw them outright. Every error response must
 * either:
 *   • come from a localized MessagePack key (en/hi/ml + Sarvam fallback),
 *   • OR offer 2-3 specific next moves (a sayback, not a generic apology).
 *
 * Scope: scans `apps/wa-bot/src/**` (the bot — user-facing). The API can
 * still emit English strings that get translated by the bot, but anything
 * the bot composes locally must be language-aware.
 *
 * Exempt: `messages/en.ts` (the English pack itself), test files, scripts/.
 *
 * Usage: `bun run apps/wa-bot/scripts/lint-banned-phrases.mjs`. Exits 0
 * when clean, 1 with a list of offenders when not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Each entry is a phrase (case-insensitive substring match) we forbid in
 * runtime code. `excuse` documents WHY — what to do instead.
 */
const BANNED = [
  {
    phrase: "i'm not sure what you mean",
    excuse:
      "Use a localized MessagePack key (e.g. m.unknown / m.copilotNudge) AND offer 2-3 specific next moves.",
  },
  {
    phrase: 'i don\'t understand',
    excuse:
      'Localized MessagePack keys + actionable next moves. Generic confusion strings drive users away.',
  },
  {
    phrase: 'could you rephrase',
    excuse:
      'Use m.captureAsk(needs) which says EXACTLY what is missing in the user\'s language.',
  },
  {
    phrase: "sorry, i don't",
    excuse:
      'Apologise concretely (m.error / m.captureFailed) and offer next moves. Generic apologies are noise.',
  },
  {
    phrase: 'i can\'t help with that',
    excuse:
      'Always offer next-best help (m.copilotNudge / m.helpCard). "Can\'t help" with no alternative is a dead end.',
  },
  {
    phrase: 'cancelled. what would you like to do',
    excuse:
      'Use m.frameCancelled (localized). Hardcoded English here breaks Manglish/Hinglish/native-script users.',
  },
  {
    phrase: 'something went wrong',
    excuse:
      'Use m.engineError / m.error (localized) instead. The bare phrase ships in en text only.',
  },
  {
    phrase: 'nothing to confirm',
    excuse: 'Use m.nothingToConfirm (localized).',
  },
  {
    phrase: 'i need one missing detail',
    excuse: 'Use m.captureMissingDetail (localized).',
  },
  {
    phrase: "i couldn't find a matching",
    excuse: 'Use m.refNoMatch (localized).',
  },
  {
    phrase: 'which one do you want to',
    excuse: 'Use m.refMultipleCandidates (localized).',
  },
  {
    phrase: 'found the entry but i need',
    excuse: 'Use m.refUpdateNeedsTarget (localized).',
  },
  {
    phrase: "i couldn't make out that voice",
    excuse: 'Use m.voiceUnclear (localized).',
  },
];

/** Files under `src/` we DO scan. Exclude tests + the en message pack. */
const EXCLUDE_PATHS = [
  'conversations/messages/en.ts',
  'conversations/messages/hi.ts',
  'conversations/messages/ml.ts',
  // Type definitions only — no runtime strings.
  'conversations/messages/types.ts',
];

/** Recursively collect all `.ts` files under `src/` minus exclusions. */
function listSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) {
      listSources(full, acc);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !EXCLUDE_PATHS.includes(rel)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Strip JS line and block comments so the lint only inspects RUNTIME code,
 * not JSDoc descriptions of localized keys ("see m.error for the localised
 * 'something went wrong' message"). Keeps strings intact: a string literal
 * containing `//` is not a comment.
 *
 * Implementation is intentionally simple — we tokenise character-by-char,
 * tracking whether we're inside a string. Edge cases (template literal
 * expressions, comments in regex literals) are out of scope; the bot
 * codebase doesn't lean on those for runtime user-facing strings.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    // Line comment
    if (ch === '/' && next === '/') {
      const eol = src.indexOf('\n', i);
      // Preserve the newline so line numbers are unchanged.
      out += '\n'.repeat(0);
      const stop = eol < 0 ? src.length : eol;
      // Replace comment text with spaces so column-based math is roughly
      // preserved (line numbers are exact since we keep the trailing \n).
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close < 0 ? src.length : close + 2;
      // Preserve newlines inside the block so line numbers stay aligned.
      const block = src.slice(i, stop);
      out += block.replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    // String literal — pass through (even if it contains // or /*).
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        const c = src[i];
        out += c;
        i += 1;
        if (c === '\\' && i < src.length) {
          out += src[i];
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const offenders = [];
for (const file of listSources(ROOT)) {
  const raw = readFileSync(file, 'utf8');
  const text = stripComments(raw);
  const lower = text.toLowerCase();
  for (const { phrase, excuse } of BANNED) {
    let from = 0;
    while (true) {
      const idx = lower.indexOf(phrase, from);
      if (idx < 0) break;
      // Compute line number using the ORIGINAL text (stripComments preserves
      // newlines so line numbers match).
      const line = text.slice(0, idx).split(/\r?\n/).length;
      const ctx = raw
        .slice(Math.max(0, idx - 30), Math.min(raw.length, idx + phrase.length + 30))
        .replace(/\s+/g, ' ')
        .trim();
      offenders.push({
        file: relative(REPO_ROOT, file).replace(/\\/g, '/'),
        line,
        phrase,
        excuse,
        context: ctx,
      });
      from = idx + phrase.length;
    }
  }
}

if (offenders.length === 0) {
  console.log(`✓ banned-phrase lint clean (${BANNED.length} phrases checked)`);
  process.exit(0);
}

console.error(`✗ banned-phrase lint failed — ${offenders.length} offender(s):\n`);
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}`);
  console.error(`    phrase: "${o.phrase}"`);
  console.error(`    fix:    ${o.excuse}`);
  console.error(`    near:   …${o.context}…`);
  console.error();
}
console.error(
  `\n${offenders.length} banned phrase${
    offenders.length === 1 ? '' : 's'
  } detected. Replace with localized MessagePack keys (en/hi/ml).`,
);
process.exit(1);
