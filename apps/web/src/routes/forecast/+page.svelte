<script lang="ts">
  /**
   * Forecast page.
   *
   * Big chart at the top, recurring items list, anomalies callout. The
   * forecast service is recurring-decomposed ARIMA (with rolling-average
   * fallback for sparse data) — we surface the `method` so the UI can be
   * honest when the model couldn't fit.
   */
  import { fly } from 'svelte/transition';
  import { TrendingUp, AlertTriangle, Repeat, RefreshCw } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import { useQuery, invalidate } from '$lib/api/queries.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, formatDate, relativeDate } from '$lib/utils/format';
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    Skeleton,
    Badge,
  } from '$lib/components/ui';
  import ForecastCard from '$lib/components/forecast/ForecastCard.svelte';
  import type { ForecastResult, RecurringItem } from '$lib/api/types';

  const m = $derived(getMessages(settings.language));

  let days = $state<7 | 14 | 30 | 60 | 90>(30);

  const forecast = useQuery<{ forecast: ForecastResult }>(
    ['forecast'],
    () => api.forecast.get(days),
    { staleMs: 60_000 },
  );
  $effect(() => {
    void days;
    forecast.refetch();
  });

  const recurring = useQuery<{ items: RecurringItem[] }>(
    ['recurring', 'active'],
    () => api.recurring.list('active'),
  );

  let runningDetector = $state(false);
  async function runDetector() {
    runningDetector = true;
    try {
      await api.recurring.run();
      invalidate(['recurring']);
      invalidate(['forecast']);
      toast.success('Recurring items refreshed');
    } catch (err) {
      toast.error('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      runningDetector = false;
    }
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{m.forecast.title}</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Where your money is heading next.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <select
        bind:value={days}
        class="h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
      >
        <option value={7}>Next 7 days</option>
        <option value={14}>Next 14 days</option>
        <option value={30}>Next 30 days</option>
        <option value={60}>Next 60 days</option>
        <option value={90}>Next 90 days</option>
      </select>
    </div>
  </header>

  {#if forecast.loading && !forecast.data}
    <Skeleton class="h-72 w-full" />
  {:else if !forecast.data || forecast.data.forecast.daily.length === 0}
    <Card>
      <CardContent class="grid place-items-center gap-2 p-12 text-center">
        <TrendingUp class="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.forecast.noData}</p>
      </CardContent>
    </Card>
  {:else}
    {@const f = forecast.data.forecast}
    <Card>
      <CardHeader class="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle class="text-base">Next {days} days</CardTitle>
          <p class="text-xs text-[hsl(var(--muted-foreground))]">
            {m.forecast.method}: {f.method === 'arima' ? 'ARIMA(1,1,1)' : 'rolling average'}
          </p>
        </div>
        <div class="text-right">
          <p class="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Total</p>
          <p class="text-2xl font-semibold tabular-nums">{formatCurrency(f.total)}</p>
        </div>
      </CardHeader>
      <CardContent>
        <ForecastCard daily={f.daily} height={260} />
        <div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">{m.forecast.recurring}</p>
            <p class="font-semibold tabular-nums">{formatCurrency(f.recurringBase)}</p>
          </div>
          <div>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">{m.forecast.variable}</p>
            <p class="font-semibold tabular-nums">{formatCurrency(f.variableTotal)}</p>
          </div>
          <div>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">Anomalies</p>
            <p class="font-semibold tabular-nums">{f.anomalies.length}</p>
          </div>
          <div>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">Method</p>
            <p class="font-semibold uppercase tracking-wide">{f.method}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <div class="grid gap-4 lg:grid-cols-3">
      <Card class="lg:col-span-2">
        <CardHeader class="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle class="text-base">Active recurring</CardTitle>
          <Button variant="outline" size="sm" onclick={runDetector} disabled={runningDetector}>
            <RefreshCw class="h-4 w-4 {runningDetector ? 'animate-spin' : ''}" />
            {runningDetector ? 'Detecting…' : 'Re-detect'}
          </Button>
        </CardHeader>
        <CardContent>
          {#if recurring.loading && !recurring.data}
            <Skeleton class="h-32 w-full" />
          {:else if (recurring.data?.items ?? []).length === 0}
            <p class="text-sm text-[hsl(var(--muted-foreground))]">
              No recurring items detected yet. Run the detector after a few months of data.
            </p>
          {:else}
            <ul class="divide-y divide-[hsl(var(--border))] text-sm">
              {#each recurring.data?.items ?? [] as r (r.id)}
                <li class="flex items-center justify-between py-2.5" in:fly={{ y: 4, duration: 200 }}>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium">{r.displayName}</p>
                    <p class="text-xs text-[hsl(var(--muted-foreground))]">
                      every {r.frequencyDays} days · next {r.nextExpectedDate ? relativeDate(r.nextExpectedDate) : '—'}
                    </p>
                  </div>
                  <div class="ml-3 text-right">
                    <p class="font-semibold tabular-nums">{formatCurrency(r.averageAmount, r.currency as never)}</p>
                    <Badge variant="outline" class="text-xs">conf {(r.confidence * 100).toFixed(0)}%</Badge>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="flex items-center gap-2 text-base">
            <AlertTriangle class="h-4 w-4 text-amber-500" />
            {m.forecast.anomalies}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {#if f.anomalies.length === 0}
            <p class="text-sm text-[hsl(var(--muted-foreground))]">
              No unusual days in the recent window.
            </p>
          {:else}
            <ul class="space-y-2 text-sm">
              {#each f.anomalies as a (a.date)}
                <li class="rounded-md border border-[hsl(var(--border))] p-3">
                  <div class="flex items-center justify-between">
                    <span class="font-medium">{formatDate(a.date)}</span>
                    <Badge variant="secondary" class="text-xs">z={a.z.toFixed(1)}</Badge>
                  </div>
                  <p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    {formatCurrency(a.amount)} · expected ~{formatCurrency(a.expected)}
                  </p>
                  {#if a.reason}
                    <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{a.reason}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}
</div>

{#if false}
  <Repeat />
{/if}
