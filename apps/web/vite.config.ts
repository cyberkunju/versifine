import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Vite + SvelteKit + Tailwind 4. Tailwind plugin must come before the
 * SvelteKit plugin so the CSS pipeline picks it up first.
 *
 * The dev server defaults to port 5173 and proxies nothing — the API
 * runs on its own port (5000) and CORS is permissive in development.
 */
export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), sveltekit()],
  envPrefix: ['VITE_', 'PUBLIC_'],
  server: {
    port: 5173,
    strictPort: false,
    // Local dev convenience: open straight to the dashboard. Paired with the
    // dev-only auth preview (see src/routes/+layout.ts), this lets the app
    // shell be worked on without logging in. Only applies to `vite dev`.
    open: command === 'serve' ? '/dashboard' : false,
    // Same-origin proxy for local dev. The web client uses relative
    // URLs (`/api/...`, `/ws`) in production behind nginx; we mirror
    // that behaviour here so the bundle never embeds a hardcoded host.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://127.0.0.1:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
  optimizeDeps: {
    // The transformers package ships ESM with WASM glue; pre-bundling it
    // avoids the dev server's first-request stutter on the Privacy Mode toggle.
    include: ['@huggingface/transformers'],
  },
  ssr: {
    // The transformers package is browser-side only; never let the SSR
    // bundler try to evaluate it during prerender or load functions.
    noExternal: ['lucide-svelte', 'bits-ui', 'mode-watcher'],
  },
}));
