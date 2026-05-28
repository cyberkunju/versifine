/**
 * Convert / fetch the fine-tuned MiniLM categorizer for Transformers.js.
 *
 * The HF repo `CyberKunju/finehance-categorizer-minilm` ships
 * `model.safetensors` + tokenizer + `label_map.json`. Transformers.js needs
 * an ONNX bundle (`onnx/model.onnx` or a quantized variant) to run the
 * classification pipeline locally. There is no pure-JS converter for
 * safetensors → ONNX in 2026, so this script does two things:
 *
 *   1. Tries the optimistic path: `pipeline('text-classification', repo)` —
 *      if the upstream maintainer ever publishes ONNX siblings (`onnx/...`),
 *      Transformers.js will pick them up via its hub cache transparently.
 *      We then copy the cache into `apps/api/src/ml/model/` and
 *      `apps/web/static/models/` for offline reuse.
 *
 *   2. Falls back gracefully: if no ONNX is available, we download the raw
 *      model card + tokenizer + label map and emit a `manifest.json` that
 *      tells `services/categorize/minilm.ts` to skip MiniLM and let the
 *      merchant DB + default handle categorization. We also print the
 *      `optimum-cli` one-liner the user can run manually with a Python
 *      toolchain to produce the ONNX artifacts.
 *
 * This script is idempotent. Re-runs are cheap; downloads use the HF cache.
 *
 * Usage:
 *     bun run --cwd apps/api convert:minilm
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const REPO_ID = 'CyberKunju/finehance-categorizer-minilm';
const REVISION = 'main';

const HF_BASE = `https://huggingface.co/${REPO_ID}/resolve/${REVISION}`;

// Files we always want present so the categorizer can at least introspect
// the label set even when ONNX is unavailable.
const RAW_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.txt',
  'special_tokens_map.json',
  'label_map.json',
] as const;

// ONNX siblings we hope to find. Optional — absence triggers the fallback path.
const ONNX_CANDIDATES = [
  'onnx/model.onnx',
  'onnx/model_quantized.onnx',
  'onnx/model_fp16.onnx',
] as const;

const ROOT = resolve(import.meta.dirname, '..');
const API_MODEL_DIR = resolve(ROOT, 'src/ml/model');
const WEB_MODEL_DIR = resolve(ROOT, '../web/static/models');

interface ConversionSummary {
  hasOnnx: boolean;
  onnxFile?: string;
  apiDir: string;
  webDir: string;
  labels: string[];
  testInput: string;
  testCategory?: string;
  testScore?: number;
  warning?: string;
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

async function downloadIfMissing(repoPath: string, destPath: string): Promise<boolean> {
  if (existsSync(destPath)) return true;
  ensureDir(dirname(destPath));
  const url = `${HF_BASE}/${repoPath}`;
  process.stdout.write(`  · GET ${repoPath} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    process.stdout.write(`miss (${res.status})\n`);
    return false;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  process.stdout.write(`ok (${(buf.byteLength / 1024).toFixed(1)} KB)\n`);
  return true;
}

async function copyDirInto(src: string, dest: string) {
  ensureDir(dest);
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const sp = join(src, entry.name);
    const dp = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirInto(sp, dp);
    } else if (entry.isFile()) {
      await copyFile(sp, dp);
    }
  }
}

async function dirSizeBytes(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(p);
    } else {
      const s = await stat(p);
      total += s.size;
    }
  }
  return total;
}

function readLabels(modelDir: string): string[] {
  const labelPath = join(modelDir, 'label_map.json');
  const configPath = join(modelDir, 'config.json');
  if (existsSync(labelPath)) {
    try {
      const parsed = JSON.parse(readFileSync(labelPath, 'utf8')) as Record<string, unknown>;
      // Two common shapes: {label: id} or {id: label} or {id2label: {...}}.
      if (parsed.id2label && typeof parsed.id2label === 'object') {
        return Object.values(parsed.id2label as Record<string, string>).map(String);
      }
      const entries = Object.entries(parsed);
      if (entries.length === 0) return [];
      const firstEntry = entries[0];
      if (!firstEntry) return [];
      const firstKey = firstEntry[0];
      const looksLikeIdKey = /^\d+$/.test(firstKey);
      if (looksLikeIdKey) {
        return entries
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, v]) => String(v));
      }
      return Object.keys(parsed);
    } catch {
      // fall through
    }
  }
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { id2label?: Record<string, string> };
      if (cfg.id2label) {
        return Object.entries(cfg.id2label)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, v]) => v);
      }
    } catch {
      // ignore
    }
  }
  return [];
}

async function tryInference(
  modelDir: string,
): Promise<{ category: string; score: number } | null> {
  // Lazy import — the package is heavy (loads ONNX runtime).
  const mod = await import('@huggingface/transformers');
  // Make the loader prefer our local files. Transformers.js uses
  // `env.localModelPath` + `env.allowRemoteModels` to gate fetches.
  mod.env.allowLocalModels = true;
  mod.env.localModelPath = resolve(modelDir, '..'); // parent of `model/`
  mod.env.allowRemoteModels = false;

  try {
    // The pipeline expects a directory containing config + tokenizer + onnx/.
    const classifier = await mod.pipeline('text-classification', 'model', {
      // Bun on Windows has crashed in the past with WASM; pin to node CPU.
      device: 'cpu',
      dtype: 'fp32',
    });
    const out = (await classifier('starbucks coffee 250')) as Array<{
      label: string;
      score: number;
    }>;
    const top = Array.isArray(out) ? out[0] : null;
    if (!top) return null;
    return { category: top.label, score: Number(top.score) };
  } catch (err) {
    console.warn('  · inference probe failed:', (err as Error).message);
    return null;
  }
}

async function main() {
  console.log(`finehance · convert MiniLM (${REPO_ID})`);
  ensureDir(API_MODEL_DIR);
  ensureDir(WEB_MODEL_DIR);

  // Step 1 — download the always-needed files.
  let downloadedAny = false;
  for (const f of RAW_FILES) {
    const ok = await downloadIfMissing(f, join(API_MODEL_DIR, f));
    if (ok) downloadedAny = true;
  }

  // Step 2 — try optional ONNX siblings.
  let onnxFile: string | undefined;
  for (const candidate of ONNX_CANDIDATES) {
    const ok = await downloadIfMissing(candidate, join(API_MODEL_DIR, candidate));
    if (ok) {
      onnxFile = candidate;
      break;
    }
  }

  // Step 3 — mirror to web/static/models for the Privacy Mode bundle.
  await copyDirInto(API_MODEL_DIR, WEB_MODEL_DIR);

  const labels = readLabels(API_MODEL_DIR);
  console.log(`  · labels detected: ${labels.length}`);

  let testCategory: string | undefined;
  let testScore: number | undefined;
  let warning: string | undefined;

  if (onnxFile) {
    console.log('  · running inference probe…');
    const result = await tryInference(API_MODEL_DIR);
    if (result) {
      testCategory = result.category;
      testScore = result.score;
      console.log(`    → "${result.category}" (score=${result.score.toFixed(3)})`);
      if (result.score < 0.5) {
        warning = `Inference probe returned low confidence (${result.score.toFixed(3)}).`;
      }
    } else {
      warning = 'ONNX downloaded but Transformers.js failed to run inference.';
    }
  } else {
    warning =
      'No ONNX siblings found on the HF repo. The categorizer will gracefully ' +
      'fall back to the merchant DB + default tier. To enable MiniLM, run:\n' +
      '    pip install --upgrade "optimum[exporters,onnxruntime]" transformers\n' +
      `    optimum-cli export onnx --model ${REPO_ID} ${join(API_MODEL_DIR, 'onnx')}\n` +
      '  Then re-run this script to mirror the files into apps/web/static/models.';
    console.warn(`  · ${warning.split('\n')[0]}`);
  }

  const summary: ConversionSummary = {
    hasOnnx: Boolean(onnxFile),
    onnxFile,
    apiDir: API_MODEL_DIR,
    webDir: WEB_MODEL_DIR,
    labels,
    testInput: 'starbucks coffee 250',
    testCategory,
    testScore,
    warning,
  };

  const manifest = {
    repoId: REPO_ID,
    revision: REVISION,
    convertedAt: new Date().toISOString(),
    hasOnnx: summary.hasOnnx,
    onnxFile: summary.onnxFile ?? null,
    labels: summary.labels,
    sizeBytes: await dirSizeBytes(API_MODEL_DIR),
  };
  writeFileSync(join(API_MODEL_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(WEB_MODEL_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('\nSummary');
  console.log('-------');
  console.log(`  api dir     : ${summary.apiDir}`);
  console.log(`  web dir     : ${summary.webDir}`);
  console.log(`  size on disk: ${(manifest.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  labels      : ${summary.labels.length} (first: ${summary.labels.slice(0, 3).join(', ')}${summary.labels.length > 3 ? ', …' : ''})`);
  console.log(`  ONNX ready  : ${summary.hasOnnx ? 'yes' : 'no — fallback active'}`);
  if (summary.testCategory) {
    console.log(
      `  probe       : "${summary.testInput}" → ${summary.testCategory} ` +
        `(score=${(summary.testScore ?? 0).toFixed(3)})`,
    );
  }
  if (summary.warning) {
    console.log('\n  warning:');
    for (const line of summary.warning.split('\n')) {
      console.log(`    ${line}`);
    }
  }

  if (!downloadedAny) {
    console.error('\nNo files downloaded. Check your network connection or the HF repo id.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('convert-minilm-to-onnx failed:', err);
  process.exit(1);
});
