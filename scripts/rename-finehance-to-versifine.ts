/**
 * Rebrand: Finehance → Versifine.
 *
 * Walks the repo (skipping ignored dirs and binaries), applies four
 * case-aware replacements, prints a per-file diff summary, and bails on
 * any file we can't safely categorise. Paths to rename live in the
 * separate file-moves section after text replacement is complete.
 *
 * Run with `bun run scripts/rename-finehance-to-versifine.ts`.
 * Add `--dry-run` to print what WOULD change without touching disk.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, renameSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const DRY = process.argv.includes('--dry-run');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '_study',
  '_probe',
  '.svelte-kit',
  'build',
  'dist',
  '.deploy-env',
  '.wwebjs_auth',
  '.wwebjs_cache',
]);

// Skip binary / non-text by extension. Everything else is treated as
// text and read with utf-8.
const SKIP_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.svg', // safe to skip; our svgs don't contain the brand
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.tar',
  '.gz',
  '.onnx',
  '.safetensors',
  '.pdf',
  '.lock',
  '.bin',
  '.lockb',
]);

// Applied in order. Earlier rules win if a regex would also match a
// later rule's source (none of these conflict in practice).
const RULES: Array<[RegExp, string]> = [
  [/FINEHANCE/g, 'VERSIFINE'],
  [/Finehance/g, 'Versifine'],
  [/finehance\.app/g, 'versifine.com'],
  [/finehance/g, 'versifine'],
];

function shouldSkipPath(rel: string): boolean {
  const parts = rel.split(sep);
  for (const p of parts) if (SKIP_DIRS.has(p)) return true;
  // Don't rewrite this script.
  if (rel.endsWith('rename-finehance-to-versifine.ts')) return true;
  return false;
}

function shouldSkipExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return SKIP_EXTS.has(name.slice(dot).toLowerCase());
}

function applyRules(input: string): { output: string; changed: boolean; matches: number } {
  let output = input;
  let matches = 0;
  for (const [pattern, replacement] of RULES) {
    const before = output;
    output = output.replace(pattern, replacement);
    if (output !== before) {
      // Count by re-scanning the original — RegExp match counts won't
      // double-count overlapping rules since each rule fires once on
      // its turn.
      const m = before.match(pattern);
      matches += m ? m.length : 0;
    }
  }
  return { output, changed: output !== input, matches };
}

interface FileChange {
  path: string;
  matches: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = full.slice(ROOT.length + 1);
    if (shouldSkipPath(rel)) continue;
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      if (shouldSkipExt(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

console.log(`rebrand: scanning ${ROOT}${DRY ? ' (dry-run)' : ''}`);
const files = walk(ROOT);
console.log(`rebrand: ${files.length} candidate files`);

const changes: FileChange[] = [];
let totalMatches = 0;

for (const file of files) {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    // Probably a binary leveldb log. Skip.
    continue;
  }
  if (!/finehance/i.test(content)) continue;
  // Skip files that look binary (NULs at the start). LevelDB LOG files
  // are ASCII but contain NULs in their LDB siblings.
  if (content.indexOf('\0') !== -1) continue;
  const { output, matches } = applyRules(content);
  if (output === content) continue;
  changes.push({ path: file.slice(ROOT.length + 1), matches });
  totalMatches += matches;
  if (!DRY) {
    writeFileSync(file, output, 'utf8');
  }
}

changes.sort((a, b) => b.matches - a.matches);
for (const c of changes) console.log(`${String(c.matches).padStart(4)}  ${c.path}`);
console.log(`rebrand: ${changes.length} files updated, ${totalMatches} total replacements${DRY ? ' (dry-run)' : ''}`);

// ---------- Path renames ------------------------------------------------
// Only safe if the moves don't break paths referenced from gitignore'd
// state (.wwebjs_auth/session-FINEHANCE_DEV stays in place; the bot
// regenerates it on next pair under the new SESSION_ID).
//
// Spec dir rename is the only structural move we do here.

const SPEC_OLD = join(ROOT, '.kiro', 'specs', 'finehance');
const SPEC_NEW = join(ROOT, '.kiro', 'specs', 'versifine');
if (existsSync(SPEC_OLD) && !existsSync(SPEC_NEW)) {
  if (DRY) {
    console.log(`rebrand: would rename ${SPEC_OLD} -> ${SPEC_NEW}`);
  } else {
    cpSync(SPEC_OLD, SPEC_NEW, { recursive: true });
    rmSync(SPEC_OLD, { recursive: true, force: true });
    console.log(`rebrand: renamed ${SPEC_OLD} -> ${SPEC_NEW}`);
  }
}

console.log('rebrand: done.');
