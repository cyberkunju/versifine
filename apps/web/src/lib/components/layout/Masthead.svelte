<script lang="ts">
  /**
   * Masthead — the app's navigation as a financial broadsheet nameplate.
   *
   * Versifine is "editorial fintech", set like a printed prospectus. So
   * instead of the universal left-sidebar SaaS shell, the app is headed by a
   * newspaper masthead: a dateline micro-row, the wordmark nameplate flanked
   * by classic double-rules, and a section rail where the nav items read as
   * tracked small-caps sections (THE LEDGER · BUDGETS · …) with a gold
   * underline marking the page you're "reading". Timeless, unmistakably ours,
   * and nothing like a generic dashboard chrome.
   */
  import { page } from '$app/stores';
  import {
    Search, Sun, Moon, Monitor, Sparkles, LogOut, Menu, X,
  } from 'lucide-svelte';
  import Wordmark from '$lib/components/brand/Wordmark.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { cn } from '$lib/utils/cn';

  type Props = {
    onOpenCommand: () => void;
    onOpenCopilot: (initial?: string) => void;
  };
  let { onOpenCommand, onOpenCopilot }: Props = $props();

  const m = $derived(getMessages(settings.language));

  // Section labels lean editorial: "The Ledger", "The Outlook" — newspaper
  // sections, not app tabs. Falls back to the i18n nav labels for non-English.
  const sections = $derived([
    { href: '/dashboard', label: m.nav.dashboard, kicker: settings.language === 'en' ? 'Front Page' : m.nav.dashboard },
    { href: '/transactions', label: m.nav.transactions, kicker: settings.language === 'en' ? 'The Ledger' : m.nav.transactions },
    { href: '/budgets', label: m.nav.budgets, kicker: settings.language === 'en' ? 'Budgets' : m.nav.budgets },
    { href: '/goals', label: m.nav.goals, kicker: settings.language === 'en' ? 'Goals' : m.nav.goals },
    { href: '/forecast', label: m.nav.forecast, kicker: settings.language === 'en' ? 'The Outlook' : m.nav.forecast },
    { href: '/reports', label: m.nav.reports, kicker: settings.language === 'en' ? 'Reports' : m.nav.reports },
  ]);

  const path = $derived($page.url.pathname);
  function isActive(href: string): boolean {
    if (href === '/dashboard') return path === '/dashboard';
    return path === href || path.startsWith(`${href}/`);
  }

  const today = new Date();
  const dateline = today.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const firstName = $derived(auth.user?.displayName?.split(' ')[0] ?? '');
  const edition = $derived(firstName ? `${firstName}'s Edition` : 'Personal Edition');

  let mobileOpen = $state(false);

  function cycleTheme() {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const i = order.indexOf(settings.theme);
    settings.setTheme(order[(i + 1) % order.length] ?? 'light');
  }
  async function handleLogout() {
    await auth.logout();
  }
</script>

