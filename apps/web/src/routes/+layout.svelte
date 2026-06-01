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
  import { invalidate } from '$lib/api/queries.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency } from '$lib/utils/format';

  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import Topbar from '$lib/components/layout/Topbar.svelte';
  import CommandMenu from '$lib/components/layout/CommandMenu.svelte';
  import VMark from '$lib/components/brand/VMark.svelte';
  import CopilotPanel from '$lib/components/copilot/CopilotPanel.svelte';
  import OmnibarDock from '$lib/components/omnibar/OmnibarDock.svelte';
  import { Toaster } from '$lib/components/ui';

  let { children } = $props();

  let mobileSidebarOpen = $state(false);

  // Routes that are publicly accessible (no auth required) and must NOT
  // render the app shell. The landing page lives at `/`, auth pages
  // under `/login` and `/register`. Everything else is the app.
  const PUBLIC_ROUTES = ['/', '/login', '/register'];
  const APP_ROUTES = [
    '/dashboard',
    '/transactions',
    '/budgets',
    '/goals',
    '/forecast',
    '/reports',
    '/settings',
  ];

  const path = $derived($page.url.pathname);
  const isAuthRoute = $derived(path.startsWith('/login') || path.startsWith('/register'));
  const isLandingRoute = $derived(path === '/');
  // Operator-only console: renders standalone (its own credential gate),
  // never the app shell, regardless of web-app auth state.
  const isStandaloneRoute = $derived(path === '/admin' || path.startsWith('/admin/'));
  const isAppRoute = $derived(APP_ROUTES.some((r) => path === r || path.startsWith(`${r}/`)));
  const isPublicRoute = $derived(PUBLIC_ROUTES.some((r) => r === '/' ? path === '/' : path.startsWith(r)));

  const m = $derived(getMessages(settings.language));

  $effect(() => {
    if (!browser || !auth.ready) return;
    // Send unauthenticated users into /login when they hit a protected
    // app route. Public routes (`/`, `/login`, `/register`) render
    // unconditionally so the landing page works for everyone.
    if (!auth.isAuthenticated && isAppRoute) {
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
{:else if isLandingRoute || isAuthRoute || isStandaloneRoute || !auth.isAuthenticated}
  {@render children?.()}
{:else}
  <div class="vf-shell relative flex h-screen w-full overflow-hidden">
    <!-- Fine grain over the gradient — premium tactile ink, not flat digital. -->
    <div aria-hidden="true" class="bg-grain pointer-events-none absolute inset-0 opacity-[0.5] mix-blend-soft-light"></div>
    <!-- Aurora glow blobs over the gradient ground — periwinkle + navy only -->
    <div aria-hidden="true" class="vf-aurora pointer-events-none absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full" style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.55), transparent 70%); filter:blur(48px);"></div>
    <div aria-hidden="true" class="vf-aurora pointer-events-none absolute -bottom-40 left-16 h-[460px] w-[460px] rounded-full" style="background:radial-gradient(closest-side, hsl(236 77% 50% / 0.4), transparent 70%); filter:blur(56px); animation-delay:-7s;"></div>
    <div aria-hidden="true" class="vf-aurora pointer-events-none absolute -top-32 left-1/4 h-[380px] w-[380px] rounded-full" style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.3), transparent 70%); filter:blur(60px); animation-delay:-12s;"></div>
    <!-- Faded V watermark, low in the rail -->
    <VMark class="pointer-events-none absolute -bottom-28 -left-24 w-[420px] select-none opacity-[0.07]" />

    <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => (mobileSidebarOpen = false)} />
    <div class="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col lg:py-2.5 lg:pr-2.5">
      <!-- Framed content panel: white sheet set into the gradient ground -->
      <div class="vf-panel flex min-h-0 flex-1 flex-col overflow-hidden bg-[hsl(var(--background))] lg:rounded-2xl lg:shadow-[0_18px_50px_-18px_rgba(0,0,0,0.5)] lg:ring-1 lg:ring-white/10">
        <Topbar
          onMenu={() => (mobileSidebarOpen = true)}
          onOpenCommand={() => panels.setCommandOpen(true)}
          onOpenCopilot={(initial) => openCopilot(initial)}
        />
        <main class="vf-scroll min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-28 sm:p-6 lg:p-8 lg:pb-28">
          {@render children?.()}
        </main>
      </div>
    </div>
  </div>
  {#if !panels.copilotOpen}
    <OmnibarDock onOpenCopilot={(initial) => openCopilot(initial)} />
  {/if}
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

<style>
  /* Living brand gradient ground — built ONLY from the three brand inks:
     navy #121a8c (236 77% 31%), navy-deep #090069 (245 100% 21%), and the
     periwinkle accent #8481f6 (242 87% 74%). A soft mesh of radial glows over
     the base diagonal gives depth; the whole field drifts so the rail breathes.
     No off-brand hues — every stop sits in the 236–245 indigo band. */
  .vf-shell {
    background:
      radial-gradient(90% 70% at 12% 8%, hsl(242 87% 74% / 0.42), transparent 55%),
      radial-gradient(80% 70% at 88% 18%, hsl(236 77% 41% / 0.5), transparent 58%),
      radial-gradient(120% 100% at 90% 100%, hsl(245 100% 14% / 0.7), transparent 62%),
      linear-gradient(
        150deg,
        hsl(236 77% 32%) 0%,
        hsl(240 90% 24%) 48%,
        hsl(245 100% 16%) 100%
      );
    background-size: 200% 200%, 200% 200%, 200% 200%, 180% 180%;
    background-position: 0% 0%, 100% 0%, 100% 100%, 0% 0%;
    animation: vf-shell-drift 24s ease-in-out infinite;
  }
  @keyframes vf-shell-drift {
    0%, 100% { background-position: 0% 0%, 100% 0%, 100% 100%, 0% 0%; }
    50% { background-position: 35% 30%, 65% 25%, 70% 70%, 100% 60%; }
  }
  /* Periwinkle accent blob breathes; the deep navy ones anchor the corners. */
  .vf-aurora {
    animation: vf-aurora 14s ease-in-out infinite;
  }
  @keyframes vf-aurora {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
    50% { transform: translate(40px, -30px) scale(1.16); opacity: 0.8; }
  }
  /* Soft inner highlight where the white sheet meets the gradient — turns the
     plain edge into a lit bevel that subtly pulses. */
  .vf-panel {
    position: relative;
  }
  .vf-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.9),
      inset 1px 0 0 0 rgba(255, 255, 255, 0.55);
    animation: vf-panel-glow 7s ease-in-out infinite;
  }
  @keyframes vf-panel-glow {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .vf-shell { animation: none; }
    .vf-aurora { animation: none; }
    .vf-panel::before { animation: none; }
  }
</style>
