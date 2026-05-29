<script lang="ts">
  /**
   * Landing header — light, editorial. A hairline rule appears under the
   * bar once the page scrolls; the paper ground gets a faint blur so
   * content reads underneath without muddying the type.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { Menu, X } from 'lucide-svelte';
  import Logo from '$lib/components/brand/Logo.svelte';

  let scrolled = $state(false);
  let mobileOpen = $state(false);

  const links = [
    { href: '#capabilities', label: 'Capabilities' },
    { href: '#whatsapp', label: 'WhatsApp' },
    { href: '#copilot', label: 'Copilot' },
    { href: '#languages', label: 'Languages' },
    { href: '#faq', label: 'FAQ' },
  ];

  function onScroll() {
    scrolled = window.scrollY > 8;
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
  class={[
    'fixed inset-x-0 top-0 z-40 transition-all duration-300',
    scrolled ? 'border-b border-[hsl(var(--border))] bg-[hsl(var(--brand-paper)/0.82)] backdrop-blur-md' : 'border-b border-transparent',
  ].join(' ')}
>
  <div class="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
    <a href="/" class="transition-opacity hover:opacity-80" aria-label="Versifine home">
      <Logo size={30} />
    </a>

    <nav class="hidden items-center gap-8 lg:flex" aria-label="Primary">
      {#each links as link (link.href)}
        <a
          href={link.href}
          class="group relative text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--brand-navy))]"
        >
          {link.label}
          <span class="absolute -bottom-1.5 left-0 h-px w-0 bg-[hsl(var(--brand-gold))] transition-all duration-300 group-hover:w-full"></span>
        </a>
      {/each}
    </nav>

    <div class="hidden items-center gap-5 lg:flex">
      <a
        href="/login"
        class="text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--brand-navy))]"
      >
        Log in
      </a>
      <a
        href="/register"
        class="group inline-flex items-center gap-2 rounded-full bg-[hsl(var(--brand-navy))] px-5 py-2.5 text-sm font-medium text-[hsl(var(--brand-paper))] shadow-sm transition-all hover:bg-[hsl(var(--brand-navy-deep))]"
      >
        Get started
        <span class="text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5">→</span>
      </a>
    </div>

    <button
      type="button"
      class="rounded-md p-2 text-[hsl(var(--brand-navy))] transition-colors hover:bg-[hsl(var(--accent))] lg:hidden"
      onclick={() => (mobileOpen = !mobileOpen)}
      aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={mobileOpen}
    >
      {#if mobileOpen}<X class="h-5 w-5" />{:else}<Menu class="h-5 w-5" />{/if}
    </button>
  </div>

  {#if mobileOpen}
    <div class="border-t border-[hsl(var(--border))] bg-[hsl(var(--brand-paper))] px-5 py-4 lg:hidden">
      <nav class="flex flex-col" aria-label="Mobile">
        {#each links as link (link.href)}
          <a
            href={link.href}
            onclick={close}
            class="border-b border-[hsl(var(--border))] py-3 text-sm font-medium text-[hsl(var(--foreground))] last:border-0"
          >
            {link.label}
          </a>
        {/each}
        <div class="mt-4 flex flex-col gap-2">
          <a href="/login" onclick={close} class="rounded-full border border-[hsl(var(--border))] px-5 py-2.5 text-center text-sm font-medium text-[hsl(var(--brand-navy))]">
            Log in
          </a>
          <a href="/register" onclick={close} class="rounded-full bg-[hsl(var(--brand-navy))] px-5 py-2.5 text-center text-sm font-medium text-[hsl(var(--brand-paper))]">
            Get started
          </a>
        </div>
      </nav>
    </div>
  {/if}
</header>
