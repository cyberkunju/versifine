<script lang="ts">
  /**
   * Primary navigation — editorial fintech shell.
   *
   * Grouped into labelled sections (Overview / Money / Planning) so the
   * product's surface reads as an organised workspace rather than a flat
   * list. The active item is marked with a soft indigo wash and a periwinkle
   * accent rail; a profile block with an ink-gradient avatar anchors the
   * foot. Collapses to a slide-in drawer on mobile via the `mobileOpen`
   * prop driven by the topbar's hamburger.
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

  // Nav grouped into labelled sections — the structural cue that lifts the
  // shell from "list" to "workspace".
  const groups = $derived([
    {
      label: 'Overview',
      items: [{ href: '/dashboard', label: m.nav.dashboard, icon: LayoutDashboard }],
    },
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
    class="fixed inset-0 z-40 bg-[hsl(var(--brand-navy-deep)/0.45)] backdrop-blur-sm lg:hidden"
    aria-label="Close menu"
    onclick={() => onClose?.()}
  ></button>
{/if}

<aside
  class={cn(
    'fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] transition-transform lg:static lg:translate-x-0',
    mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
  )}
  aria-label="Primary"
>
  <!-- Brand -->
  <a href="/dashboard" class="flex items-center gap-2 px-6 pb-5 pt-6" onclick={() => onClose?.()}>
    <Logo size={28} />
  </a>

  <!-- Grouped navigation -->
  <nav class="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4 scrollbar-none">
    {#each groups as group (group.label)}
      <div>
        {#if group.label}
          <p class="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground)/0.8)]">
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
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-[hsl(var(--primary)/0.07)] text-[hsl(var(--primary))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <!-- periwinkle accent rail on the active item -->
              <span
                aria-hidden="true"
                class={cn(
                  'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--brand-gold))] transition-all duration-300',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              ></span>
              <Icon
                class={cn(
                  'h-[18px] w-[18px] shrink-0 transition-colors',
                  active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))]',
                )}
              />
              <span>{item.label}</span>
            </a>
          {/each}
        </div>
      </div>
    {/each}

    <!-- Settings, set apart at the foot of the nav -->
    <div class="mt-auto flex flex-col gap-0.5 border-t border-[hsl(var(--border))] pt-4">
      <a
        href="/settings"
        onclick={() => onClose?.()}
        class={cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          isActive('/settings')
            ? 'bg-[hsl(var(--primary)/0.07)] text-[hsl(var(--primary))]'
            : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]',
        )}
        aria-current={isActive('/settings') ? 'page' : undefined}
      >
        <span
          aria-hidden="true"
          class={cn(
            'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--brand-gold))] transition-all duration-300',
            isActive('/settings') ? 'opacity-100' : 'opacity-0',
          )}
        ></span>
        <SettingsIcon class="h-[18px] w-[18px] shrink-0" />
        <span>{m.nav.settings}</span>
      </a>
    </div>
  </nav>

  <!-- Profile block -->
  <div class="border-t border-[hsl(var(--border))] p-3">
    <div class="flex items-center gap-3 rounded-xl px-2 py-2">
      <span
        class="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[hsl(var(--brand-navy-deep))] text-xs font-semibold text-white shadow-[0_6px_16px_-8px_hsl(var(--brand-navy)/0.8)]"
      >
        <span
          aria-hidden="true"
          class="pointer-events-none absolute -right-2 -top-2 h-7 w-7 rounded-full"
          style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.85), transparent 70%); filter:blur(4px);"
        ></span>
        <span class="relative">{initials}</span>
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-[hsl(var(--foreground))]">{displayName || 'Your account'}</p>
        <p class="truncate text-xs text-[hsl(var(--muted-foreground))]">{email}</p>
      </div>
      <button
        type="button"
        onclick={handleLogout}
        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--destructive))]"
        aria-label={m.nav.signOut}
        title={m.nav.signOut}
      >
        <LogOut class="h-4 w-4" />
      </button>
    </div>
  </div>
</aside>
