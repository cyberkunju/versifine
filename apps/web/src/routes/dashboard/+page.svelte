<script lang="ts">
  /**
   * Dashboard — "the morning read".
   *
   * A calm, editorial command centre: a month masthead, four hero metrics
   * with month-over-month deltas and sparklines, a hero cashflow chart
   * (daily bars + cumulative line + even-pace guide), a savings dial with a
   * month digest, a full category breakdown, a live budget rail, the
   * forecast with recurring/anomaly context, an insights column, and a
   * recent-activity feed. Every number is real, pulled from the API; the
   * daily series is bucketed client-side from this month's transactions.
   */
  import { fly } from 'svelte/transition';
  import {
    ArrowDownRight,
    Wallet,
    PiggyBank,
    TrendingDown,
    Sparkles,
    AlertTriangle,
    CalendarClock,
    Lightbulb,
    ArrowRight,
  } from 'lucide-svelte';
  import type {
    AdviceEnvelope,
    BudgetSummary,
    ForecastResult,
    GoalSummary,
    ReportSummary,
    TransactionSummary,
    WalletSummary,
  } from '$lib/api/types';
  import { api } from '$lib/api/client';
  import { useQuery } from '$lib/api/queries.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { panels } from '$lib/stores/panels.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, relativeDate } from '$lib/utils/format';
  import {
    monthRange,
    bucketByDay,
    cumulative,
    categoryColor,
    categoryIcon,
    deltaPct,
  } from '$lib/utils/dashboard';
  import { Card } from '$lib/components/ui';
  import StatTile from '$lib/components/dashboard/StatTile.svelte';
  import CashflowChart from '$lib/components/dashboard/CashflowChart.svelte';
  import CategoryBreakdown from '$lib/components/dashboard/CategoryBreakdown.svelte';
  import Radial from '$lib/components/dashboard/Radial.svelte';
  import ForecastCard from '$lib/components/forecast/ForecastCard.svelte';

  const m = $derived(getMessages(settings.language));

  const now = new Date();
  const cur = monthRange(0);
  const prev = monthRange(1);
  const todayDay = now.getDate();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  /* ── Queries (keys match the layout's realtime invalidations) ──────── */
  const summary = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', cur.from, cur.to],
    () => api.reports.summary({ from: cur.from, to: cur.to }),
  );
  const summaryPrev = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', prev.from, prev.to],
    () => api.reports.summary({ from: prev.from, to: prev.to }),
  );
  // Whole-month transactions for client-side daily bucketing + activity feed.
  const monthTxns = useQuery<{ items: TransactionSummary[] }>(
    ['transactions', 'month', cur.from],
    () => api.transactions.list({ from: cur.from, to: cur.to, limit: 200 } as never),
  );
  const wallets = useQuery<{ wallets: WalletSummary[] }>(['wallets'], () => api.wallets.list());
  const forecast = useQuery<{ forecast: ForecastResult }>(['forecast', 30], () => api.forecast.get(30));
  const budgets = useQuery<{ budgets: BudgetSummary[] }>(['budgets'], () => api.budgets.list());
  const goals = useQuery<{ goals: GoalSummary[] }>(['goals', 'active'], () => api.goals.list('active'));
  const advice = useQuery<AdviceEnvelope>(['advice'], () => api.advice.get());

  /* ── Derived models ────────────────────────────────────────────────── */
  const totals = $derived(summary.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });
  const prevTotals = $derived(summaryPrev.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });

  const buckets = $derived(monthTxns.data ? bucketByDay(monthTxns.data.items, cur) : []);
  const cumSpend = $derived(cumulative(buckets));

  const netWorth = $derived(
    (wallets.data?.wallets ?? []).filter((w) => !w.archived).reduce((s, w) => s + w.balance, 0),
  );

  const incomeDelta = $derived(deltaPct(totals.income, prevTotals.income));
  const expenseDelta = $derived(deltaPct(totals.expense, prevTotals.expense));
  const savingsDelta = $derived(
    totals.savingsRate - (prevTotals.savingsRate ?? 0),
  );

  // Burn rate + projection for the digest.
  const dayProgress = $derived(cur.isCurrent ? todayDay / cur.daysInMonth : 1);
  const avgPerDay = $derived(cur.isCurrent && todayDay > 0 ? totals.expense / todayDay : totals.expense / cur.daysInMonth);
  const projectedSpend = $derived(cur.isCurrent ? avgPerDay * cur.daysInMonth : totals.expense);
  const topCategory = $derived(summary.data?.summary.byCategory?.[0] ?? null);
  const biggestDay = $derived.by(() => {
    let best: { date: string; expense: number } | null = null;
    for (const b of buckets) if (!best || b.expense > best.expense) best = { date: b.date, expense: b.expense };
    return best && best.expense > 0 ? best : null;
  });

  const recent = $derived((monthTxns.data?.items ?? []).slice(0, 7));

  /* ── Budget rail: pull progress for each budget ────────────────────── */
  type BudgetRow = { id: string; name: string; allocated: number; spent: number; pct: number; status: 'ok' | 'warn' | 'exceeded' };
  let budgetRows = $state<BudgetRow[]>([]);
  $effect(() => {
    const list = budgets.data?.budgets;
    if (!list) return;
    void (async () => {
      const out: BudgetRow[] = [];
      for (const b of list) {
        try {
          const { progress } = await api.budgets.progress(b.id);
          const t = progress.totals;
          const pct = t.allocated > 0 ? (t.spent / t.allocated) * 100 : 0;
          const status: BudgetRow['status'] = pct >= 100 ? 'exceeded' : pct >= (b.warnThreshold ?? 80) ? 'warn' : 'ok';
          out.push({ id: b.id, name: b.name, allocated: t.allocated, spent: t.spent, pct, status });
        } catch {
          // skip a failing budget rather than break the rail
        }
      }
      budgetRows = out.sort((a, b) => b.pct - a.pct).slice(0, 4);
    })();
  });

  const anomalies = $derived(forecast.data?.forecast.anomalies ?? []);

  const promptCards = $derived([
    m.dashboard.promptWhereDidMyMoneyGo,
    m.dashboard.promptOverspending,
    m.dashboard.promptForecast30,
    m.dashboard.promptCompareLastMonth,
  ]);

  function ask(prompt: string) {
    panels.openCopilot(prompt);
  }

  function statusColor(s: 'ok' | 'warn' | 'exceeded'): string {
    return s === 'exceeded' ? 'hsl(350 52% 55%)' : s === 'warn' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))';
  }
