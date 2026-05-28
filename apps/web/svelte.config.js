import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SvelteKit config — Node adapter so we can deploy on Bun later, and the
 * Vite preprocess so `<script lang="ts">` works without extra wiring.
 *
 * The `$lib` alias matches the SvelteKit default and keeps imports tidy:
 * `import { auth } from '$lib/stores/auth.svelte';`
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: false,
      envPrefix: 'PUBLIC_',
    }),
    alias: {
      $lib: 'src/lib',
    },
  },
  compilerOptions: {
    runes: true,
  },
};

export default config;
