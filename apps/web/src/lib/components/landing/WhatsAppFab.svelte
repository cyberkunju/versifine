<script lang="ts">
  /**
   * Persistent floating WhatsApp entry point.
   *
   * Not the usual green circle. The mark is rendered in Versifine's OWN visual
   * language — a deep-navy ink disc with the brand's signature periwinkle/sky
   * aura blooming behind it (the same glow as the dashboard hero) — so it reads
   * as part of the product, bespoke rather than bolted on. The authentic
   * WhatsApp glyph sits in paper-white; WhatsApp green appears only as a single
   * small "live" pulse, a precise signal of an online bot. A quiet label slides
   * out on hover, and on first appearance until the visitor starts reading.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
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
    'vf-fab group fixed bottom-5 right-4 z-40 flex items-center gap-3 transition-all duration-500 sm:bottom-6 sm:right-6',
    shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
  ].join(' ')}
>
  <!-- Quiet label, slides out left of the mark -->
  <span
    class={[
      'overflow-hidden whitespace-nowrap rounded-full border border-[hsl(var(--border))] bg-white/90 px-4 py-2 text-[13px] font-medium tracking-tight text-[hsl(var(--brand-navy))] shadow-[0_8px_24px_-14px_rgba(18,26,140,0.5)] backdrop-blur-md transition-all duration-300 group-hover:max-w-[14rem] group-hover:opacity-100',
      showLabel ? 'max-w-[14rem] opacity-100' : 'max-w-0 border-transparent px-0 opacity-0',
    ].join(' ')}
  >
    Message the bot
  </span>

  <!-- The mark: a navy ink disc carrying the brand's periwinkle aura -->
  <span class="vf-fab-disc relative grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-[hsl(var(--brand-navy-deep))] text-white shadow-[0_16px_40px_-12px_hsl(var(--brand-navy)/0.75)] ring-1 ring-white/10 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_22px_50px_-12px_hsl(var(--brand-navy)/0.85)]">
    <!-- periwinkle bloom, top-right -->
    <span
      aria-hidden="true"
      class="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full transition-transform duration-500 group-hover:scale-125"
      style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.85), transparent 70%); filter:blur(8px);"
    ></span>
    <!-- sky bloom, bottom-left -->
    <span
      aria-hidden="true"
      class="pointer-events-none absolute -bottom-6 -left-5 h-16 w-16 rounded-full"
      style="background:radial-gradient(closest-side, hsl(202 80% 56% / 0.55), transparent 70%); filter:blur(10px);"
    ></span>

    <WhatsAppGlyph class="relative h-[26px] w-[26px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]" />

    <!-- the single green note: a small live pulse -->
    <span class="absolute right-2.5 top-2.5 flex h-2 w-2">
      <span class="vf-fab-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75"></span>
      <span class="relative inline-flex h-2 w-2 rounded-full bg-[#25D366] ring-2 ring-[hsl(var(--brand-navy-deep))]"></span>
    </span>
  </span>
</a>

<style>
  .vf-fab-ping {
    animation: vf-fab-pulse 2.6s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  @keyframes vf-fab-pulse {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    70%,
    100% {
      transform: scale(2.4);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .vf-fab-ping {
      animation: none;
    }
  }
</style>
