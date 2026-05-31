<script lang="ts">
  /**
   * Dashboard — "the morning read".
   *
   * An editorial command centre, not a card-grid template. A hero band
   * states net worth as the headline figure with the month's income/spend/
   * saved as supporting type and a savings dial. The signature visual is a
   * spending calendar (contributions-style heatmap) that reveals rhythm and
   * degrades gracefully with sparse data. Below: where money went (ranked),
   * a live budget rail, the forecast, recent activity, insights, and goals.
   * Every figure is real API data; the daily series is bucketed client-side.
   */
  import { fly } from 'svelte/transition';
  import {
    Sparkles,
    AlertTriangle,
    Lightbulb,
    ArrowRight,
    ArrowUpRight,
    ArrowDownLeft,
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
    categoryColor,
    categoryIcon,
    deltaPct,
  } from '$lib/utils/dashboard';
  import { Card } from '$lib/components/ui';
  import SpendingCalendar from '$lib/components/dashboard/SpendingCalendar.svelte';
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

  const liveWallets = $derived((wallets.data?.wallets ?? []).filter((w) => !w.archived));
  const netWorth = $derived(liveWallets.reduce((s, w) => s + w.balance, 0));

  const incomeDelta = $derived(deltaPct(totals.income, prevTotals.income));
  const expenseDelta = $derived(deltaPct(totals.expense, prevTotals.expense));

  const dayProgress = $derived(cur.isCurrent ? Math.round((todayDay / cur.daysInMonth) * 100) : 100);
  const avgPerDay = $derived(cur.isCurrent && todayDay > 0 ? totals.expense / todayDay : totals.expense / cur.daysInMonth);
  const projectedSpend = $derived(cur.isCurrent ? avgPerDay * cur.daysInMonth : totals.expense);
  const topCategory = $derived(summary.data?.summary.byCategory?.[0] ?? null);
  const biggestDay = $derived.by(() => {
    let best: { date: string; expense: number } | null = null;
    for (const b of buckets) if (!best || b.expense > best.expense) best = { date: b.date, expense: b.expense };
    return best && best.expense > 0 ? best : null;
  });

  const recent = $derived((monthTxns.data?.items ?? []).slice(0, 6));

  // "Where it went" — top categories with share of total.
  const catRows = $derived.by(() => {
    const rows = (summary.data?.summary.byCategory ?? []).filter((r) => r.total > 0);
    const total = rows.reduce((s, r) => s + r.total, 0) || 1;
    return rows.slice(0, 6).map((r) => ({ ...r, share: (r.total / total) * 100 }));
  });

  /* ── Budget rail ────────────────────────────────────────────────────── */
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
  ]);

  function ask(prompt: string) {
    panels.openCopilot(prompt);
  }
  function statusColor(s: 'ok' | 'warn' | 'exceeded'): string {
    return s === 'exceeded' ? 'hsl(350 52% 55%)' : s === 'warn' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))';
  }
</script>

