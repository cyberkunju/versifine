<script lang="ts">
  /**
   * Dashboard — framed workspace home.
   *
   * A clean page header (greeting + dateline), a primary net-worth panel with
   * the savings radial, then bordered working cards: a 30-day forecast paired
   * with upcoming commitments, a six-month income-vs-spend trend, a recent
   * ledger + ranked spend shape, and budgets + insights. Real API data; the
   * trend is assembled from six cached monthly summaries.
   */
  import { fly } from 'svelte/transition';
  import type { Snippet } from 'svelte';
  import {
    Sparkles, AlertTriangle, Lightbulb, ArrowRight, ArrowUpRight, ArrowDownLeft,
    ReceiptText, PieChart, TrendingUp, CalendarClock, Wallet2,
  } from 'lucide-svelte';
  import type {
    AdviceEnvelope, BudgetSummary, ForecastResult, GoalSummary, RecurringItem,
    ReportSummary, TransactionSummary, WalletSummary,
  } from '$lib/api/types';
  import { api } from '$lib/api/client';
  import { useQuery } from '$lib/api/queries.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { panels } from '$lib/stores/panels.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, formatDate, relativeDate } from '$lib/utils/format';
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

  const summary = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', cur.from, cur.to],
    () => api.reports.summary({ from: cur.from, to: cur.to }),
  );
  const summaryPrev = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary', prev.from, prev.to],
    () => api.reports.summary({ from: prev.from, to: prev.to }),
  );

  /* Six-month trend assembled from cached monthly summaries. */
  const trendRanges = Array.from({ length: 6 }, (_, i) => monthRange(5 - i));
  let trend = $state<Array<{ label: string; income: number; expense: number }>>([]);
  let trendLoading = $state(true);
  $effect(() => {
    void (async () => {
      try {
        trend = await Promise.all(
          trendRanges.map(async (r) => {
            const { summary: s } = await api.reports.summary({ from: r.from, to: r.to });
            return { label: r.label.split(' ')[0]?.slice(0, 3) ?? '', income: s.totals.income, expense: s.totals.expense };
          }),
        );
      } catch { trend = []; } finally { trendLoading = false; }
    })();
  });

  const recentTxns = useQuery<{ items: TransactionSummary[] }>(
    ['transactions', 'recent', 6],
    () => api.transactions.list({ limit: 6 } as never),
  );
  const wallets = useQuery<{ wallets: WalletSummary[] }>(['wallets'], () => api.wallets.list());
  const forecast = useQuery<{ forecast: ForecastResult }>(['forecast', 30], () => api.forecast.get(30));
  const budgets = useQuery<{ budgets: BudgetSummary[] }>(['budgets'], () => api.budgets.list());
  const goals = useQuery<{ goals: GoalSummary[] }>(['goals', 'active'], () => api.goals.list('active'));
  const advice = useQuery<AdviceEnvelope>(['advice'], () => api.advice.get());
  const recurring = useQuery<{ items: RecurringItem[] }>(['recurring'], () => api.recurring.list('active'));

  const totals = $derived(summary.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });
  const prevTotals = $derived(summaryPrev.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 });
  const liveWallets = $derived((wallets.data?.wallets ?? []).filter((w) => !w.archived));
  const netWorth = $derived(liveWallets.reduce((s, w) => s + w.balance, 0));
  const incomeDelta = $derived(deltaPct(totals.income, prevTotals.income));
  const expenseDelta = $derived(deltaPct(totals.expense, prevTotals.expense));

  const catRows = $derived.by(() => {
    const rows = (summary.data?.summary.byCategory ?? []).filter((r) => r.total > 0);
    const top = Math.max(1, rows[0]?.total ?? 1);
    return rows.slice(0, 5).map((r) => ({ ...r, bar: (r.total / top) * 100 }));
  });
  const recent = $derived((recentTxns.data?.items ?? []).slice(0, 6));

  const upcoming = $derived.by(() => {
    const items = (recurring.data?.items ?? []).filter((i) => i.nextExpectedDate);
    return items
      .sort((a, b) => (a.nextExpectedDate ?? '').localeCompare(b.nextExpectedDate ?? ''))
      .slice(0, 4);
  });
  const upcomingTotal = $derived(upcoming.reduce((s, i) => s + i.averageAmount, 0));

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

  const promptCards = $derived([m.dashboard.promptWhereDidMyMoneyGo, m.dashboard.promptOverspending, m.dashboard.promptForecast30]);
  function ask(p: string) { panels.openCopilot(p); }
  function statusColor(s: 'ok' | 'warn' | 'exceeded'): string {
    return s === 'exceeded' ? 'hsl(350 52% 55%)' : s === 'warn' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))';
  }
  function freqLabel(days: number): string {
    if (days <= 1) return 'daily';
    if (days <= 9) return 'weekly';
    if (days <= 20) return 'fortnightly';
    if (days <= 45) return 'monthly';
    if (days <= 100) return 'quarterly';
    return 'yearly';
  }
