<script lang="ts">
  /**
   * Primary navigation. Collapses to a slide-in drawer on mobile via the
   * `mobileOpen` prop driven by the topbar's hamburger button.
   */
  import { page } from '$app/stores';
  import {
    LayoutDashboard,
    Receipt,
    Wallet,
    Target,
    LineChart,
    BarChart3,
    Settings as SettingsIcon,
    LogOut,
  } from 'lucide-svelte';
  import Logo from '$lib/components/brand/Logo.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { cn } from '$lib/utils/cn';

  type Props = {
    mobileOpen: boolean;
    onClose?: () => void;
  };
  let { mobileOpen, onClose }: Props = $props();

  const m = $derived(getMessages(settings.language));

  const items = $derived([
    { href: '/dashboard', label: m.nav.dashboard, icon: LayoutDashboard },
    { href: '/transactions', label: m.nav.transactions, icon: Receipt },
    { href: '/budgets', label: m.nav.budgets, icon: Wallet },
    { href: '/goals', label: m.nav.goals, icon: Target },
    { href: '/forecast', label: m.nav.forecast, icon: LineChart },
    { href: '/reports', label: m.nav.reports, icon: BarChart3 },
    { href: '/settings', label: m.nav.settings, icon: SettingsIcon },
  ]);

  const path = $derived($page.url.pathname);
  function isActive(href: string): boolean {
    if (href === '/dashboard') return path === '/dashboard';
    return path === href || path.startsWith(`${href}/`);
  }

  async function handleLogout() {
    await auth.logout();
  }
</script>

<!-- Backdrop on mobile -->
{#if mobileOpen}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-black/40 lg:hidden"
    aria-label="Close menu"
    onclick={() => onClose?.()}
  ></button>
{/if}

<aside
  class={cn(
    'fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] p-4 transition-transform lg:static lg:translate-x-0',
    mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
  )}
  aria-label="Primary"
>
  <a href="/dashboard" class="flex items-center gap-2 px-2 pb-4">
    <Logo size={28} />
  </a>

  <nav class="flex flex-1 flex-col gap-0.5">
    {#each items as item (item.href)}
      {@const Icon = item.icon}
      <a
        href={item.href}
        onclick={() => onClose?.()}
        class={cn(
          'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive(item.href)
            ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
            : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent)/0.6)] hover:text-[hsl(var(--accent-foreground))]',
        )}
        aria-current={isActive(item.href) ? 'page' : undefined}
      >
        <Icon class="h-4 w-4" />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="mt-auto border-t border-[hsl(var(--border))] pt-3">
    <div class="px-3 pb-2 text-xs text-[hsl(var(--muted-foreground))]">
      {auth.user?.displayName ?? auth.user?.email ?? ''}
    </div>
    <button
      type="button"
      onclick={handleLogout}
      class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent)/0.6)] hover:text-[hsl(var(--accent-foreground))]"
    >
      <LogOut class="h-4 w-4" />
      <span>{m.nav.signOut}</span>
    </button>
  </div>
</aside>
