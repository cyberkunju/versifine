<script lang="ts">
  /**
   * First-visit WhatsApp demo invite.
   *
   * A small, dismissible popup that slides up after a short delay on the
   * visitor's first landing-page view. Clicking through opens the wa.me deep
   * link with the demo phrase pre-filled; the bot grants demo access the
   * moment that phrase arrives. Shown once per browser (localStorage), with a
   * graceful no-op when storage is unavailable.
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { MessageCircle, X } from 'lucide-svelte';
  import { WA_DEMO_LINK } from '$lib/whatsapp';
  import { waInvite } from '$lib/stores/waInvite.svelte';

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
    }, 260);
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
      'fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm sm:left-auto sm:right-6 sm:bottom-6',
      closing ? 'vf-invite-out' : 'vf-invite-in',
    ].join(' ')}
    role="dialog"
    aria-label="Try Versifine on WhatsApp"
  >
    <div class="relative overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-[0_20px_50px_-20px_rgba(18,26,140,0.45)]">
      <!-- Accent bar -->
      <div class="absolute inset-x-0 top-0 h-1 bg-[#25D366]"></div>

      <button
        type="button"
        onclick={dismiss}
        class="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--brand-navy))]"
        aria-label="Dismiss"
      >
        <X class="h-4 w-4" />
      </button>

      <div class="flex items-start gap-3.5 p-5 pt-6">
        <span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#25D366]/12 text-[#1ebe5d]">
          <MessageCircle class="h-6 w-6" />
        </span>
        <div class="min-w-0 pr-4">
          <p class="font-display text-base font-medium text-[hsl(var(--brand-navy))]">
            Try Versifine on WhatsApp
          </p>
          <p class="mt-1 text-[13px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            No sign-up. Send one message and start logging expenses by text, voice,
            or a photo of a bill — in your language.
          </p>

          <a
            href={WA_DEMO_LINK}
            target="_blank"
            rel="noopener"
            onclick={openWhatsApp}
            class="group mt-3.5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#1ebe5d]"
          >
            <MessageCircle class="h-4 w-4" />
            Chat with the bot
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
  </div>
{/if}

<style>
  .vf-invite-in {
    animation: vf-invite-up 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .vf-invite-out {
    animation: vf-invite-down 0.26s ease-in both;
  }
  @keyframes vf-invite-up {
    from {
      opacity: 0;
      transform: translateY(28px) scale(0.98);
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
