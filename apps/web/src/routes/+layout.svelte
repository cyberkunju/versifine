<script lang="ts">
  /**
   * Application shell.
   *
   * Wires the auth gate, sidebar, topbar, command menu, copilot panel,
   * and the toast queue. Login + register pages opt out of the
   * sidebar/topbar by sniffing the route — keeps the auth flow visually
   * separate without two layout files.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import '../app.css';

  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { pendingCaptures } from '$lib/stores/pendingCaptures.svelte';
  import { panels } from '$lib/stores/panels.svelte';
  import { socket } from '$lib/api/ws';
  import { invalidate } from '$lib/api/queries';
  import { toast } from '$lib/stores/toast.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency } from '$lib/utils/format';

  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import Topbar from '$lib/components/layout/Topbar.svelte';
  import CommandMenu from '$lib/components/layout/CommandMenu.svelte';
  import CopilotPanel from '$lib/components/copilot/CopilotPanel.svelte';
  import { Toaster } from '$lib/components/ui';

  let { children } = $props();

  let mobileSidebarOpen = $state(false);

  const isAuthRoute = $derived($page.url.pathname.startsWith('/login') || $page.url.pathname.startsWith('/register'));
  const m = $derived(getMessages(settings.language));

  $effect(() => {
    if (!browser || !auth.ready) return;
    if (!auth.isAuthenticated && !isAuthRoute) {
      void goto('/login');
    }
  });

  function handleKey(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      panels.toggleCommand();
    }
  }

  function setupSocketHandlers(): Array<() => void> {
    return [
      socket.on('transaction.created', (event) => {
        invalidate(['transactions']);
        invalidate(['wallets']);
        invalidate(['budgets']);
        invalidate(['forecast']);
        invalidate(['reports']);
        invalidate(['advice']);
        const data = event.data;
        toast.info(
          'New transaction',
          `${formatCurrency(data.amount, data.currency as never)} — ${data.description}`,
        );
      }),
      socket.on('transaction.updated', () => invalidate(['transactions'])),
      socket.on('transaction.deleted', () => invalidate(['transactions'])),
      socket.on('budget.warning', (event) => {
        invalidate(['budgets']);
        toast.warning(
          `${event.data.category} budget`,
          `${event.data.percentage.toFixed(0)}% of allocation spent.`,
        );
      }),
      socket.on('budget.exceeded', (event) => {
        invalidate(['budgets']);
        toast.error(
          `${event.data.category} budget exceeded`,
          `Over by ${formatCurrency(event.data.overBy, 'INR')}.`,
        );
      }),
      socket.on('goal.updated', () => invalidate(['goals'])),
      socket.on('forecast.invalidated', () => invalidate(['forecast'])),
      socket.on('wallet.updated', () => invalidate(['wallets'])),
      socket.on('ledger.updated', () => invalidate(['ledger'])),
      socket.on('recurring.detected', () => invalidate(['recurring'])),
    ];
  }

  let cleanups: Array<() => void> = [];

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    cleanups = setupSocketHandlers();
    // SvelteKit auto-registers `src/service-worker.ts` when present, so
    // we don't need an explicit `register()` call here.
    if ('serviceWorker' in navigator) {
      // Listen for DRAIN_QUEUE pings the SW relays after a SYNC_PENDING_CAPTURES.
      const onMessage = (event: MessageEvent<{ type?: string }>) => {
        if (event.data?.type === 'DRAIN_QUEUE') {
          void pendingCaptures.drain();
        }
      };
      navigator.serviceWorker.addEventListener('message', onMessage);
      cleanups.push(() => navigator.serviceWorker.removeEventListener('message', onMessage));
    }
    const onOnline = () => {
      void pendingCaptures.drain();
      // Also nudge the SW so any background-sync state stays in lockstep.
      navigator.serviceWorker?.controller?.postMessage({ type: 'SYNC_PENDING_CAPTURES' });
    };
    window.addEventListener('online', onOnline);
    cleanups.push(() => window.removeEventListener('online', onOnline));
  });

  onDestroy(() => {
    if (browser) window.removeEventListener('keydown', handleKey);
    for (const off of cleanups) off();
  });

  function openCopilot(initial?: string) {
    panels.openCopilot(initial ?? null);
  }
</script>

{#if !auth.ready}
  <div class="grid min-h-screen place-items-center text-sm text-[hsl(var(--muted-foreground))]">
    {m.common.loading}
  </div>
{:else if isAuthRoute || !auth.isAuthenticated}
  {@render children?.()}
{:else}
  <div class="flex min-h-screen w-full">
    <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => (mobileSidebarOpen = false)} />
    <div class="flex min-w-0 flex-1 flex-col">
      <Topbar
        onMenu={() => (mobileSidebarOpen = true)}
        onOpenCommand={() => panels.setCommandOpen(true)}
        onOpenCopilot={(initial) => openCopilot(initial)}
      />
      <main class="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6">
        {@render children?.()}
      </main>
    </div>
  </div>
  <CommandMenu
    bind:open={panels.commandOpen}
    onOpenChange={(v) => panels.setCommandOpen(v)}
    onAskCopilot={() => openCopilot()}
  />
  <CopilotPanel
    bind:open={panels.copilotOpen}
    onOpenChange={(v) => panels.setCopilotOpen(v)}
    seed={panels.copilotSeed}
  />
{/if}

<Toaster />
