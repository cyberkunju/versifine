<script lang="ts">
  /**
   * Reports page.
   *
   * Date-range picker with quick presets, summary tiles, breakdown
   * tables for categories and merchants, budget adherence list, and a
   * CSV export. The whole page is one `/reports/summary?from=&to=` call
   * to the API plus a follow-up CSV link.
   */
  import { fly } from 'svelte/transition';
  import { Calendar, Download, TrendingUp, TrendingDown, PiggyBank, Sparkles } from 'lucide-svelte';
  import { CATEGORY_META, type Category } from '@versifine/shared';
  import { api } from '$lib/api/client';
  import { useQuery } from '$lib/api/queries.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency } from '$lib/utils/format';
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    Input,
    Skeleton,
    Badge,
  } from '$lib/components/ui';
  import type { ReportSummary } from '$lib/api/types';

  const m = $derived(getMessages(settings.language));

  function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function endOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }
  function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  const today = new Date();
  let from = $state(iso(startOfMonth(today)));
  let to = $state(iso(today));

  const range = $derived({ from, to });
  const summary = useQuery<{ summary: ReportSummary }>(
    ['reports', 'summary'],
    () => api.reports.summary(range),
  );
  $effect(() => {
    void from;
    void to;
    summary.refetch();
  });

  function setPreset(preset: 'thisMonth' | 'lastMonth' | 'quarter' | 'year') {
    const now = new Date();
    if (preset === 'thisMonth') {
      from = iso(startOfMonth(now));
      to = iso(now);
    } else if (preset === 'lastMonth') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      from = iso(prev);
      to = iso(endOfMonth(prev));
    } else if (preset === 'quarter') {
      from = iso(daysAgo(90));
      to = iso(now);
    } else {
      from = iso(daysAgo(365));
      to = iso(now);
    }
  }

  async function exportCsv() {
    try {
      await api.reports.summaryCsv(range);
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  const totals = $derived(
    summary.data?.summary.totals ?? { income: 0, expense: 0, savings: 0, savingsRate: 0 },
  );
  const top = $derived(summary.data?.summary.byCategory.slice(0, 8) ?? []);
  const merchants = $derived(summary.data?.summary.byMerchant.slice(0, 8) ?? []);
  const adherence = $derived(summary.data?.summary.budgetAdherence ?? []);

  function pctOf(value: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.round((value / total) * 100));
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{m.reports.title}</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Roll-ups across any date range.
      </p>
    </div>
    <Button variant="outline" size="sm" onclick={exportCsv}>
      <Download class="h-4 w-4" />
      {m.reports.exportCsv}
    </Button>
  </header>

  <Card>
    <CardContent class="flex flex-wrap items-end gap-3 p-4">
      <div>
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="r-from">From</label>
        <Input id="r-from" type="date" bind:value={from} class="mt-1" />
      </div>
      <div>
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="r-to">To</label>
        <Input id="r-to" type="date" bind:value={to} class="mt-1" />
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onclick={() => setPreset('thisMonth')}>{m.reports.thisMonth}</Button>
        <Button variant="ghost" size="sm" onclick={() => setPreset('lastMonth')}>{m.reports.lastMonth}</Button>
        <Button variant="ghost" size="sm" onclick={() => setPreset('quarter')}>{m.reports.quarter}</Button>
        <Button variant="ghost" size="sm" onclick={() => setPreset('year')}>{m.reports.year}</Button>
      </div>
    </CardContent>
  </Card>

  {#if summary.loading && !summary.data}
    <div class="grid gap-4 sm:grid-cols-4">
      {#each Array(4) as _, i (i)}
        <Skeleton class="h-24 w-full" />
      {/each}
    </div>
  {:else}
    <div class="grid gap-4 sm:grid-cols-4">
      {@render Tile(m.reports.income, totals.income, TrendingUp, 'emerald')}
      {@render Tile(m.reports.expense, totals.expense, TrendingDown, 'rose')}
      {@render Tile(m.reports.savings, totals.savings, PiggyBank, 'violet')}
      {@render Tile(m.reports.savingsRate, totals.savingsRate, Sparkles, 'sky', '%')}
    </div>

    {#snippet Tile(label: string, value: number, Icon: typeof TrendingUp, tone: 'emerald' | 'rose' | 'violet' | 'sky', suffix: string = '')}
      <Card>
        <CardContent class="flex items-center justify-between p-5">
          <div class="space-y-1">
            <p class="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
            <p class="text-2xl font-semibold tabular-nums" in:fly={{ y: 4, duration: 200 }}>
              {suffix === '%' ? `${value.toFixed(0)}${suffix}` : formatCurrency(value)}
            </p>
          </div>
          <span class="grid h-10 w-10 place-items-center rounded-lg" style:background-color="hsl(var(--chart-1) / 0.12)">
            <Icon class="h-4 w-4 text-[hsl(var(--primary))]" />
          </span>
        </CardContent>
      </Card>
    {/snippet}

    <div class="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle class="text-base">{m.reports.byCategory}</CardTitle>
        </CardHeader>
        <CardContent>
          {#if top.length === 0}
            <p class="text-sm text-[hsl(var(--muted-foreground))]">No expenses in this range.</p>
          {:else}
            <ul class="space-y-2.5 text-sm">
              {#each top as row (row.category)}
                {@const meta = CATEGORY_META[row.category as Category]}
                <li>
                  <div class="mb-1 flex items-center justify-between">
                    <span class="inline-flex items-center gap-2">
                      <span aria-hidden="true">{meta?.icon ?? '•'}</span>
                      <span class="font-medium">{row.category}</span>
                    </span>
                    <span class="tabular-nums">{formatCurrency(row.total)}</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div
                      class="h-full bg-[hsl(var(--primary))] transition-all duration-500"
                      style:width="{pctOf(row.total, totals.expense)}%"
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
          <CardTitle class="text-base">{m.reports.topMerchants}</CardTitle>
        </CardHeader>
        <CardContent>
          {#if merchants.length === 0}
            <p class="text-sm text-[hsl(var(--muted-foreground))]">No merchants in this range.</p>
          {:else}
            <ul class="space-y-2 text-sm">
              {#each merchants as row, i (i)}
                <li class="flex items-center justify-between border-b border-[hsl(var(--border))] py-1.5 last:border-0">
                  <span class="truncate font-medium">{row.merchant}</span>
                  <span class="ml-2 tabular-nums">{formatCurrency(row.total)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </CardContent>
      </Card>
    </div>

    {#if adherence.length > 0}
      <Card>
        <CardHeader>
          <CardTitle class="text-base">{m.reports.budgetAdherence}</CardTitle>
        </CardHeader>
        <CardContent>
          <table class="w-full text-sm">
            <thead class="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
              <tr>
                <th class="py-2">Budget</th>
                <th class="py-2 text-right">Allocated</th>
                <th class="py-2 text-right">Spent</th>
                <th class="py-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {#each adherence as row (row.budgetId)}
                <tr class="border-b border-[hsl(var(--border))] last:border-0">
                  <td class="py-2 font-medium">{row.name}</td>
                  <td class="py-2 text-right tabular-nums">{formatCurrency(row.allocated)}</td>
                  <td class="py-2 text-right tabular-nums">{formatCurrency(row.spent)}</td>
                  <td class="py-2 text-right tabular-nums">
                    <Badge
                      variant="secondary"
                      class={row.percentage >= 100
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                        : row.percentage >= 80
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}
                    >
                      {row.percentage.toFixed(0)}%
                    </Badge>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </CardContent>
      </Card>
    {/if}
  {/if}
</div>

{#if false}
  <Calendar />
{/if}
