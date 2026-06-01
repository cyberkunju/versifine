<script lang="ts">
  /**
   * Persistent floating WhatsApp button.
   *
   * Deliberately minimal: a single circular button in WhatsApp's own green
   * carrying the authentic logo — nothing else. No card, no badge, no pulsing
   * ring. A quiet text label slides out on hover (and on first appearance,
   * until the visitor starts reading) so the resting state is just the mark.
   * Eases in after first paint.
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
    'group fixed bottom-5 right-4 z-40 flex items-center gap-3 transition-all duration-500 sm:bottom-6 sm:right-6',
    shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
  ].join(' ')}
>
  <!-- Quiet label, slides out left of the mark -->
  <span
    class={[
      'overflow-hidden whitespace-nowrap rounded-full border border-[hsl(var(--border))] bg-white/90 px-3.5 py-2 text-[13px] font-medium text-[hsl(var(--brand-navy))] shadow-[0_8px_24px_-14px_rgba(18,26,140,0.5)] backdrop-blur-md transition-all duration-300 group-hover:max-w-[14rem] group-hover:opacity-100',
      showLabel ? 'max-w-[14rem] opacity-100' : 'max-w-0 border-transparent px-0 opacity-0',
    ].join(' ')}
  >
    Chat on WhatsApp
  </span>

  <!-- The mark itself: just the logo, nothing around it -->
  <span class="grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-[0_12px_30px_-8px_rgba(37,168,85,0.6)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:bg-[#20bd5a] group-hover:shadow-[0_18px_40px_-10px_rgba(37,168,85,0.7)]">
    <WhatsAppGlyph class="h-7 w-7" />
  </span>
</a>
