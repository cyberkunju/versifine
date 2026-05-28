<script lang="ts">
  /**
   * Dashboard. Four hero tiles, recent transactions, forecast preview,
   * top categories, budget alerts, copilot quick prompts.
   */
  import { fade, fly } from 'svelte/transition';
  import { TrendingUp, TrendingDown, PiggyBank, Banknote, Sparkles, AlertTriangle } from 'lucide-svelte';
  import type {
    BudgetSummary,
    BudgetProgress,
    ForecastResult,
    GoalSummary,
    ReportSummary,
    TransactionSummary,
    WalletSummary,
  } from '$lib/api/types';
  import { CATEGORY_META, type Category } from '@finehance/shared';
  import { api } from '$lib/api/client';
  import { useQuery } from '$lib/api/queries';
  import { settings } from '$lib/stores/settings.svelte';
  import { panels } from '$lib/stores/panels.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, relativeDate } from '$lib/utils/format';
  import { Card, CardHeader, CardTitle, CardContent, Skeleton, Badge } from '$lib/components/ui';
  import ForecastCard from '$lib/components/forecast/ForecastCard.svelte';

  const m = $derived(getMessages(settings.language));

  function thisMonthRange(): { from: string; to: string } {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: iso(first), to: iso(now) };
  }
  function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const range = thisMonthRange();
  const summary = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', range.from, range.to],
    () => api.reports.summary(range),
  );
  const recent = useQuery<{ items: TransactionSummary[] }>(
    ['transactions', 'recent', 5],
    () => api.transactions.list({ limit: 5 }),
  );
  const wallets = useQuery<{ wallets: WalletSummary[] }>(['wallets'], () => api.wallets.list());
  const forecast = useQuery<{ forecast: ForecastResult }>(
    ['forecast', 30],
    () => api.forecast.get(30),
  );
  const budgets = useQuery<{ budgets: BudgetSummary[] }>(['budgets'], () => api.budgets.list());
  const goals = useQuery<{ goals: GoalSummary[] }>(['goals', 'active'], () =>
    api.goals.list('active'),
  );

  // Budget alerts: per-budget, fetch progress and surface anything in warn/exceeded.
  let budgetAlerts = $state<{ name: string; category: string; pct: number; status: 'warn' | 'exceeded' }[]>(
    [],
  );
  $effect(() => {
    const list = budgets.data?.budgets;
    if (!list) return;
    void (async () => {
      const out: typeof budgetAlerts = [];
      for (const b of list) {
        try {
          const { progress } = await api.budgets.progress(b.id);
          for (const [cat, info] of Object.entries(progress.perCategory) as Array<[
            string,
            BudgetProgress['perCategory'][keyof BudgetProgress['perCategory']],
          ]>) {
            const i = info;
            if (i && (i.status === 'warn' || i.status === 'exceeded')) {
              out.push({ name: b.name, category: cat, pct: i.percentage, status: i.status });
            }
          }
        } catch {
          // skip
        }
      }
      budgetAlerts = out.slice(0, 6);
    })();
  });

  const netWorth = $derived(
    (wallets.data?.wallets ?? [])
      .filter((w) => !w.archived)
      .reduce((sum, w) => sum + w.balance, 0),
  );

  const totals = $derived(summary.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });
  const top = $derived(summary.data?.summary.byCategory.slice(0, 3) ?? []);

  const promptCards = $derived([
    m.dashboard.promptWhereDidMyMoneyGo,
    m.dashboard.promptForecast30,
    m.dashboard.promptOverspending,
    m.dashboard.promptCompareLastMonth,
  ]);

  function openCopilotPrompt(prompt: string) {
    panels.openCopilot(prompt);
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">{m.nav.dashboard}</h1>
    <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.app.tagline}</p>
  </header>

  <!-- Top tiles -->
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {@render Tile({ icon: TrendingUp, label: m.dashboard.income, value: formatCurrency(totals.income), tone: 'emerald', loading: summary.loading })}
    {@render Tile({ icon: TrendingDown, label: m.dashboard.expense, value: formatCurrency(totals.expense), tone: 'rose', loading: summary.loading })}
    {@render Tile({ icon: PiggyBank, label: m.dashboard.savingsRate, value: `${(totals.savingsRate ?? 0).toFixed(0)}%`, tone: 'violet', loading: summary.loading })}
    {@render Tile({ icon: Banknote, label: m.dashboard.netWorth, value: formatCurrency(netWorth), tone: 'sky', loading: wallets.loading })}
  </div>

  {#snippet Tile({ icon, label, value, tone, loading }: { icon: typeof TrendingUp; label: string; value: string; tone: 'emerald' | 'rose' | 'violet' | 'sky'; loading: boolean })}
    {@const Icon = icon}
    <Card>
      <CardContent class="flex items-center justify-between p-5">
        <div class="space-y-1">
          <p class="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
          {#if loading}
            <Skeleton class="h-7 w-32" />
          {:else}
            <p class="text-2xl font-semibold tracking-tight" in:fade={{ duration: 200 }}>{value}</p>
          {/if}
        </div>
        <span
          class="grid h-10 w-10 place-items-center rounded-lg"
          class:bg-emerald-500={tone === 'emerald'}
          class:bg-rose-500={tone === 'rose'}
          class:bg-violet-500={tone === 'violet'}
          class:bg-sky-500={tone === 'sky'}
          style:background-color={`hsl(var(--chart-1) / 0.12)`}
        >
          <Icon class="h-4 w-4 text-[hsl(var(--primary))]" />
        </span>
      </CardContent>
    </Card>
  {/snippet}

  <!-- Two-column main row -->
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <Card class="lg:col-span-2">
      <CardHeader>
        <CardTitle>{m.dashboard.recent}</CardTitle>
      </CardHeader>
      <CardContent>
        {#if recent.loading}
          <div class="space-y-3">
            {#each Array(4) as _, i (i)}
              <Skeleton class="h-10 w-full" />
            {/each}
          </div>
        {:else if (recent.data?.items?.length ?? 0) === 0}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {:else}
          <ul class="divide-y divide-[hsl(var(--border))]">
            {#each recent.data?.items ?? [] as tx (tx.id)}
              {@const meta = tx.category ? CATEGORY_META[tx.category as Category] : null}
              <li
                class="flex items-center gap-3 py-2.5"
                in:fly={{ y: -6, duration: 220 }}
              >
                <span class="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--muted))] text-base">
                  {meta?.icon ?? '•'}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{tx.description}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">
                    {tx.category ?? 'Uncategorised'} · {relativeDate(tx.date)}
                  </p>
                </div>
                <span
                  class="text-sm font-semibold tabular-nums"
                  class:text-emerald-600={tx.type === 'income'}
                  class:text-[hsl(var(--foreground))]={tx.type !== 'income'}
                >
                  {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatCurrency(tx.amount, tx.currency)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{m.dashboard.forecast}</CardTitle>
      </CardHeader>
      <CardContent>
        {#if forecast.loading}
          <Skeleton class="h-44 w-full" />
        {:else if forecast.data?.forecast.daily?.length}
          <ForecastCard daily={forecast.data.forecast.daily} height={160} />
          <div class="mt-3 flex items-center justify-between text-xs">
            <span class="text-[hsl(var(--muted-foreground))]">{m.forecast.recurring} {formatCurrency(forecast.data.forecast.recurringBase)}</span>
            <span class="text-[hsl(var(--muted-foreground))]">{m.forecast.variable} {formatCurrency(forecast.data.forecast.variableTotal)}</span>
          </div>
        {:else}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.forecast.noData}</p>
        {/if}
      </CardContent>
    </Card>
  </div>

  <!-- Bottom row -->
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <Card>
      <CardHeader>
        <CardTitle>{m.dashboard.topCategories}</CardTitle>
      </CardHeader>
      <CardContent>
        {#if summary.loading}
          <Skeleton class="h-24 w-full" />
        {:else if top.length === 0}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {:else}
          <ul class="space-y-3">
            {#each top as row (row.category)}
              {@const meta = CATEGORY_META[row.category as Category] ?? CATEGORY_META.Other}
              <li>
                <div class="flex items-center justify-between text-sm">
                  <span class="flex items-center gap-2">
                    <span aria-hidden="true">{meta.icon}</span>{row.category}
                  </span>
                  <span class="font-medium tabular-nums">{formatCurrency(row.total)}</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div
                    class="h-full rounded-full bg-[hsl(var(--primary))]"
                    style:width={`${(row.total / (top[0]?.total ?? 1)) * 100}%`}
                  ></div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{m.dashboard.budgetAlerts}</CardTitle>
      </CardHeader>
      <CardContent>
        {#if budgetAlerts.length === 0}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyAlerts}</p>
        {:else}
          <ul class="space-y-2">
            {#each budgetAlerts as alert, i (i)}
              <li class="flex items-center justify-between gap-2 rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm">
                <span class="flex items-center gap-2">
                  <AlertTriangle class={alert.status === 'exceeded' ? 'h-4 w-4 text-red-500' : 'h-4 w-4 text-amber-500'} />
                  <span>{alert.category}</span>
                  <span class="text-xs text-[hsl(var(--muted-foreground))]">{alert.name}</span>
                </span>
                <Badge variant={alert.status === 'exceeded' ? 'destructive' : 'warning'}>
                  {alert.pct.toFixed(0)}%
                </Badge>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>
          <span class="inline-flex items-center gap-2">
            <Sparkles class="h-4 w-4" /> {m.dashboard.quickPrompts}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 gap-2">
          {#each promptCards as prompt, i (i)}
            <button
              type="button"
              class="rounded-md border border-[hsl(var(--border))] px-3 py-2 text-left text-sm hover:bg-[hsl(var(--accent))]"
              onclick={() => openCopilotPrompt(prompt)}
            >
              {prompt}
            </button>
          {/each}
        </div>
        {#if (goals.data?.goals?.length ?? 0) > 0}
          <p class="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
            Tracking {goals.data?.goals.length} goals.
          </p>
        {/if}
      </CardContent>
    </Card>
  </div>
</div>
