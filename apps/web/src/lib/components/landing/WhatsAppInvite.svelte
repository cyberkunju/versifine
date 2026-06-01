<script lang="ts">
  /**
   * First-visit WhatsApp demo invite.
   *
   * Re-skinned for the editorial fintech theme. Rather than a generic green
   * toast, it arrives as a quiet "incoming invite" card in the brand's
   * navy/paper language: a navy header strip echoing the demo chat, a small
   * authentic WhatsApp tile, a one-line preview bubble, and a single
   * green-gradient action that matches the tile so the green reads as a
   * deliberate accent. Slides up once on the first visit (localStorage),
   * with a graceful no-op when storage is unavailable.
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { X, ArrowUpRight } from 'lucide-svelte';
  import { WA_DEMO_LINK } from '$lib/whatsapp';
  import { waInvite } from '$lib/stores/waInvite.svelte';
  import WhatsAppGlyph from './WhatsAppGlyph.svelte';

  const STORAGE_KEY = 'vf_wa_invite_seen';
  const SHOW_DELAY_MS = 2600;

  let visible = $state(false);
  let closing = $state(false);

  // Keep the shared flag in sync so the FAB hides while we're on screen.
  $effect(() => {
    waInvite.open = visible;
  });

  function dismiss() {
    closing = true;
    // Let the exit transition play before unmounting.
    setTimeout(() => {
      visible = false;
      closing = false;
    }, 280);
    markSeen();
  }

  function markSeen() {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage blocked (private mode / cookies off) — fine, just won't persist.
    }
  }

  function openWhatsApp() {
    markSeen();
    // Let the anchor's native navigation happen; just hide the popup.
    visible = false;
  }

  onMount(() => {
    if (!browser) return;
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen) return;
    const t = setTimeout(() => {
      visible = true;
    }, SHOW_DELAY_MS);
    return () => clearTimeout(t);
  });
</script>

{#if visible}
  <div
    class={[
      'fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-[21rem] sm:left-auto sm:right-6 sm:bottom-6',
      closing ? 'vf-invite-out' : 'vf-invite-in',
    ].join(' ')}
    role="dialog"
    aria-label="Try Versifine on WhatsApp"
  >
    <div class="relative overflow-hidden rounded-[1.25rem] border border-[hsl(var(--border))] bg-white shadow-[0_30px_60px_-24px_rgba(18,26,140,0.45)] ring-1 ring-black/[0.03]">
      <!-- Navy header strip — echoes the demo chat header -->
      <div class="flex items-center gap-3 bg-[hsl(var(--brand-navy))] px-4 py-3 text-[hsl(var(--brand-paper))]">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25D366] text-white">
          <WhatsAppGlyph class="h-[18px] w-[18px]" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-tight">Versifine</p>
          <p class="flex items-center gap-1.5 text-[11px] leading-tight text-[hsl(var(--brand-paper)/0.72)]">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-[#3ee07f]"></span>
            online on WhatsApp
          </p>
        </div>
        <span class="text-[9px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--brand-gold))]">encrypted</span>
        <button
          type="button"
          onclick={dismiss}
          class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[hsl(var(--brand-paper)/0.7)] transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Dismiss"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="p-5">
        <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">No sign-up</p>
        <p class="mt-2 font-display text-[17px] font-medium leading-snug tracking-tight text-[hsl(var(--brand-navy))]">
          Log your first expense in one message.
        </p>

        <!-- One-line preview bubble, hinting at the conversation -->
        <div class="mt-3.5 w-fit max-w-full rounded-2xl rounded-tl-sm bg-[hsl(var(--brand-ivory))] px-3.5 py-2 text-[13px] leading-snug text-[hsl(var(--foreground))] ring-1 ring-[hsl(var(--border))]">
          Send a sentence, a voice note, or a photo of a bill — in your language.
        </div>

        <a
          href={WA_DEMO_LINK}
          target="_blank"
          rel="noopener"
          onclick={openWhatsApp}
          class="group mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2.5 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(37,168,85,0.85)] transition-all hover:-translate-y-0.5 hover:bg-[#20bd5a] hover:shadow-[0_16px_34px_-12px_rgba(37,168,85,0.95)]"
        >
          <WhatsAppGlyph class="h-[18px] w-[18px]" />
          Start chatting
          <ArrowUpRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
        <button
          type="button"
          onclick={dismiss}
          class="mt-2 w-full text-center text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--brand-navy))]"
        >
          Maybe later
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .vf-invite-in {
    animation: vf-invite-up 0.46s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .vf-invite-out {
    animation: vf-invite-down 0.28s ease-in both;
  }
  @keyframes vf-invite-up {
    from {
      opacity: 0;
      transform: translateY(28px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @keyframes vf-invite-down {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(20px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .vf-invite-in,
    .vf-invite-out {
      animation: none;
    }
  }
</style>
