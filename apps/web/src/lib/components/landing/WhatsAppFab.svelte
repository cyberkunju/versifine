<script lang="ts">
  /**
   * Persistent floating WhatsApp button.
   *
   * Always-on entry point to the demo bot, bottom-right. Appears after a
   * little scroll so it doesn't fight the hero, and carries a one-time
   * "Try the WhatsApp demo" label that collapses to just the icon. Opens the
   * wa.me deep link with the demo phrase pre-filled.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { MessageCircle } from 'lucide-svelte';
  import { WA_DEMO_LINK } from '$lib/whatsapp';
  import { waInvite } from '$lib/stores/waInvite.svelte';

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
  aria-label="Try the Versifine demo on WhatsApp"
  class={[
    'group fixed bottom-5 right-4 z-40 inline-flex items-center gap-2.5 rounded-full bg-[#25D366] py-3 pl-3.5 pr-4 text-white shadow-[0_12px_30px_-8px_rgba(37,211,102,0.6)] transition-all duration-500 hover:bg-[#1ebe5d] hover:shadow-[0_16px_36px_-8px_rgba(37,211,102,0.7)] sm:bottom-6 sm:right-6',
    shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
  ].join(' ')}
>
  <span class="relative grid h-7 w-7 place-items-center">
    <span class="absolute inset-0 animate-ping rounded-full bg-white/40 [animation-duration:2.4s]"></span>
    <MessageCircle class="relative h-6 w-6" />
  </span>
  <span
    class={[
      'overflow-hidden whitespace-nowrap text-sm font-semibold transition-all duration-300',
      showLabel ? 'max-w-[12rem] opacity-100' : 'max-w-0 opacity-0',
    ].join(' ')}
  >
    Try the WhatsApp demo
  </span>
</a>