</script>

<div class="mx-auto flex max-w-[1320px] flex-col gap-6">
  <!-- ── Masthead ──────────────────────────────────────────────────── -->
  <header class="flex flex-col gap-4 border-b border-[hsl(var(--border))] pb-5 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
        <span class="inline-block h-px w-6 bg-[hsl(var(--primary))]"></span>
        {cur.label}{cur.isCurrent ? ` · day ${todayDay} of ${cur.daysInMonth}` : ''}
      </p>
      <h1 class="mt-1.5 font-display text-[26px] font-semibold tracking-tight">
        {greeting}{auth.user?.displayName ? `, ${auth.user.displayName.split(' ')[0]}` : ''}.
      </h1>
    </div>
    <div class="flex items-center gap-5">
      <div class="text-right">
        <p class="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">{m.dashboard.netWorth}</p>
        <p class="font-display text-xl font-semibold tabular-nums">{formatCurrency(netWorth)}</p>
      </div>
      <button
        type="button"
        onclick={() => ask(m.dashboard.promptWhereDidMyMoneyGo)}
        class="group inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--brand-navy-deep))]"
      >
        <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
        {m.nav.askCopilot}
      </button>
    </div>
  </header>

  <!-- ── Hero metrics ──────────────────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <StatTile
      label={m.dashboard.income} icon={ArrowDownRight}
      value={formatCurrency(totals.income)} delta={incomeDelta} goodWhenUp={true}
      loading={summary.loading}
    />
    <StatTile
      label={m.dashboard.expense} icon={TrendingDown}
      value={formatCurrency(totals.expense)} delta={expenseDelta} goodWhenUp={false}
      spark={cumSpend} loading={summary.loading}
    />
    <StatTile
      label={m.dashboard.savingsRate} icon={PiggyBank}
      value={`${(totals.savingsRate ?? 0).toFixed(0)}%`}
      delta={Number.isFinite(savingsDelta) ? savingsDelta : null} goodWhenUp={true}
      foot={`${formatCurrency(totals.savings)} saved`} loading={summary.loading}
    />
    <StatTile
      label={m.dashboard.netWorth} icon={Wallet}
      value={formatCurrency(netWorth)}
      foot={`${(wallets.data?.wallets ?? []).filter((w) => !w.archived).length} wallets`}
      loading={wallets.loading}
    />
  </section>

  <!-- ── Hero row: cashflow + savings digest ───────────────────────── -->
  <section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <Card class="lg:col-span-2">
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <div>
          <h2 class="text-sm font-semibold">Cashflow</h2>
          <p class="text-xs text-[hsl(var(--muted-foreground))]">Daily spend, cumulative, against an even pace</p>
        </div>
        <div class="flex items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm bg-[hsl(var(--primary)/0.5)]"></span>Daily</span>
          <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-3 bg-[hsl(var(--primary))]"></span>Running</span>
          <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-3 border-t border-dashed border-[hsl(var(--muted-foreground))]"></span>Pace</span>
        </div>
      </div>
      <div class="p-5 pt-4">
        {#if monthTxns.loading}
          <div class="h-[260px] w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
        {:else if buckets.some((b) => b.expense > 0)}
          <CashflowChart {buckets} todayDay={cur.isCurrent ? todayDay : null} />
        {:else}
          <div class="grid h-[260px] place-items-center text-center text-sm text-[hsl(var(--muted-foreground))]">
            <div>
              <p>{m.dashboard.emptyTransactions}</p>
            </div>
          </div>
        {/if}
      </div>
    </Card>

    <!-- Savings dial + digest -->
    <Card>
      <div class="border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">This month at a glance</h2>
      </div>
      <div class="flex flex-col items-center px-5 py-5">
        <Radial value={totals.savingsRate ?? 0}>
          <div>
            <p class="font-display text-3xl font-semibold tabular-nums leading-none">{(totals.savingsRate ?? 0).toFixed(0)}<span class="text-lg">%</span></p>
            <p class="mt-1 text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">saved</p>
          </div>
        </Radial>

        <dl class="mt-5 w-full space-y-2.5 text-sm">
          <div class="flex items-center justify-between">
            <dt class="text-[hsl(var(--muted-foreground))]">Avg / day</dt>
            <dd class="font-medium tabular-nums">{formatCurrency(Math.round(avgPerDay))}</dd>
          </div>
          {#if cur.isCurrent}
            <div class="flex items-center justify-between">
              <dt class="text-[hsl(var(--muted-foreground))]">Projected month</dt>
              <dd class="font-medium tabular-nums">{formatCurrency(Math.round(projectedSpend))}</dd>
            </div>
          {/if}
          {#if topCategory}
            <div class="flex items-center justify-between">
              <dt class="text-[hsl(var(--muted-foreground))]">Top category</dt>
              <dd class="flex items-center gap-1.5 font-medium">
                <span aria-hidden="true" class="text-xs">{categoryIcon(topCategory.category)}</span>{topCategory.category}
              </dd>
            </div>
          {/if}
          {#if biggestDay}
            <div class="flex items-center justify-between">
              <dt class="text-[hsl(var(--muted-foreground))]">Biggest day</dt>
              <dd class="font-medium tabular-nums">{formatCurrency(biggestDay.expense)} · {biggestDay.date.slice(5)}</dd>
            </div>
          {/if}
        </dl>

        {#if (goals.data?.goals?.length ?? 0) > 0}
          <div class="mt-4 w-full border-t border-[hsl(var(--border))] pt-4">
            <p class="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Goals</p>
            <ul class="space-y-2.5">
              {#each (goals.data?.goals ?? []).slice(0, 2) as g (g.id)}
                <li>
                  <div class="flex items-center justify-between text-sm">
                    <span class="flex items-center gap-1.5 truncate">
                      {g.name}
                      {#if g.atRisk}<span class="rounded-full bg-[hsl(38_70%_50%/0.14)] px-1.5 py-px text-[10px] font-medium text-[hsl(38_70%_38%)]">at risk</span>{/if}
                    </span>
                    <span class="tabular-nums text-[hsl(var(--muted-foreground))]">{g.progressPercentage.toFixed(0)}%</span>
                  </div>
                  <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div class="h-full rounded-full bg-[hsl(var(--primary))]" style:width={`${Math.min(100, g.progressPercentage)}%`}></div>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </Card>
  </section>

  <!-- ── Category + budgets + forecast ─────────────────────────────── -->
  <section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <!-- Category breakdown -->
    <Card>
      <div class="border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">Where it went</h2>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">Share of spend by category</p>
      </div>
      <div class="p-5">
        {#if summary.loading}
          <div class="h-40 w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
        {:else if (summary.data?.summary.byCategory?.length ?? 0) > 0}
          <CategoryBreakdown rows={summary.data?.summary.byCategory ?? []} />
        {:else}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {/if}
      </div>
    </Card>

    <!-- Budget rail -->
    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.budgetAlerts}</h2>
        <a href="/budgets" class="text-xs text-[hsl(var(--primary))] hover:underline">All budgets</a>
      </div>
      <div class="p-5">
        {#if budgetRows.length === 0}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyAlerts}</p>
        {:else}
          <ul class="space-y-3.5">
            {#each budgetRows as b (b.id)}
              <li>
                <div class="flex items-center justify-between text-sm">
                  <span class="flex items-center gap-1.5 truncate font-medium">
                    {#if b.status === 'exceeded'}<AlertTriangle class="h-3.5 w-3.5 text-[hsl(350_52%_55%)]" />{/if}
                    {b.name}
                  </span>
                  <span class="tabular-nums text-[hsl(var(--muted-foreground))]">{formatCurrency(b.spent)} / {formatCurrency(b.allocated)}</span>
                </div>
                <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div
                    class="h-full rounded-full transition-[width] duration-500"
                    style:width={`${Math.min(100, b.pct)}%`}
                    style:background-color={statusColor(b.status)}
                  ></div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <!-- Forecast -->
    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.forecast}</h2>
        <a href="/forecast" class="text-xs text-[hsl(var(--primary))] hover:underline">Detail</a>
      </div>
      <div class="p-5">
        {#if forecast.loading}
          <div class="h-40 w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
        {:else if forecast.data?.forecast.daily?.length}
          <ForecastCard daily={forecast.data.forecast.daily} height={150} />
          <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-lg bg-[hsl(var(--muted))] px-3 py-2">
              <p class="text-[hsl(var(--muted-foreground))]">{m.forecast.recurring}</p>
              <p class="font-semibold tabular-nums">{formatCurrency(forecast.data.forecast.recurringBase)}</p>
            </div>
            <div class="rounded-lg bg-[hsl(var(--muted))] px-3 py-2">
              <p class="text-[hsl(var(--muted-foreground))]">{m.forecast.variable}</p>
              <p class="font-semibold tabular-nums">{formatCurrency(forecast.data.forecast.variableTotal)}</p>
            </div>
          </div>
        {:else}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.forecast.noData}</p>
        {/if}
      </div>
    </Card>
  </section>

  <!-- ── Activity + insights ───────────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <!-- Recent activity -->
    <Card class="lg:col-span-2">
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.recent}</h2>
        <a href="/transactions" class="text-xs text-[hsl(var(--primary))] hover:underline">View all</a>
      </div>
      <div class="px-5 py-2">
        {#if monthTxns.loading}
          <div class="space-y-3 py-3">
            {#each Array(5) as _, i (i)}<div class="h-10 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}
          </div>
        {:else if recent.length === 0}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {:else}
          <ul class="divide-y divide-[hsl(var(--border))]">
            {#each recent as tx (tx.id)}
              <li class="flex items-center gap-3 py-2.5" in:fly={{ y: -4, duration: 200 }}>
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm"
                  style:background-color={categoryColor(tx.category, 0.12)}
                >{categoryIcon(tx.category)}</span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{tx.description}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">{tx.category ?? 'Uncategorised'} · {relativeDate(tx.date)}</p>
                </div>
                <span
                  class="text-sm font-semibold tabular-nums"
                  class:text-emerald-700={tx.type === 'income'}
                  style:color={tx.type === 'income' ? 'hsl(160 38% 36%)' : 'hsl(var(--foreground))'}
                >{tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatCurrency(tx.amount, tx.currency)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <!-- Insights + prompts -->
    <div class="flex flex-col gap-4">
      <Card>
        <div class="flex items-center gap-2 border-b border-[hsl(var(--border))] px-5 py-4">
          <Lightbulb class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
          <h2 class="text-sm font-semibold">Insights</h2>
        </div>
        <div class="p-3">
          {#if advice.loading}
            <div class="space-y-2 p-2">
              {#each Array(2) as _, i (i)}<div class="h-12 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}
            </div>
          {:else if (advice.data?.items?.length ?? 0) > 0}
            <ul class="space-y-1">
              {#each (advice.data?.items ?? []).slice(0, 3) as item (item.id)}
                <li class="rounded-lg p-2.5 transition-colors hover:bg-[hsl(var(--accent))]">
                  <div class="flex items-start gap-2.5">
                    <span
                      class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style:background-color={item.priority === 'high' ? 'hsl(350 52% 55%)' : item.priority === 'medium' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))'}
                    ></span>
                    <div class="min-w-0">
                      <p class="text-sm font-medium leading-snug">{item.headline}</p>
                      <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{item.detail}</p>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="px-2 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Capture a few more transactions and insights will appear here.</p>
          {/if}
        </div>
      </Card>

      <!-- Recurring + anomaly context -->
      {#if (forecast.data?.forecast.anomalies?.length ?? 0) > 0}
        <Card>
          <div class="flex items-center gap-2 border-b border-[hsl(var(--border))] px-5 py-4">
            <CalendarClock class="h-4 w-4 text-[hsl(var(--primary))]" />
            <h2 class="text-sm font-semibold">{m.forecast.anomalies}</h2>
          </div>
          <ul class="p-3">
            {#each anomalies.slice(0, 3) as a (a.date)}
              <li class="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm">
                <span class="text-[hsl(var(--muted-foreground))]">{a.date.slice(5)}</span>
                <span class="font-medium tabular-nums">{formatCurrency(a.amount)}</span>
                <span class="text-xs text-[hsl(350_52%_55%)]">{a.reason}</span>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      <!-- Quick prompts -->
      <Card>
        <div class="flex items-center gap-2 border-b border-[hsl(var(--border))] px-5 py-4">
          <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
          <h2 class="text-sm font-semibold">{m.dashboard.quickPrompts}</h2>
        </div>
        <div class="grid grid-cols-1 gap-2 p-3">
          {#each promptCards as prompt (prompt)}
            <button
              type="button"
              onclick={() => ask(prompt)}
              class="group flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-sm transition-colors hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--accent))]"
            >
              <span>{prompt}</span>
              <ArrowRight class="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--primary))]" />
            </button>
          {/each}
        </div>
      </Card>
    </div>
  </section>
</div>
