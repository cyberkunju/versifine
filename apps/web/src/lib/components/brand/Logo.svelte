<script lang="ts">
  /**
   * Versifine wordmark lockup. A small navy/gold "V" rising-line glyph
   * beside the Fraunces wordmark. Used in the landing header/footer and
   * the app sidebar so the brand reads identically everywhere.
   */
  type Props = {
    /** Pixel size of the glyph square. */
    size?: number;
    /** Whether to show the wordmark text beside the glyph. */
    showText?: boolean;
    /** 'ink' (navy on light) or 'paper' (paper on dark surfaces). */
    tone?: 'ink' | 'paper';
    class?: string;
  };
  let { size = 28, showText = true, tone = 'ink', class: className = '' }: Props = $props();

  const text = $derived(tone === 'paper' ? 'text-[hsl(var(--brand-paper))]' : 'text-[hsl(var(--brand-navy))]');
</script>

<span class="inline-flex items-center gap-2.5 {className}">
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    class="shrink-0"
  >
    <rect
      width="32"
      height="32"
      rx="7"
      fill={tone === 'paper' ? '#FAF7F1' : '#001F77'}
    />
    <path
      d="M7 9 L13.5 23 L16 17"
      stroke={tone === 'paper' ? '#001F77' : '#FAF7F1'}
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M16 17 L20 8.5 L25 20"
      stroke="#C99A3F"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="25" cy="20" r="1.7" fill="#C99A3F" />
  </svg>
  {#if showText}
    <span class="font-display text-[1.35rem] font-medium leading-none tracking-tight {text}">
      Versifine
    </span>
  {/if}
</span>
