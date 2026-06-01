<script lang="ts">
  /**
   * Primary navigation — navy workspace rail.
   *
   * A deep-indigo sidebar that blends into the navy app ground, so the white
   * content panel reads as a framed sheet set into one continuous brand
   * surface. Workspace switcher up top, grouped nav, utility links, and a
   * profile block at the foot. Collapses to a slide-in drawer on mobile via
   * the `mobileOpen` prop from the topbar's hamburger.
   */
  import { page } from '$app/stores';
  import {
    LayoutDashboard, Receipt, Wallet, Target, LineChart, BarChart3,
    Settings as SettingsIcon, LogOut, ChevronsUpDown, BookOpen, MessageSquare,
  } from 'lucide-svelte';
  import Wordmark from '$lib/components/brand/Wordmark.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { panels } from '$lib/stores/panels.svelte';
  import { getMessages } from '$lib/i18n';
  import { cn } from '$lib/utils/cn';

  type Props = {
    mobileOpen: boolean;
    onClose?: () => void;
  };
  let { mobileOpen, onClose }: Props = $props();

  const m = $derived(getMessages(settings.language));

  const groups = $derived([
    { label: '', items: [{ href: '/dashboard', label: m.nav.dashboard, icon: LayoutDashboard }] },
    {
      label: 'Money',
      items: [
        { href: '/transactions', label: m.nav.transactions, icon: Receipt },
        { href: '/budgets', label: m.nav.budgets, icon: Wallet },
        { href: '/goals', label: m.nav.goals, icon: Target },
      ],
    },
    {
      label: 'Planning',
      items: [
        { href: '/forecast', label: m.nav.forecast, icon: LineChart },
        { href: '/reports', label: m.nav.reports, icon: BarChart3 },
      ],
    },
  ]);

  const path = $derived($page.url.pathname);
  function isActive(href: string): boolean {
    if (href === '/dashboard') return path === '/dashboard';
    return path === href || path.startsWith(`${href}/`);
  }

  const displayName = $derived(auth.user?.displayName ?? '');
  const email = $derived(auth.user?.email ?? '');
  const initials = $derived(
    (displayName || email || '?')
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?',
  );

  async function handleLogout() {
    await auth.logout();
  }
</script>

<!-- Backdrop on mobile -->
{#if mobileOpen}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-[hsl(var(--brand-navy-deep)/0.5)] backdrop-blur-sm lg:hidden"
    aria-label="Close menu"
    onclick={() => onClose?.()}
  ></button>
{/if}

<aside
  class={cn(
    'fixed inset-y-0 left-0 z-50 flex w-[16.5rem] flex-col bg-[hsl(var(--brand-navy-deep))] text-[hsl(var(--brand-paper))] transition-transform lg:static lg:translate-x-0',
    mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
  )}
  aria-label="Primary"
>
  <!-- Brand -->
  <a href="/dashboard" class="flex items-center px-5 pb-4 pt-5" onclick={() => onClose?.()}>
    <Wordmark class="h-6 w-auto text-white" />
  </a>

  <!-- Workspace switcher pill -->
  <div class="px-3">
    <button
      type="button"
      class="group flex w-full items-center gap-2.5 rounded-xl border border-white/12 bg-white/5 px-2.5 py-2 text-left transition-colors hover:border-white/25 hover:bg-white/10"
    >
      <span class="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10 text-xs font-bold text-white ring-1 ring-white/15">
        <span aria-hidden="true" class="pointer-events-none absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full" style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.95), transparent 70%); filter:blur(3px);"></span>
        <span class="relative">V</span>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-white">Finances</span>
        <span class="block truncate text-[11px] text-white/55">Personal workspace</span>
      </span>
      <ChevronsUpDown class="h-4 w-4 shrink-0 text-white/55" />
    </button>
  </div>

  <!-- Grouped navigation -->
  <nav class="mt-4 flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 scrollbar-none">
    {#each groups as group (group.label || 'top')}
      <div>
        {#if group.label}
          <p class="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
            {group.label}
          </p>
        {/if}
        <div class="flex flex-col gap-0.5">
          {#each group.items as item (item.href)}
            {@const Icon = item.icon}
            {@const active = isActive(item.href)}
            <a
              href={item.href}
              onclick={() => onClose?.()}
              class={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-white/12 font-semibold text-white'
                  : 'font-medium text-white/65 hover:bg-white/[0.07] hover:text-white',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <span
                aria-hidden="true"
                class={cn('absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--brand-gold))] transition-opacity', active ? 'opacity-100' : 'opacity-0')}
              ></span>
              <Icon class={cn('h-[18px] w-[18px] shrink-0', active ? 'text-[hsl(var(--brand-gold))]' : 'text-white/55 group-hover:text-white')} />
              <span>{item.label}</span>
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </nav>

  <!-- Utility links -->
  <div class="flex flex-col gap-0.5 px-3 pb-2">
    <button
      type="button"
      onclick={() => { panels.openCopilot(); onClose?.(); }}
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      <MessageSquare class="h-[18px] w-[18px] shrink-0 text-white/55" />
      <span>{m.nav.askCopilot}</span>
    </button>
    <a
      href="/settings"
      onclick={() => onClose?.()}
      class={cn(
        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        isActive('/settings')
          ? 'bg-white/12 font-semibold text-white'
          : 'font-medium text-white/65 hover:bg-white/[0.07] hover:text-white',
      )}
      aria-current={isActive('/settings') ? 'page' : undefined}
    >
      <span
        aria-hidden="true"
        class={cn('absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--brand-gold))] transition-opacity', isActive('/settings') ? 'opacity-100' : 'opacity-0')}
      ></span>
      <SettingsIcon class={cn('h-[18px] w-[18px] shrink-0', isActive('/settings') ? 'text-[hsl(var(--brand-gold))]' : 'text-white/55')} />
      <span>{m.nav.settings}</span>
    </a>
    <a
      href="https://github.com/cyberkunju/versifine"
      target="_blank"
      rel="noopener"
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      <BookOpen class="h-[18px] w-[18px] shrink-0 text-white/55" />
      <span>Documentation</span>
    </a>
  </div>

  <!-- Profile block -->
  <div class="border-t border-white/10 p-3">
    <div class="flex items-center gap-3 rounded-xl px-2 py-1.5">
      <span class="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-xs font-semibold text-white ring-1 ring-white/15">
        <span aria-hidden="true" class="pointer-events-none absolute -right-2 -top-2 h-7 w-7 rounded-full" style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.95), transparent 70%); filter:blur(4px);"></span>
        <span class="relative">{initials}</span>
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-white">{displayName || 'Your account'}</p>
        <p class="truncate text-xs text-white/55">{email}</p>
      </div>
      <button
        type="button"
        onclick={handleLogout}
        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={m.nav.signOut}
        title={m.nav.signOut}
      >
        <LogOut class="h-4 w-4" />
      </button>
    </div>
  </div>
</aside>