<div class="mx-auto flex max-w-[1240px] flex-col gap-7">
  <!-- ── Hero band ─────────────────────────────────────────────────── -->
  <header class="relative overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
    <!-- faint mark wash -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full opacity-[0.05]"
      style="background: radial-gradient(closest-side, hsl(var(--primary)), transparent 70%);"
    ></div>

    <div class="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-[1.6fr_1fr]">
      <!-- Left: greeting + net worth headline + supporting stats -->
      <div class="flex flex-col">
        <p class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
          <span class="inline-block h-px w-6 bg-[hsl(var(--primary))]"></span>
          {cur.label}{cur.isCurrent ? ` · day ${todayDay} of ${cur.daysInMonth}` : ''}
        </p>
        <h1 class="mt-2 font-display text-[22px] font-medium tracking-tight text-[hsl(var(--muted-foreground))]">
          {greeting}{auth.user?.displayName ? `, ${auth.user.displayName.split(' ')[0]}` : ''}.
        </h1>

        <div class="mt-5">
          <p class="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{m.dashboard.netWorth}</p>
          <p class="mt-1 font-display text-[44px] font-semibold leading-none tracking-tight tabular-nums sm:text-[52px]">
            {formatCurrency(netWorth)}
          </p>
          <p class="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
            across {liveWallets.length} {liveWallets.length === 1 ? 'wallet' : 'wallets'}
          </p>
        </div>

        <!-- Inline supporting stats — no boxes, editorial rhythm -->
        <dl class="mt-6 grid grid-cols-3 gap-x-4 border-t border-[hsl(var(--border))] pt-5">
          <div>
            <dt class="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
              <ArrowDownLeft class="h-3 w-3 text-[hsl(160_38%_40%)]" /> {m.reports.income}
            </dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.income)}</dd>
            {#if incomeDelta !== null}
              <dd class="text-[11px] tabular-nums" style:color={incomeDelta >= 0 ? 'hsl(160 38% 38%)' : 'hsl(var(--muted-foreground))'}>
                {incomeDelta >= 0 ? '↑' : '↓'} {Math.abs(incomeDelta).toFixed(0)}% vs last
              </dd>
            {/if}
          </div>
          <div>
            <dt class="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
              <ArrowUpRight class="h-3 w-3 text-[hsl(350_52%_55%)]" /> {m.reports.expense}
            </dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.expense)}</dd>
            {#if expenseDelta !== null}
              <dd class="text-[11px] tabular-nums" style:color={expenseDelta > 0 ? 'hsl(350 52% 52%)' : 'hsl(160 38% 38%)'}>
                {expenseDelta >= 0 ? '↑' : '↓'} {Math.abs(expenseDelta).toFixed(0)}% vs last
              </dd>
            {/if}
          </div>
          <div>
            <dt class="text-[11px] uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">{m.reports.savings}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.savings)}</dd>
            <dd class="text-[11px] text-[hsl(var(--muted-foreground))]">this month</dd>
          </div>
        </dl>
      </div>

      <!-- Right: savings dial + ask -->
      <div class="flex flex-col items-center justify-center gap-4 border-t border-[hsl(var(--border))] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <Radial value={totals.savingsRate ?? 0} size={150}>
          <div>
            <p class="font-display text-[30px] font-semibold leading-none tabular-nums">{(totals.savingsRate ?? 0).toFixed(0)}<span class="text-base">%</span></p>
            <p class="mt-1 text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">saved</p>
          </div>
        </Radial>
        <button
          type="button"
          onclick={() => ask(m.dashboard.promptWhereDidMyMoneyGo)}
          class="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--brand-navy-deep))]"
        >
          <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
          {m.nav.askCopilot}
        </button>
      </div>
    </div>
  </header>

  <!-- ── Signature: spending calendar + month digest ───────────────── -->
  <section class="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
    <Card class="overflow-hidden">
      <div class="flex items-end justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <div>
          <h2 class="text-sm font-semibold">Spending rhythm</h2>
          <p class="text-xs text-[hsl(var(--muted-foreground))]">Every day this month, shaded by how much you spent</p>
        </div>
        {#if cur.isCurrent}
          <span class="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{dayProgress}% through</span>
        {/if}
      </div>
      <div class="p-5">
        {#if monthTxns.loading}
          <div class="h-56 w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
        {:else if buckets.length > 0}
          <SpendingCalendar {buckets} monthStart={cur.start} todayDay={cur.isCurrent ? todayDay : null} />
        {:else}
          <p class="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {/if}
      </div>
    </Card>

    <!-- Month digest -->
    <Card>
      <div class="border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">This month at a glance</h2>
      </div>
      <dl class="divide-y divide-[hsl(var(--border))] px-5">
        <div class="flex items-center justify-between py-3 text-sm">
          <dt class="text-[hsl(var(--muted-foreground))]">Average / day</dt>
          <dd class="font-medium tabular-nums">{formatCurrency(Math.round(avgPerDay))}</dd>
        </div>
        {#if cur.isCurrent}
          <div class="flex items-center justify-between py-3 text-sm">
            <dt class="text-[hsl(var(--muted-foreground))]">Projected month-end</dt>
            <dd class="font-medium tabular-nums">{formatCurrency(Math.round(projectedSpend))}</dd>
          </div>
        {/if}
        {#if topCategory}
          <div class="flex items-center justify-between py-3 text-sm">
            <dt class="text-[hsl(var(--muted-foreground))]">Top category</dt>
            <dd class="flex items-center gap-1.5 font-medium">
              <span aria-hidden="true" class="text-xs">{categoryIcon(topCategory.category)}</span>{topCategory.category}
            </dd>
          </div>
        {/if}
        {#if biggestDay}
          <div class="flex items-center justify-between py-3 text-sm">
            <dt class="text-[hsl(var(--muted-foreground))]">Biggest day</dt>
            <dd class="font-medium tabular-nums">{formatCurrency(biggestDay.expense)} · {biggestDay.date.slice(5)}</dd>
          </div>
        {/if}
        <div class="flex items-center justify-between py-3 text-sm">
          <dt class="text-[hsl(var(--muted-foreground))]">Transactions</dt>
          <dd class="font-medium tabular-nums">{summary.data?.summary.transactionCount ?? 0}</dd>
        </div>
      </dl>
    </Card>
  </section>

  <!-- ── Where it went + budgets ───────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">Where it went</h2>
        <a href="/reports" class="text-xs text-[hsl(var(--primary))] hover:underline">Reports</a>
      </div>
      <div class="p-5">
        {#if summary.loading}
          <div class="space-y-3">{#each Array(5) as _, i (i)}<div class="h-7 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if catRows.length > 0}
          <ul class="space-y-3.5">
            {#each catRows as row (row.category)}
              <li>
                <div class="mb-1 flex items-center justify-between text-sm">
                  <span class="flex items-center gap-2">
                    <span aria-hidden="true" class="text-xs">{categoryIcon(row.category)}</span>
                    <span class="font-medium">{row.category}</span>
                  </span>
                  <span class="tabular-nums">{formatCurrency(row.total)} <span class="text-xs text-[hsl(var(--muted-foreground))]">· {row.share.toFixed(0)}%</span></span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div class="h-full rounded-full transition-[width] duration-500" style:width={`${row.share}%`} style:background-color={categoryColor(row.category)}></div>
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {/if}
      </div>
    </Card>

    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.budgetAlerts}</h2>
        <a href="/budgets" class="text-xs text-[hsl(var(--primary))] hover:underline">All budgets</a>
      </div>
      <div class="p-5">
        {#if budgetRows.length === 0}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyAlerts}</p>
        {:else}
          <ul class="space-y-3.5">
            {#each budgetRows as b (b.id)}
              <li>
                <div class="mb-1 flex items-center justify-between text-sm">
                  <span class="flex items-center gap-1.5 truncate font-medium">
                    {#if b.status === 'exceeded'}<AlertTriangle class="h-3.5 w-3.5 text-[hsl(350_52%_55%)]" />{/if}
                    {b.name}
                  </span>
                  <span class="tabular-nums text-[hsl(var(--muted-foreground))]">{formatCurrency(b.spent)} / {formatCurrency(b.allocated)}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div class="h-full rounded-full transition-[width] duration-500" style:width={`${Math.min(100, b.pct)}%`} style:background-color={statusColor(b.status)}></div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>
  </section>

  <!-- ── Activity + side rail ──────────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.recent}</h2>
        <a href="/transactions" class="text-xs text-[hsl(var(--primary))] hover:underline">View all</a>
      </div>
      <div class="px-5 py-1">
        {#if monthTxns.loading}
          <div class="space-y-3 py-3">{#each Array(5) as _, i (i)}<div class="h-10 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if recent.length === 0}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {:else}
          <ul class="divide-y divide-[hsl(var(--border))]">
            {#each recent as tx (tx.id)}
              <li class="flex items-center gap-3 py-3" in:fly={{ y: -4, duration: 200 }}>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm" style:background-color={categoryColor(tx.category, 0.12)}>{categoryIcon(tx.category)}</span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{tx.description}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">{tx.category ?? 'Uncategorised'} · {relativeDate(tx.date)}</p>
                </div>
                <span
                  class="text-sm font-semibold tabular-nums"
                  style:color={tx.type === 'income' ? 'hsl(160 38% 36%)' : 'hsl(var(--foreground))'}
                >{tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatCurrency(tx.amount, tx.currency)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <div class="flex flex-col gap-5">
      <!-- Insights -->
      <Card>
        <div class="flex items-center gap-2 border-b border-[hsl(var(--border))] px-5 py-4">
          <Lightbulb class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
          <h2 class="text-sm font-semibold">Insights</h2>
        </div>
        <div class="p-3">
          {#if advice.loading}
            <div class="space-y-2 p-2">{#each Array(2) as _, i (i)}<div class="h-12 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
          {:else if (advice.data?.items?.length ?? 0) > 0}
            <ul class="space-y-1">
              {#each (advice.data?.items ?? []).slice(0, 3) as item (item.id)}
                <li class="rounded-lg p-2.5 transition-colors hover:bg-[hsl(var(--accent))]">
                  <div class="flex items-start gap-2.5">
                    <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style:background-color={item.priority === 'high' ? 'hsl(350 52% 55%)' : item.priority === 'medium' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))'}></span>
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

      <!-- Forecast compact -->
      <Card>
        <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
          <h2 class="text-sm font-semibold">{m.dashboard.forecast}</h2>
          <a href="/forecast" class="text-xs text-[hsl(var(--primary))] hover:underline">Detail</a>
        </div>
        <div class="p-5">
          {#if forecast.loading}
            <div class="h-32 w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
          {:else if forecast.data?.forecast.daily?.length}
            <ForecastCard daily={forecast.data.forecast.daily} height={120} />
            <div class="mt-3 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
              <span>{m.forecast.recurring} <span class="font-medium text-[hsl(var(--foreground))] tabular-nums">{formatCurrency(forecast.data.forecast.recurringBase)}</span></span>
              <span>{m.forecast.variable} <span class="font-medium text-[hsl(var(--foreground))] tabular-nums">{formatCurrency(forecast.data.forecast.variableTotal)}</span></span>
            </div>
          {:else}
            <p class="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.forecast.noData}</p>
          {/if}
        </div>
      </Card>

      <!-- Goals (only when present) -->
      {#if (goals.data?.goals?.length ?? 0) > 0}
        <Card>
          <div class="border-b border-[hsl(var(--border))] px-5 py-4"><h2 class="text-sm font-semibold">{m.goals.title}</h2></div>
          <ul class="space-y-3 p-5">
            {#each (goals.data?.goals ?? []).slice(0, 3) as g (g.id)}
              <li>
                <div class="flex items-center justify-between text-sm">
                  <span class="flex items-center gap-1.5 truncate">{g.name}{#if g.atRisk}<span class="rounded-full bg-[hsl(38_70%_50%/0.14)] px-1.5 py-px text-[10px] font-medium text-[hsl(38_70%_38%)]">at risk</span>{/if}</span>
                  <span class="tabular-nums text-[hsl(var(--muted-foreground))]">{g.progressPercentage.toFixed(0)}%</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div class="h-full rounded-full bg-[hsl(var(--primary))]" style:width={`${Math.min(100, g.progressPercentage)}%`}></div></div>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      <!-- Anomalies (only when present) -->
      {#if anomalies.length > 0}
        <Card>
          <div class="border-b border-[hsl(var(--border))] px-5 py-4"><h2 class="text-sm font-semibold">{m.forecast.anomalies}</h2></div>
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
            <button type="button" onclick={() => ask(prompt)} class="group flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-sm transition-colors hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--accent))]">
              <span>{prompt}</span>
              <ArrowRight class="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--primary))]" />
            </button>
          {/each}
        </div>
      </Card>
    </div>
  </section>
</div>
