<script lang="ts">
/**
 * Versifine logo — the wordmark only. The wordmark already opens with the
 * brand "V", so pairing it with the standalone V-mark read as two Vs; the
 * single V-mark lives on the favicon instead. Themed via `currentColor`.
 *
 * Props unchanged so every call site keeps working:
 *  - `size`     pixel height of the wordmark
 *  - `showText` kept for API compatibility (the wordmark IS the text)
 *  - `tone`     'ink' (indigo on light) or 'paper' (white on dark)
 */
import Wordmark from './Wordmark.svelte';

type Props = {
  size?: number;
  showText?: boolean;
  tone?: 'ink' | 'paper';
  class?: string;
};
let { size = 28, tone = 'ink', class: className = '' }: Props = $props();

const tint = $derived(tone === 'paper' ? 'text-white' : 'text-[hsl(var(--primary))]');
// The wordmark reads a touch larger than the old glyph height — it's the
// whole identity now, so give it presence.
const height = $derived(Math.round(size * 0.82));
</script>

<span class="inline-flex items-center {className}">
  <Wordmark class="w-auto {tint}" style={`height:${height}px`} />
</span>
