<script lang="ts">
  /**
   * Dashboard — editorial command centre.
   *
   * A confident hero band (net worth headline + month income/spend/saved +
   * savings dial), a six-month income-vs-expense trend as the hero chart
   * (never looks broken with sparse data), then the working surfaces: a
   * recent-activity ledger, a ranked "top categories" spend-shape, a
   * refined 30-day forecast strip, a live budget rail, and insights. Leans
   * into the brand navy, bolder type, generous whitespace. Real API data
   * throughout; the month trend is assembled from six cached summaries.
   */
  import { fly } from 'svelte/transition';
  import {
    Sparkles, AlertTriangle, Lightbulb, ArrowRight, ArrowUpRight, ArrowDownLeft,
    ReceiptText, PieChart, TrendingUp,
  } from 'lucide-svelte';
  import type {
    AdviceEnvelope, BudgetSummary, ForecastResult, GoalSummary,
    ReportSummary, TransactionSummary, WalletSummary,
  } from '$lib/api/types';
  import { api } from '$lib/api/client';
  import { useQuery } from '$lib/api/queries.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { panels } from '$lib/stores/panels.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, relativeDate } from '$lib/utils/format';
  import { monthRange, categoryColor, categoryIcon, deltaPct } from '$lib/utils/dashboard';
  import { Card } from '$lib/components/ui';
  import Radial from '$lib/components/dashboard/Radial.svelte';
  import TrendChart from '$lib/components/dashboard/TrendChart.svelte';
  import ForecastStrip from '$lib/components/dashboard/ForecastStrip.svelte';

  const m = $derived(getMessages(settings.language));

  const now = new Date();
  const cur = monthRange(0);
  const prev = monthRange(1);
  const todayDay = now.getDate();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  /* ── Current + previous month summaries ────────────────────────────── */
  const summary = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', cur.from, cur.to],
    () => api.reports.summary({ from: cur.from, to: cur.to }),
  );
  const summaryPrev = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', prev.from, prev.to],
    () => api.reports.summary({ from: prev.from, to: prev.to }),
  );

  /* ── Six-month trend (assembled from cached monthly summaries) ─────── */
  const trendRanges = Array.from({ length: 6 }, (_, i) => monthRange(5 - i));
  let trend = $state<Array<{ label: string; income: number; expense: number }>>([]);
  let trendLoading = $state(true);
  $effect(() => {
    void (async () => {
      try {
        const out = await Promise.all(
          trendRanges.map(async (r) => {
            const { summary: s } = await api.reports.summary({ from: r.from, to: r.to });
            return {
              label: r.label.split(' ')[0]?.slice(0, 3) ?? '',
              income: s.totals.income,
              expense: s.totals.expense,
            };
          }),
        );
        trend = out;
      } catch {
        trend = [];
      } finally {
        trendLoading = false;
      }
    })();
  });

  const recentTxns = useQuery<{ items: TransactionSummary[] }>(
    ['transactions', 'recent', 7],
    () => api.transactions.list({ limit: 7 } as never),
  );
  const wallets = useQuery<{ wallets: WalletSummary[] }>(['wallets'], () => api.wallets.list());
  const forecast = useQuery<{ forecast: ForecastResult }>(['forecast', 30], () => api.forecast.get(30));
  const budgets = useQuery<{ budgets: BudgetSummary[] }>(['budgets'], () => api.budgets.list());
  const goals = useQuery<{ goals: GoalSummary[] }>(['goals', 'active'], () => api.goals.list('active'));
  const advice = useQuery<AdviceEnvelope>(['advice'], () => api.advice.get());

  /* ── Derived ───────────────────────────────────────────────────────── */
  const totals = $derived(summary.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });
  const prevTotals = $derived(summaryPrev.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });
  const liveWallets = $derived((wallets.data?.wallets ?? []).filter((w) => !w.archived));
  const netWorth = $derived(liveWallets.reduce((s, w) => s + w.balance, 0));
  const incomeDelta = $derived(deltaPct(totals.income, prevTotals.income));
  const expenseDelta = $derived(deltaPct(totals.expense, prevTotals.expense));

  const catRows = $derived.by(() => {
    const rows = (summary.data?.summary.byCategory ?? []).filter((r) => r.total > 0);
    const top = Math.max(1, rows[0]?.total ?? 1);
    const total = rows.reduce((s, r) => s + r.total, 0) || 1;
    return rows.slice(0, 5).map((r) => ({ ...r, bar: (r.total / top) * 100, share: (r.total / total) * 100 }));
  });

  const recent = $derived((recentTxns.data?.items ?? []).slice(0, 7));

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
        } catch { /* skip */ }
      }
      budgetRows = out.sort((a, b) => b.pct - a.pct).slice(0, 4);
    })();
  });

  const promptCards = $derived([
    m.dashboard.promptWhereDidMyMoneyGo,
    m.dashboard.promptOverspending,
    m.dashboard.promptForecast30,
  ]);

  function ask(p: string) { panels.openCopilot(p); }
  function statusColor(s: 'ok' | 'warn' | 'exceeded'): string {
    return s === 'exceeded' ? 'hsl(350 52% 55%)' : s === 'warn' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))';
  }
