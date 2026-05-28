/**
 * Browser-side MiniLM categoriser.
 *
 * Lazy-loads `@huggingface/transformers` and points it at the static
 * `/models/` folder. When the ONNX file isn't present (current state of
 * the repo), the loader fails fast and we surface a friendly message via
 * the settings store, leaving privacy mode disabled.
 */
import { browser } from '$app/environment';
import { isCategory, type Category } from '@finehance/shared';

interface ClassifierResult {
  category: Category;
  score: number;
}

type ClassifyFn = (text: string) => Promise<ClassifierResult | null>;

let loadingPromise: Promise<ClassifyFn | null> | null = null;
let cached: ClassifyFn | null = null;

/**
 * Returns a categorise function that the omnibar can call before
 * persisting a transaction. Returns `null` if the model artifact is
 * unavailable; the caller should disable privacy mode in that case.
 */
export async function loadMinilm(
  onProgress?: (progress: { status: string; loaded?: number; total?: number }) => void,
): Promise<ClassifyFn | null> {
  if (!browser) return null;
  if (cached) return cached;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // First, sanity-check that the ONNX file actually exists. The static
      // folder ships with everything except `onnx/model.onnx` until the
      // conversion script runs, so we need a graceful failure path.
      const head = await fetch('/models/onnx/model.onnx', { method: 'HEAD' });
      if (!head.ok) {
        return null;
      }

      const transformers = await import('@huggingface/transformers');
      const env = transformers.env as unknown as {
        allowLocalModels: boolean;
        allowRemoteModels: boolean;
        localModelPath: string;
      };
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = '/';

      const pipeline = transformers.pipeline as unknown as (
        task: string,
        model: string,
        options?: { progress_callback?: (p: { status: string; loaded?: number; total?: number }) => void },
      ) => Promise<unknown>;

      const classifier = (await pipeline('text-classification', 'models', {
        progress_callback: onProgress ?? (() => undefined),
      })) as (text: string) => Promise<Array<{ label: string; score: number }> | { label: string; score: number }>;

      cached = async (text: string) => {
        const out = await classifier(text);
        const top = Array.isArray(out) ? out[0] : out;
        if (!top || typeof top.score !== 'number') return null;
        if (!isCategory(top.label)) return null;
        if (top.score < 0.45) return null;
        return { category: top.label, score: top.score };
      };
      return cached;
    } catch {
      return null;
    }
  })();

  return loadingPromise;
}
