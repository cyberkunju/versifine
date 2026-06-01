<script lang="ts">
  /**
   * Persistent floating WhatsApp entry point.
   *
   * Re-skinned for the editorial fintech theme: a paper pill with a hairline
   * border and navy-tinted shadow (the same card language used across the
   * site), carrying a small authentic WhatsApp "app tile" so the green stays
   * a precise accent rather than the whole button. Eases in after first paint,
   * collapses to just the tile once the visitor starts reading, and breathes
   * quietly instead of pinging.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ArrowUpRight } from 'lucide-svelte';
  import { WA_DEMO_LINK } from '$lib/whatsapp';
  import { waInvite } from '$lib/stores/waInvite.svelte';
  import WhatsAppGlyph from './WhatsAppGlyph.svelte';

  let mounted = $state(false);
  let showLabel = $state(true);

  // Visible once eased in AND the first-visit invite popup isn't showing
  // (they'd otherwise overlap bottom-right).
  const shown = $derived(mounted && !waInvite.open);

  function onScroll() {
    // Collapse the text label once the user starts reading.
    if (window.scrollY > 600) showLabel = false;
  }

  onMount(() => {
    if (!browser) return;
    // Slight delay so it eases in after first paint.
    const t = setTimeout(() => {
      mounted = true;
    }, 900);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => clearTimeout(t);
  });
  onDestroy(() => {
    if (browser) window.removeEventListener('scroll', onScroll);
  });
</script>

<a
  href={WA_DEMO_LINK}
  target="_blank"
  rel="noopener"
  aria-label="Chat with the Versifine demo on WhatsApp"
  class={[
    'vf-fab group fixed bottom-5 right-4 z-40 inline-flex items-center gap-3 rounded-full border border-[hsl(var(--border))] bg-white/90 py-2 pl-2 pr-3.5 shadow-[0_16px_40px_-16px_rgba(18,26,140,0.45)] ring-1 ring-black/[0.02] backdrop-blur-md transition-all duration-500 hover:-translate-y-0.5 hover:border-[hsl(var(--brand-navy)/0.18)] hover:shadow-[0_22px_50px_-16px_rgba(18,26,140,0.55)] sm:bottom-6 sm:right-6',
    shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
  ].join(' ')}
>
  <!-- WhatsApp app tile: the only green, a precise accent -->
  <span class="vf-fab-tile relative grid h-10 w-10 shrink-0 place-items-center rounded-[0.85rem] bg-gradient-to-br from-[#25D366] to-[#12a84e] text-white shadow-[0_6px_16px_-6px_rgba(18,168,78,0.8)]">
    <WhatsAppGlyph class="h-[22px] w-[22px]" />
    <!-- online cue -->
    <span class="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#25D366]"></span>
  </span>

  <span
    class={[
      'flex items-center gap-2 overflow-hidden whitespace-nowrap transition-all duration-300',
      showLabel ? 'max-w-[14rem] opacity-100' : 'max-w-0 opacity-0',
    ].join(' ')}
  >
    <span class="flex flex-col leading-tight">
      <span class="text-[13px] font-semibold tracking-tight text-[hsl(var(--brand-navy))]">Chat with the bot</span>
      <span class="text-[11px] text-[hsl(var(--muted-foreground))]">on WhatsApp · live now</span>
    </span>
    <ArrowUpRight class="h-4 w-4 text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
  </span>
</a>

<style>
  /* A slow, quiet breathing presence on the tile — premium, not a beacon. */
  .vf-fab-tile::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.45);
    animation: vf-fab-breathe 3.4s ease-out infinite;
  }
  @keyframes vf-fab-breathe {
    0% {
      box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.42);
    }
    70%,
    100% {
      box-shadow: 0 0 0 12px rgba(37, 211, 102, 0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .vf-fab-tile::after {
      animation: none;
    }
  }
</style>
