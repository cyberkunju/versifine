/**
 * MiniLM categorizer — tier 3.
 *
 * The fine-tuned MiniLM (`CyberKunju/finehance-categorizer-minilm`) emits a
 * single label from the 23-category set. It runs locally in-process via
 * `@huggingface/transformers` ONNX runtime when ONNX siblings are present
 * under `apps/api/src/ml/model/onnx/`. When the artifact is missing — which
 * is the default state until someone runs `optimum-cli` — we log a single
 * warn and degrade to "unavailable" for the lifetime of the process.
 *
 * Two important properties:
 *   1. Lazy. We never touch the package at module import; the first
 *      `categorizeWithMiniLM` call drives the load. This keeps API boot
 *      free of ONNX runtime cost (~30 MB resident) when the model is not
 *      available.
 *   2. Sticky on failure. If the load throws, every subsequent call returns
 *      null without retrying. This avoids a slow loop logging the same
 *      missing-file error on every transaction creation.
 *
 * We also enforce a confidence floor of 0.45 — below that the prediction
 * is too noisy to be useful, so we return null and let the caller fall
 * through to the default tier.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isCategory, type Category } from '@finehance/shared';
import { log } from '../../utils/logger.ts';

export interface MiniLMHit {
  category: Category;
  score: number;
}

type ClassifyFn = (text: string) => Promise<MiniLMHit | null>;

const MIN_CONFIDENCE = 0.45;
const MODEL_DIR = resolve(import.meta.dirname, '../../ml/model');
const ONNX_CANDIDATES = [
  'onnx/model.onnx',
  'onnx/model_quantized.onnx',
  'onnx/model_fp16.onnx',
] as const;

let loadPromise: Promise<ClassifyFn | null> | null = null;
let warnedUnavailable = false;

/**
 * Idempotent loader. First caller drives the import + pipeline construction;
 * everyone else awaits the same promise. Cached forever — even on failure
 * we cache `null` so we don't retry.
 */
export function loadClassifier(): Promise<ClassifyFn | null> {
  if (loadPromise) return loadPromise;
  loadPromise = doLoad();
  return loadPromise;
}

async function doLoad(): Promise<ClassifyFn | null> {
  // Cheap precondition: if no ONNX file is on disk, don't even import the
  // runtime. This is the common case until someone converts the model.
  const hasOnnx = ONNX_CANDIDATES.some((rel) => existsSync(join(MODEL_DIR, rel)));
  if (!hasOnnx) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      log.warn('CATEGORIZE_MINILM_UNAVAILABLE', {
        reason: 'no_onnx_artifact',
        modelDir: MODEL_DIR,
        hint: 'run apps/api scripts/convert-minilm-to-onnx.ts after exporting ONNX',
      });
    }
    return null;
  }

  let mod: typeof import('@huggingface/transformers');
  try {
    mod = await import('@huggingface/transformers');
  } catch (err) {
    logUnavailable('import_failed', err);
    return null;
  }

  try {
    // Restrict the loader to local files. `localModelPath` is the parent of
    // the model directory; we then ask for `'model'` so the loader resolves
    // to `<MODEL_DIR>` (= `<localModelPath>/model`).
    mod.env.allowLocalModels = true;
    mod.env.allowRemoteModels = false;
    mod.env.localModelPath = resolve(MODEL_DIR, '..');

    const classifier = await mod.pipeline('text-classification', 'model', {
      device: 'cpu',
      dtype: 'fp32',
    });

    log.info('CATEGORIZE_MINILM_READY', { modelDir: MODEL_DIR });

    return async (text: string): Promise<MiniLMHit | null> => {
      const cleaned = text.trim();
      if (!cleaned) return null;
      const raw = await classifier(cleaned);
      // The pipeline returns either a single object or an array of them
      // depending on input shape. We always pass a single string, so the
      // top of the list (or the single object) is what we want.
      const top = Array.isArray(raw) ? raw[0] : raw;
      if (!top || typeof top !== 'object') return null;
      const label = (top as { label?: unknown }).label;
      const score = (top as { score?: unknown }).score;
      if (typeof label !== 'string' || typeof score !== 'number') return null;
      if (!isCategory(label)) return null;
      return { category: label, score };
    };
  } catch (err) {
    logUnavailable('pipeline_init_failed', err);
    return null;
  }
}

function logUnavailable(reason: string, err: unknown): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  log.warn('CATEGORIZE_MINILM_UNAVAILABLE', {
    reason,
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Classify a single description. Returns null when:
 *   - the model is unavailable (no ONNX, init failed),
 *   - the inference itself throws,
 *   - the top label is below `MIN_CONFIDENCE`,
 *   - the top label is not in our 23-category set.
 *
 * Callers treat null as "no opinion" and fall through to the default tier.
 */
export async function categorizeWithMiniLM(text: string): Promise<MiniLMHit | null> {
  const classify = await loadClassifier();
  if (!classify) return null;
  try {
    const hit = await classify(text);
    if (!hit) return null;
    if (hit.score < MIN_CONFIDENCE) {
      log.debug('CATEGORIZE_MINILM_LOW_CONFIDENCE', {
        category: hit.category,
        score: Number(hit.score.toFixed(3)),
      });
      return null;
    }
    return hit;
  } catch (err) {
    log.warn('CATEGORIZE_MINILM_INFER_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
