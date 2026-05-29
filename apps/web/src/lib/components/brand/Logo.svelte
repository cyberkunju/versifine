<script lang="ts">
  /**
   * Versifine logo lockup — the real brand marks. A solid V-mark glyph
   * beside the inline wordmark, themed via `currentColor`. Used in the
   * landing header/footer, the app sidebar, and the register rail so the
   * brand reads identically everywhere.
   *
   * Props are unchanged from the previous lockup so every call site keeps
   * working:
   *  - `size`     pixel height of the glyph square
   *  - `showText` show the wordmark beside the glyph
   *  - `tone`     'ink' (indigo on light) or 'paper' (white on dark)
   */
  import VMark from './VMark.svelte';
  import Wordmark from './Wordmark.svelte';

  type Props = {
    size?: number;
    showText?: boolean;
    tone?: 'ink' | 'paper';
    class?: string;
  };
  let { size = 28, showText = true, tone = 'ink', class: className = '' }: Props = $props();

  // On light surfaces the glyph carries the brand gradient; on dark
  // surfaces it goes solid white so it reads cleanly. The wordmark follows
  // the tone via currentColor.
  const tint = $derived(tone === 'paper' ? 'text-white' : 'text-[hsl(var(--primary))]');
</script>

<span class="inline-flex items-center gap-2.5 {className}">
  {#if tone === 'paper'}
    <VMark tight variant="solid" class="shrink-0 {tint}" style={`height:${size}px;width:auto`} />
  {:else}
    <VMark tight variant="brand" class="shrink-0" style={`height:${size}px;width:auto`} />
  {/if}
  {#if showText}
    <Wordmark class="w-auto {tint}" style={`height:${size * 0.62}px`} />
  {/if}
</span>