</script>

<div class="mx-auto flex max-w-[1180px] flex-col gap-6">
  <!-- ── Page header ───────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="font-display text-2xl font-semibold tracking-tight text-[hsl(var(--brand-navy))]">
        {greeting}{auth.user?.displayName ? `, ${auth.user.displayName.split(' ')[0]}` : ''}
      </h1>
      <p class="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        Here's where your money stands · {cur.label}{cur.isCurrent ? ` · day ${todayDay} of ${cur.daysInMonth}` : ''}
      </p>
    </div>
    <button type="button" onclick={() => ask(m.dashboard.promptWhereDidMyMoneyGo)} class="group inline-flex items-center gap-2 rounded-full bg-[hsl(var(--brand-navy))] px-4 py-2 text-sm font-medium text-[hsl(var(--brand-paper))] shadow-sm transition-all hover:bg-[hsl(var(--brand-navy-deep))]">
      <Sparkles class="h-4 w-4 text-[hsl(var(--brand-gold))]" /> {m.nav.askCopilot}
    </button>
  </div>

  <!-- ── Net worth panel ───────────────────────────────────────────── -->
  <Card class="overflow-hidden">
    <div class="grid grid-cols-1 gap-6 p-6 sm:p-7 lg:grid-cols-[1.7fr_1fr]">
      <div class="flex flex-col">
        <p class="text-[11px] font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{m.dashboard.netWorth}</p>
        <p class="mt-1.5 font-display text-[clamp(2.75rem,5.5vw,3.75rem)] font-semibold leading-none tracking-tight tabular-nums text-[hsl(var(--brand-navy))]">{formatCurrency(netWorth)}</p>
        <p class="mt-2 text-xs text-[hsl(var(--muted-foreground))]">across {liveWallets.length} {liveWallets.length === 1 ? 'wallet' : 'wallets'}</p>

        <dl class="mt-6 grid grid-cols-3 divide-x divide-[hsl(var(--border))] border-t border-[hsl(var(--border))] pt-5">
          <div class="pr-4">
            <dt class="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]"><ArrowDownLeft class="h-3 w-3 text-[hsl(160_50%_42%)]" /> {m.reports.income}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.income)}</dd>
            {#if incomeDelta !== null}<dd class="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">{incomeDelta >= 0 ? '↑' : '↓'} {Math.abs(incomeDelta).toFixed(0)}% vs last</dd>{/if}
          </div>
          <div class="px-4">
            <dt class="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]"><ArrowUpRight class="h-3 w-3 text-[hsl(350_60%_55%)]" /> {m.reports.expense}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums">{formatCurrency(totals.expense)}</dd>
            {#if expenseDelta !== null}<dd class="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">{expenseDelta >= 0 ? '↑' : '↓'} {Math.abs(expenseDelta).toFixed(0)}% vs last</dd>{/if}
          </div>
          <div class="pl-4">
            <dt class="text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{m.reports.savings}</dt>
            <dd class="mt-1 font-display text-lg font-semibold tabular-nums text-[hsl(var(--brand-navy))]">{formatCurrency(totals.savings)}</dd>
            <dd class="text-[11px] text-[hsl(var(--muted-foreground))]">this month</dd>
          </div>
        </dl>
      </div>

      <div class="flex flex-col items-center justify-center gap-3 border-t border-[hsl(var(--border))] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <Radial value={totals.savingsRate ?? 0} size={140} color="hsl(var(--brand-navy))" trackColor="hsl(var(--brand-navy) / 0.1)">
          <div><p class="font-display text-[30px] font-semibold leading-none tabular-nums text-[hsl(var(--brand-navy))]">{(totals.savingsRate ?? 0).toFixed(0)}<span class="text-base">%</span></p><p class="mt-1 text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">saved</p></div>
        </Radial>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">of income kept this month</p>
      </div>
    </div>
  </Card>

  <!-- ── Forecast + commitments ────────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
    <Card class="p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        {@render cardHead(TrendingUp, '30-day forecast', 'Cash leaving the account')}
        {#if forecast.data?.forecast}
          <div class="flex gap-2">
            {@render statBox('Total', formatCurrency(Math.round(forecast.data.forecast.total)), true)}
            {@render statBox(m.forecast.recurring, formatCurrency(Math.round(forecast.data.forecast.recurringBase)), false)}
            {@render statBox(m.forecast.variable, formatCurrency(Math.round(forecast.data.forecast.variableTotal)), false)}
          </div>
        {/if}
      </div>
      <div class="mt-5">
        {#if forecast.loading}
          <div class="h-[150px] w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
        {:else if forecast.data?.forecast.daily?.length}
          <ForecastStrip daily={forecast.data.forecast.daily} total={forecast.data.forecast.total} height={150} />
        {:else}
          <p class="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.forecast.noData}</p>
        {/if}
      </div>
    </Card>

    <Card class="p-6">
      {@render cardHead(CalendarClock, 'Upcoming', 'Commitments')}
      <div class="mt-4">
        {#if recurring.loading}
          <div class="space-y-3">{#each Array(4) as _, i (i)}<div class="h-10 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if upcoming.length > 0}
          <ul class="divide-y divide-[hsl(var(--border))]">
            {#each upcoming as item (item.id)}
              <li class="flex items-center justify-between gap-3 py-2.5">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold">{item.displayName}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">{item.nextExpectedDate ? formatDate(item.nextExpectedDate) : ''} · {freqLabel(item.frequencyDays)}</p>
                </div>
                <span class="text-sm font-semibold tabular-nums">{formatCurrency(item.averageAmount, item.currency as never)}</span>
              </li>
            {/each}
          </ul>
          <div class="mt-3 flex items-center justify-between border-t border-[hsl(var(--border))] pt-3 text-sm">
            <span class="text-[hsl(var(--muted-foreground))]">Next ~30 days</span>
            <span class="font-semibold tabular-nums">{formatCurrency(Math.round(upcomingTotal))}</span>
          </div>
        {:else}
          <div class="grid place-items-center py-10 text-center">
            <Wallet2 class="mb-2 h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            <p class="text-sm text-[hsl(var(--muted-foreground))]">No recurring bills detected yet. They'll surface here as patterns emerge.</p>
          </div>
        {/if}
      </div>
    </Card>
  </section>

  <!-- ── Six-month trend ───────────────────────────────────────────── -->
  <Card class="overflow-hidden">
    <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-5">
      {@render cardHead(TrendingUp, 'Trend', 'Income vs spend')}
      <div class="flex items-center gap-4 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm" style="background:hsl(160 42% 42%)"></span>Income</span>
        <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--brand-navy))]"></span>Spend</span>
      </div>
    </div>
    <div class="px-6 py-5">
      {#if trendLoading}
        <div class="h-[210px] w-full animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
      {:else if trend.some((t) => t.income > 0 || t.expense > 0)}
        <TrendChart months={trend} height={210} />
      {:else}
        <div class="grid h-[210px] place-items-center text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</div>
      {/if}
    </div>
  </Card>

  <!-- ── Ledger + spend shape ──────────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <Card class="p-6">
      {@render cardHead(ReceiptText, 'Ledger', m.dashboard.recent, ledgerAction)}
      <div class="mt-3">
        {#if recentTxns.loading}
          <div class="space-y-3">{#each Array(5) as _, i (i)}<div class="h-11 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if recent.length === 0}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {:else}
          <ul class="divide-y divide-[hsl(var(--border))]">
            {#each recent as tx (tx.id)}
              <li class="flex items-center gap-3 py-2.5" in:fly={{ y: -4, duration: 200 }}>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style:background-color={categoryColor(tx.category, 0.1)}>
                  {#if tx.type === 'income'}<ArrowDownLeft class="h-4 w-4" style="color:hsl(160 42% 40%)" />{:else}<ArrowUpRight class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />{/if}
                </span>
                <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{tx.description}</p><p class="text-xs text-[hsl(var(--muted-foreground))]">{tx.category ?? 'Uncategorised'} · {relativeDate(tx.date)}</p></div>
                <span class="text-sm font-semibold tabular-nums" style:color={tx.type === 'income' ? 'hsl(160 42% 36%)' : 'hsl(var(--foreground))'}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatCurrency(tx.amount, tx.currency)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <Card class="p-6">
      {@render cardHead(PieChart, 'Spend shape', m.dashboard.topCategories, spendAction)}
      <div class="mt-4">
        {#if summary.loading}
          <div class="space-y-4">{#each Array(5) as _, i (i)}<div class="h-9 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if catRows.length > 0}
          <ul class="space-y-3.5">
            {#each catRows as row (row.category)}
              <li>
                <div class="mb-1.5 flex items-baseline justify-between">
                  <span class="flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true" class="text-xs">{categoryIcon(row.category)}</span>{row.category}</span>
                  <span class="text-sm font-semibold tabular-nums">{formatCurrency(row.total)}</span>
                </div>
                <div class="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div class="h-full rounded-full transition-[width] duration-700" style:width={`${row.bar}%`} style:background-color={categoryColor(row.category)}></div></div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyTransactions}</p>
        {/if}
      </div>
    </Card>
  </section>

  <!-- ── Budgets + insights ────────────────────────────────────────── -->
  <section class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <Card class="p-6">
      {@render cardHead(Wallet2, 'On budget', m.dashboard.budgetAlerts, budgetAction)}
      <div class="mt-4">
        {#if budgetRows.length === 0}
          <p class="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{m.dashboard.emptyAlerts}</p>
        {:else}
          <ul class="space-y-3.5">
            {#each budgetRows as b (b.id)}
              <li>
                <div class="mb-1 flex items-center justify-between text-sm">
                  <span class="flex items-center gap-1.5 truncate font-semibold">{#if b.status === 'exceeded'}<AlertTriangle class="h-3.5 w-3.5 text-[hsl(350_52%_55%)]" />{/if}{b.name}</span>
                  <span class="tabular-nums text-[hsl(var(--muted-foreground))]">{formatCurrency(b.spent)} / {formatCurrency(b.allocated)}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div class="h-full rounded-full transition-[width] duration-500" style:width={`${Math.min(100, b.pct)}%`} style:background-color={statusColor(b.status)}></div></div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <Card class="p-6">
      {@render cardHead(Lightbulb, 'For you', 'Insights')}
      <div class="mt-3">
        {#if advice.loading}
          <div class="space-y-2">{#each Array(2) as _, i (i)}<div class="h-12 w-full animate-pulse rounded bg-[hsl(var(--muted))]"></div>{/each}</div>
        {:else if (advice.data?.items?.length ?? 0) > 0}
          <ul class="space-y-1">
            {#each (advice.data?.items ?? []).slice(0, 3) as item (item.id)}
              <li class="-mx-2 rounded-lg p-2.5 transition-colors hover:bg-[hsl(var(--accent))]">
                <div class="flex items-start gap-2.5">
                  <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style:background-color={item.priority === 'high' ? 'hsl(350 52% 55%)' : item.priority === 'medium' ? 'hsl(38 70% 50%)' : 'hsl(var(--primary))'}></span>
                  <div class="min-w-0"><p class="text-sm font-medium leading-snug">{item.headline}</p><p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{item.detail}</p></div>
                </div>
              </li>
            {/each}
          </ul>
        {:else if (goals.data?.goals?.length ?? 0) > 0}
          <ul class="space-y-3">
            {#each (goals.data?.goals ?? []).slice(0, 3) as g (g.id)}
              <li>
                <div class="flex items-center justify-between text-sm"><span class="truncate font-medium">{g.name}</span><span class="tabular-nums text-[hsl(var(--muted-foreground))]">{g.progressPercentage.toFixed(0)}%</span></div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div class="h-full rounded-full bg-[hsl(var(--primary))]" style:width={`${Math.min(100, g.progressPercentage)}%`}></div></div>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="grid grid-cols-1 gap-2">
            {#each promptCards as prompt (prompt)}
              <button type="button" onclick={() => ask(prompt)} class="group flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-sm transition-colors hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--accent))]"><span>{prompt}</span><ArrowRight class="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5 group-hover:text-[hsl(var(--primary))]" /></button>
            {/each}
          </div>
        {/if}
      </div>
    </Card>
  </section>
</div>

{#snippet statBox(label: string, value: string, accent: boolean)}
  <div
    class="rounded-xl border px-3 py-2 text-right"
    style:border-color={accent ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--border))'}
    style:background-color={accent ? 'hsl(var(--primary) / 0.05)' : 'transparent'}
  >
    <p class="text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">{label}</p>
    <p class="font-display text-base font-semibold tabular-nums" style:color={accent ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'}>{value}</p>
  </div>
{/snippet}

{#snippet cardHead(Icon: typeof TrendingUp, eyebrow: string, title: string, action?: Snippet)}
  <div class="flex items-start justify-between gap-4">
    <div class="flex items-center gap-3">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]">
        <Icon class="h-[18px] w-[18px]" />
      </span>
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p>
        <h2 class="mt-0.5 font-display text-lg font-semibold tracking-tight text-[hsl(var(--brand-navy))]">{title}</h2>
      </div>
    </div>
    {#if action}{@render action()}{/if}
  </div>
{/snippet}

{#snippet ledgerAction()}
  <a href="/transactions" class="grid h-9 w-9 place-items-center rounded-lg text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--accent))]" aria-label="All transactions"><ReceiptText class="h-4 w-4" /></a>
{/snippet}

{#snippet spendAction()}
  <a href="/reports" class="grid h-9 w-9 place-items-center rounded-lg text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--accent))]" aria-label="Reports"><PieChart class="h-4 w-4" /></a>
{/snippet}

{#snippet budgetAction()}
  <a href="/budgets" class="text-xs font-medium text-[hsl(var(--primary))] hover:underline">All</a>
{/snippet}