<header class="sticky top-0 z-30 border-b border-[hsl(var(--brand-navy)/0.18)] bg-[hsl(var(--background)/0.85)] backdrop-blur-md">
  <!-- Dateline micro-row -->
  <div class="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))] sm:px-6">
    <span class="hidden truncate sm:inline">{dateline}</span>
    <span class="truncate font-medium text-[hsl(var(--brand-navy))] sm:hidden">{edition}</span>
    <div class="flex items-center gap-3">
      <span class="hidden font-medium text-[hsl(var(--brand-navy))] sm:inline">{edition}</span>
      <span class="hidden h-3 w-px bg-[hsl(var(--border))] sm:inline-block"></span>
      <button type="button" onclick={onOpenCommand} class="inline-flex items-center gap-1.5 transition-colors hover:text-[hsl(var(--brand-navy))]" aria-label="Search">
        <Search class="h-3.5 w-3.5" />
        <kbd class="hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1 py-px text-[9px] font-medium sm:inline">{m.topbar.commandShortcut}</kbd>
      </button>
      <button type="button" onclick={cycleTheme} class="transition-colors hover:text-[hsl(var(--brand-navy))]" aria-label={m.topbar.theme}>
        {#if settings.theme === 'light'}<Sun class="h-3.5 w-3.5" />{:else if settings.theme === 'dark'}<Moon class="h-3.5 w-3.5" />{:else}<Monitor class="h-3.5 w-3.5" />{/if}
      </button>
      <button type="button" onclick={handleLogout} class="hidden transition-colors hover:text-[hsl(var(--destructive))] sm:inline-flex" aria-label={m.nav.signOut}>
        <LogOut class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>

  <!-- Double rule -->
  <div class="mx-auto max-w-[1280px] px-4 sm:px-6">
    <div class="h-px bg-[hsl(var(--brand-navy)/0.55)]"></div>
    <div class="mt-0.5 h-px bg-[hsl(var(--brand-navy)/0.2)]"></div>
  </div>

  <!-- Nameplate -->
  <div class="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-3 sm:px-6">
    <button
      type="button"
      class="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[hsl(var(--brand-navy))] transition-colors hover:bg-[hsl(var(--accent))] lg:hidden"
      onclick={() => (mobileOpen = !mobileOpen)}
      aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
    >
      {#if mobileOpen}<X class="h-5 w-5" />{:else}<Menu class="h-5 w-5" />{/if}
    </button>

    <a href="/dashboard" class="mx-auto flex items-center transition-opacity hover:opacity-80" aria-label="Versifine home">
      <Wordmark class="h-7 w-auto text-[hsl(var(--brand-navy))] sm:h-8" />
    </a>

    <button
      type="button"
      onclick={() => onOpenCopilot()}
      class="group hidden shrink-0 items-center gap-2 rounded-full border border-[hsl(var(--brand-navy)/0.2)] px-4 py-2 text-sm font-medium text-[hsl(var(--brand-navy))] transition-all hover:border-[hsl(var(--brand-navy))] hover:bg-[hsl(var(--brand-navy))] hover:text-[hsl(var(--brand-paper))] lg:inline-flex"
    >
      <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
      {m.nav.askCopilot}
    </button>
  </div>

  <!-- Double rule -->
  <div class="mx-auto max-w-[1280px] px-4 sm:px-6">
    <div class="h-px bg-[hsl(var(--brand-navy)/0.2)]"></div>
    <div class="mt-0.5 h-px bg-[hsl(var(--brand-navy)/0.55)]"></div>
  </div>

  <!-- Section rail (desktop) -->
  <nav class="mx-auto hidden max-w-[1280px] items-stretch px-4 sm:px-6 lg:flex" aria-label="Sections">
    {#each sections as s, i (s.href)}
      {@const active = isActive(s.href)}
      <a
        href={s.href}
        class={cn(
          'group relative flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors first:pl-0',
          active ? 'text-[hsl(var(--brand-navy))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--brand-navy))]',
        )}
        aria-current={active ? 'page' : undefined}
      >
        {#if i > 0}<span aria-hidden="true" class="absolute left-0 top-1/2 h-3.5 w-px -translate-y-1/2 bg-[hsl(var(--border))]"></span>{/if}
        {s.kicker}
        <span
          aria-hidden="true"
          class={cn(
            'absolute -bottom-px left-5 right-5 h-0.5 rounded-full bg-[hsl(var(--brand-gold))] transition-all duration-300 first:left-0',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
          )}
        ></span>
      </a>
    {/each}
    <div class="flex-1"></div>
    <a
      href="/settings"
      class={cn(
        'flex items-center px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors',
        isActive('/settings') ? 'text-[hsl(var(--brand-navy))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--brand-navy))]',
      )}
      aria-current={isActive('/settings') ? 'page' : undefined}
    >
      {m.nav.settings}
    </a>
  </nav>

  <!-- Mobile section drawer -->
  {#if mobileOpen}
    <nav class="border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 pb-4 pt-2 lg:hidden" aria-label="Sections">
      {#each sections as s (s.href)}
        {@const active = isActive(s.href)}
        <a
          href={s.href}
          onclick={() => (mobileOpen = false)}
          class={cn(
            'flex items-center justify-between border-b border-[hsl(var(--border))] py-3 text-xs font-semibold uppercase tracking-[0.18em] last:border-0',
            active ? 'text-[hsl(var(--brand-navy))]' : 'text-[hsl(var(--muted-foreground))]',
          )}
          aria-current={active ? 'page' : undefined}
        >
          {s.kicker}
          {#if active}<span class="h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand-gold))]"></span>{/if}
        </a>
      {/each}
      <a href="/settings" onclick={() => (mobileOpen = false)} class="flex items-center border-b border-[hsl(var(--border))] py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
        {m.nav.settings}
      </a>
      <div class="mt-3 flex items-center gap-2">
        <button type="button" onclick={() => { onOpenCopilot(); mobileOpen = false; }} class="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--brand-navy))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--brand-paper))]">
          <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" /> {m.nav.askCopilot}
        </button>
        <button type="button" onclick={handleLogout} class="grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]" aria-label={m.nav.signOut}>
          <LogOut class="h-4 w-4" />
        </button>
      </div>
    </nav>
  {/if}
</header>
