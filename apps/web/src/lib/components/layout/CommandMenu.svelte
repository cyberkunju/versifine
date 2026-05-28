<script lang="ts">
  /**
   * ⌘K command menu. Sections: Navigate (the seven primary pages),
   * Quick actions, Recent transactions, Settings. Filters via the cmdk
   * primitive provided by bits-ui.
   */
  import { Command } from 'bits-ui';
  import {
    LayoutDashboard,
    Receipt,
    Wallet,
    Target,
    LineChart,
    BarChart3,
    Settings as SettingsIcon,
    Sparkles,
    Plus,
    MessageSquare,
  } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import type { TransactionSummary } from '$lib/api/types';
  import { api } from '$lib/api/client';
  import { useQuery } from '$lib/api/queries.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency } from '$lib/utils/format';
  import { cn } from '$lib/utils/cn';
  import { Dialog as D } from 'bits-ui';

  type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAskCopilot?: () => void;
  };

  let { open = $bindable(), onOpenChange, onAskCopilot }: Props = $props();
  const m = $derived(getMessages(settings.language));

  const recent = useQuery<{ items: TransactionSummary[] }>(
    ['transactions', 'recent', 5],
    () => api.transactions.list({ limit: 5 }),
    { enabled: false },
  );

  $effect(() => {
    if (open) recent.refetch();
  });

  function go(href: string) {
    onOpenChange(false);
    void goto(href);
  }

  const items = $derived([
    { href: '/', label: m.nav.dashboard, icon: LayoutDashboard },
    { href: '/transactions', label: m.nav.transactions, icon: Receipt },
    { href: '/budgets', label: m.nav.budgets, icon: Wallet },
    { href: '/goals', label: m.nav.goals, icon: Target },
    { href: '/forecast', label: m.nav.forecast, icon: LineChart },
    { href: '/reports', label: m.nav.reports, icon: BarChart3 },
    { href: '/settings', label: m.nav.settings, icon: SettingsIcon },
  ]);
</script>

<D.Root bind:open onOpenChange={(v) => onOpenChange(v)}>
  <D.Portal>
    <D.Overlay class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <D.Content
      class={cn(
        'fixed left-[50%] top-[20%] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-2xl',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
      )}
    >
      <Command.Root
        class="overflow-hidden rounded-xl bg-transparent text-[hsl(var(--popover-foreground))]"
        loop
      >
        <div class="flex items-center border-b border-[hsl(var(--border))] px-3">
          <Sparkles class="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Command.Input
            class="h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]"
            placeholder="Type a command, page, or transaction…"
          />
        </div>
        <Command.List class="max-h-[360px] overflow-y-auto p-1">
          <Command.Empty class="px-2 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No matches.
          </Command.Empty>
          <Command.Group class="mb-1">
            <Command.GroupHeading class="px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Navigate
            </Command.GroupHeading>
            <Command.GroupItems>
              {#each items as item (item.href)}
                {@const Icon = item.icon}
                <Command.Item
                  class="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-[hsl(var(--accent))] data-[selected=true]:text-[hsl(var(--accent-foreground))]"
                  onSelect={() => go(item.href)}
                  value={item.label}
                >
                  <Icon class="h-4 w-4" /> {item.label}
                </Command.Item>
              {/each}
            </Command.GroupItems>
          </Command.Group>
          <Command.Group>
            <Command.GroupHeading class="px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Actions
            </Command.GroupHeading>
            <Command.GroupItems>
              <Command.Item
                class="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-[hsl(var(--accent))]"
                onSelect={() => go('/transactions')}
                value="new transaction"
              >
                <Plus class="h-4 w-4" /> New transaction
              </Command.Item>
              <Command.Item
                class="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-[hsl(var(--accent))]"
                onSelect={() => {
                  onOpenChange(false);
                  onAskCopilot?.();
                }}
                value="ask copilot"
              >
                <MessageSquare class="h-4 w-4" /> {m.nav.askCopilot}
              </Command.Item>
            </Command.GroupItems>
          </Command.Group>
          {#if recent.data?.items?.length}
            <Command.Group>
              <Command.GroupHeading class="px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Recent transactions
              </Command.GroupHeading>
              <Command.GroupItems>
                {#each recent.data.items as tx (tx.id)}
                  <Command.Item
                    class="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-[hsl(var(--accent))]"
                    onSelect={() => go('/transactions')}
                    value={`${tx.description} ${tx.category ?? ''}`}
                  >
                    <span class="flex-1 truncate">{tx.description}</span>
                    <span class="text-xs text-[hsl(var(--muted-foreground))]">
                      {formatCurrency(tx.amount, tx.currency)}
                    </span>
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          {/if}
        </Command.List>
      </Command.Root>
    </D.Content>
  </D.Portal>
</D.Root>
