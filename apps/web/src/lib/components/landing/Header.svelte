<script lang="ts">
  /**
   * Landing-page header. Sticky, glass-blurred, links to anchors and the
   * auth pages. Becomes elevated (visible border + denser blur) once
   * the page scrolls past the hero fold.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { Sparkles, Menu, X } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
  import { cn } from '$lib/utils/cn';

  let scrolled = $state(false);
  let mobileOpen = $state(false);

  const links = [
    { href: '#features', label: 'Features' },
    { href: '#whatsapp', label: 'WhatsApp' },
    { href: '#copilot', label: 'AI Copilot' },
    { href: '#privacy', label: 'Privacy' },
    { href: '#faq', label: 'FAQ' },
  ];

  function onScroll() {
    scrolled = window.scrollY > 16;
  }

  onMount(() => {
    if (!browser) return;
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  });
  onDestroy(() => {
    if (browser) window.removeEventListener('scroll', onScroll);
  });

  function close() {
    mobileOpen = false;
  }
</script>

<header
  class={cn(
    'fixed inset-x-0 top-0 z-40 transition-[backdrop-filter,background-color,border-color] duration-300',
    scrolled
      ? 'border-b border-white/10 bg-slate-950/70 backdrop-blur-xl'
      : 'border-b border-transparent bg-transparent backdrop-blur-0',
  )}
>
  <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
    <a href="/" class="flex items-center gap-2 text-base font-semibold tracking-tight text-white">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20">
        <Sparkles class="h-4 w-4 text-white" />
      </span>
      <span>Versifine</span>
    </a>

    <nav class="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {#each links as link (link.href)}
        <a
          href={link.href}
          class="rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
        >
          {link.label}
        </a>
      {/each}
    </nav>

    <div class="hidden items-center gap-2 lg:flex">
      <a
        href="/login"
        class="rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
      >
        Log in
      </a>
      <Button
        href="/register"
        class="bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/20 hover:opacity-90"
      >
        Get started
      </Button>
    </div>

    <button
      type="button"
      class="rounded-md p-2 text-slate-300 transition-colors hover:bg-white/5 hover:text-white lg:hidden"
      onclick={() => (mobileOpen = !mobileOpen)}
      aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={mobileOpen}
    >
      {#if mobileOpen}
        <X class="h-5 w-5" />
      {:else}
        <Menu class="h-5 w-5" />
      {/if}
    </button>
  </div>

  {#if mobileOpen}
    <div class="border-t border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur-xl lg:hidden">
      <nav class="flex flex-col gap-1" aria-label="Mobile">
        {#each links as link (link.href)}
          <a
            href={link.href}
            onclick={close}
            class="rounded-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
          >
            {link.label}
          </a>
        {/each}
        <div class="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
          <a
            href="/login"
            onclick={close}
            class="rounded-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
          >
            Log in
          </a>
          <a
            href="/register"
            onclick={close}
            class="rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 px-3 py-2 text-center text-sm font-medium text-white"
          >
            Get started
          </a>
        </div>
      </nav>
    </div>
  {/if}
</header>