</script>

<div class="mx-auto flex max-w-[1200px] flex-col gap-6">
  <!-- ── Hero band (deep navy) ─────────────────────────────────────── -->
  <header class="relative overflow-hidden rounded-2xl bg-[hsl(var(--brand-navy-deep))] text-white shadow-[0_18px_50px_-24px_hsl(var(--brand-navy)/0.7)]">
    <!-- aurora wash -->
    <div aria-hidden="true" class="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full" style="background:radial-gradient(closest-side, hsl(242 87% 74% / 0.35), transparent 70%); filter:blur(28px);"></div>
    <div aria-hidden="true" class="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full" style="background:radial-gradient(closest-side, hsl(202 80% 56% / 0.2), transparent 70%); filter:blur(36px);"></div>

    <div class="relative grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-[1.7fr_1fr]">
      <div class="flex flex-col">
        <p class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-white/55">
          <span class="inline-block h-px w-6 bg-[hsl(var(--brand-gold))]"></span>
          {cur.label}{cur.isCurrent ? ` · day ${todayDay} of ${cur.daysInMonth}` : ''}
        </p>
        <h1 class="mt-2 font-display text-[20px] font-medium tracking-tight text-white/75">
          {greeting}{auth.user?.displayName ? `, ${auth.user.displayName.split(' ')[0]}` : ''}.
        </h1>

        <div class="mt-5">
          <p class="text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">{m.dashboard.netWorth}</p>
          <p class="mt-1 font-display text-[46px] font-semibold leading-none tracking-tight tabular-nums sm:text-[56px]">{formatCurrency(netWorth)}</p>
          <p class="mt-2 text-xs text-white/55">across {liveWallets.length} {liveWallets.length === 1 ? 'wallet' : 'wallets'}</p>
        </div>

        <dl class="mt-7 grid grid-cols-3 gap-x-4 border-t border-white/15 pt-5">
          <div>
            <dt class="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-white/55"><ArrowDownLeft class="h-3 w-3 text-[hsl(160_60%_70%)]" /> {m.reports.income}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.income)}</dd>
            {#if incomeDelta !== null}<dd class="text-[11px] tabular-nums text-white/55">{incomeDelta >= 0 ? '↑' : '↓'} {Math.abs(incomeDelta).toFixed(0)}% vs last</dd>{/if}
          </div>
          <div>
            <dt class="flex items-center gap-1 text-[11px] uppercase tracking-[0.1em] text-white/55"><ArrowUpRight class="h-3 w-3 text-[hsl(350_70%_72%)]" /> {m.reports.expense}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.expense)}</dd>
            {#if expenseDelta !== null}<dd class="text-[11px] tabular-nums text-white/55">{expenseDelta >= 0 ? '↑' : '↓'} {Math.abs(expenseDelta).toFixed(0)}% vs last</dd>{/if}
          </div>
          <div>
            <dt class="text-[11px] uppercase tracking-[0.1em] text-white/55">{m.reports.savings}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.savings)}</dd>
            <dd class="text-[11px] text-white/55">this month</dd>
          </div>
        </dl>
      </div>

      <div class="flex flex-col items-center justify-center gap-4 border-t border-white/15 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <Radial value={totals.savingsRate ?? 0} size={148} color="hsl(var(--brand-gold))" trackColor="hsl(0 0% 100% / 0.14)">
          <div>
            <p class="font-display text-[30px] font-semibold leading-none tabular-nums">{(totals.savingsRate ?? 0).toFixed(0)}<span class="text-base">%</span></p>
            <p class="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/55">saved</p>
          </div>
        </Radial>
        <button type="button" onclick={() => ask(m.dashboard.promptWhereDidMyMoneyGo)} class="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/20">
          <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" /> {m.nav.askCopilot}
        </button>
      </div>
    </div>
  </header>

  <!-- ── Hero chart: 6-month trend ─────────────────────────────────── -->
  <Card class="overflow-hidden">
    <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-4">
      <div class="flex items-center gap-2.5">
        <TrendingUp class="h-4 w-4 text-[hsl(var(--primary))]" />
        <div>
          <h2 class="text-sm font-semibold">Income vs spend</h2>
          <p class="text-xs text-[hsl(var(--muted-foreground))]">Last six months</p>
        </div>
      </div>
      <div class="flex items-center gap-4 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background:hsl(160 42% 42%)"></span>Income</span>
        <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--brand-navy))]"></span>Spend</span>
      </div>
    </div>
    <div class="p-6 pt-5">
      {#if trendLoading}
        <div class="h-[248px] w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
      {:else if trend.some((t) => t.income > 0 || t.expense > 0)}
        <TrendChart months={trend} />
      {:else}
        <div class="grid h-[248px] place-items-center text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</div>
      {/if}
    </div>
  </Card>

  <!-- ── Ledger + spend shape (the working surfaces) ───────────────── -->
  <section class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <!-- Recent transactions -->
    <Card>
      <div class="flex items-start justify-between px-6 py-5">
        <div>
          <p class="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Ledger</p>
          <h2 class="font-display text-lg font-semibold">{m.dashboard.recent}</h2>
        </div>
        <a href="/transactions" class="grid h-9 w-9 place-items-center rounded-lg text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--accent))]" aria-label="All transactions"><ReceiptText class="h-4 w-4" /></a>
      </div>
      <div class="px-6 pb-3">
        {#if recentTxns.loading}
          <div class="space-y-3 pb-3">{#each Array(5) as _, i (i)}<div class="h-11 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if recent.length === 0}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {:else}
          <ul class="divide-y divide-[hsl(var(--border))]">
            {#each recent as tx (tx.id)}
              <li class="flex items-center gap-3 py-3" in:fly={{ y: -4, duration: 200 }}>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style:background-color={categoryColor(tx.category, 0.1)}>
                  {#if tx.type === 'income'}<ArrowDownLeft class="h-4 w-4" style="color:hsl(160 42% 40%)" />{:else}<ArrowUpRight class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />{/if}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">{tx.description}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">{tx.category ?? 'Uncategorised'} · {relativeDate(tx.date)}</p>
                </div>
                <span class="text-sm font-semibold tabular-nums" style:color={tx.type === 'income' ? 'hsl(160 42% 36%)' : 'hsl(var(--foreground))'}>
                  {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatCurrency(tx.amount, tx.currency)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <!-- Top categories (spend shape) -->
    <Card>
      <div class="flex items-start justify-between px-6 py-5">
        <div>
          <p class="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Spend shape</p>
          <h2 class="font-display text-lg font-semibold">{m.dashboard.topCategories}</h2>
        </div>
        <a href="/reports" class="grid h-9 w-9 place-items-center rounded-lg text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--accent))]" aria-label="Reports"><PieChart class="h-4 w-4" /></a>
      </div>
      <div class="px-6 pb-6">
        {#if summary.loading}
          <div class="space-y-4">{#each Array(5) as _, i (i)}<div class="h-9 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if catRows.length > 0}
          <ul class="space-y-4">
            {#each catRows as row (row.category)}
              <li>
                <div class="mb-1.5 flex items-baseline justify-between">
                  <span class="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" class="text-xs">{categoryIcon(row.category)}</span>{row.category}</span>
                  <span class="text-sm font-semibold tabular-nums">{formatCurrency(row.total)}</span>
                </div>
                <div class="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div class="h-full rounded-full transition-[width] duration-700" style:width={`${row.bar}%`} style:background-color={categoryColor(row.category)}></div>
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {/if}
      </div>
    </Card>
  </section>

  <!-- ── Forecast + budgets + insights ─────────────────────────────── -->
  <section class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- Forecast -->
    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.forecast}</h2>
        <a href="/forecast" class="text-xs text-[hsl(var(--primary))] hover:underline">Detail</a>
      </div>
      <div class="p-5">
        {#if forecast.loading}
          <div class="h-[132px] w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
        {:else if forecast.data?.forecast.daily?.length}
          <ForecastStrip daily={forecast.data.forecast.daily} total={forecast.data.forecast.total} />
          <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-lg bg-[hsl(var(--muted))] px-3 py-2"><p class="text-[hsl(var(--muted-foreground))]">{m.forecast.recurring}</p><p class="font-semibold tabular-nums">{formatCurrency(forecast.data.forecast.recurringBase)}</p></div>
            <div class="rounded-lg bg-[hsl(var(--muted))] px-3 py-2"><p class="text-[hsl(var(--muted-foreground))]">{m.forecast.variable}</p><p class="font-semibold tabular-nums">{formatCurrency(forecast.data.forecast.variableTotal)}</p></div>
          </div>
        {:else}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.forecast.noData}</p>
        {/if}
      </div>
    </Card>

    <!-- Budgets -->
    <Card>
      <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <h2 class="text-sm font-semibold">{m.dashboard.budgetAlerts}</h2>
        <a href="/budgets" class="text-xs text-[hsl(var(--primary))] hover:underline">All</a>
      </div>
      <div class="p-5">
        {#if budgetRows.length === 0}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyAlerts}</p>
        {:else}
          <ul class="space-y-3.5">
            {#each budgetRows as b (b.id)}
              <li>
                <div class="mb-1 flex items-center justify-between text-sm">
                  <span class="flex items-center gap-1.5 truncate font-medium">{#if b.status === 'exceeded'}<AlertTriangle class="h-3.5 w-3.5 text-[hsl(350_52%_55%)]" />{/if}{b.name}</span>
                  <span class="tabular-nums text-[hsl(var(--muted-foreground))]">{formatCurrency(b.spent)} / {formatCurrency(b.allocated)}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div class="h-full rounded-full transition-[width] duration-500" style:width={`${Math.min(100, b.pct)}%`} style:background-color={statusColor(b.status)}></div></div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <!-- Insights / goals / prompts -->
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
                  <div class="min-w-0"><p class="text-sm font-medium leading-snug">{item.headline}</p><p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{item.detail}</p></div>
                </div>
              </li>
            {/each}
          </ul>
        {:else if (goals.data?.goals?.length ?? 0) > 0}
          <ul class="space-y-3 p-2">
            {#each (goals.data?.goals ?? []).slice(0, 3) as g (g.id)}
              <li>
                <div class="flex items-center justify-between text-sm"><span class="truncate">{g.name}</span><span class="tabular-nums text-[hsl(var(--muted-foreground))]">{g.progressPercentage.toFixed(0)}%</span></div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div class="h-full rounded-full bg-[hsl(var(--primary))]" style:width={`${Math.min(100, g.progressPercentage)}%`}></div></div>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="grid grid-cols-1 gap-2 p-2">
            {#each promptCards as prompt (prompt)}
              <button type="button" onclick={() => ask(prompt)} class="group flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-sm transition-colors hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--accent))]">
                <span>{prompt}</span><ArrowRight class="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--primary))]" />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </Card>
  </section>
</div>
