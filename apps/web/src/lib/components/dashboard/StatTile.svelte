<script lang="ts">
  /**
   * Hero metric tile. A label, a large tabular value, an optional
   * month-over-month delta chip, and an optional inline sparkline. Built to
   * sit four-across on the dashboard's top row. Deliberately restrained:
   * one accent, hairline borders, no gradients.
   */
  import type { ComponentType, SvelteComponent } from 'svelte';
  import { fade } from 'svelte/transition';

  type Props = {
    label: string;
    value: string;
    icon: ComponentType<SvelteComponent>;
    /** Month-over-month change, percent. null = no comparison shown. */
    delta?: number | null;
    /** For expense, a rise is "bad"; for income/savings a rise is "good". */
    goodWhenUp?: boolean;
    /** Optional sparkline values (e.g. cumulative spend). */
    spark?: number[];
    loading?: boolean;
    /** Footnote under the value, e.g. "of ₹40,000 income". */
    foot?: string;
  };
  let {
    label,
    value,
    icon,
    delta = null,
    goodWhenUp = true,
    spark = [],
    loading = false,
    foot,
  }: Props = $props();

  const Icon = $derived(icon);

  const sparkPath = $derived.by(() => {
    if (spark.length < 2) return '';
    const w = 96;
    const h = 28;
    const min = Math.min(...spark);
    const max = Math.max(...spark);
    const range = max - min || 1;
    const step = w / (spark.length - 1);
    return spark
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
      .join(' ');
  });

  const deltaTone = $derived.by(() => {
    if (delta === null || delta === 0) return 'neutral';
    const up = delta > 0;
    return up === goodWhenUp ? 'good' : 'bad';
  });
</script>

<div class="group relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm transition-shadow hover:shadow-md">
  <div class="flex items-start justify-between">
    <p class="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">{label}</p>
    <span class="grid h-8 w-8 place-items-center rounded-lg bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]">
      <Icon class="h-4 w-4" />
    </span>
  </div>

  <div class="mt-3 flex items-end justify-between gap-3">
    <div class="min-w-0">
      {#if loading}
        <div class="h-8 w-28 animate-pulse rounded bg-[hsl(var(--muted))]"></div>
      {:else}
        <p class="truncate text-[27px] font-semibold leading-none tracking-tight tabular-nums" in:fade={{ duration: 180 }}>{value}</p>
      {/if}
      <div class="mt-2 flex items-center gap-2">
        {#if delta !== null && !loading}
          <span
            class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
            class:text-emerald-700={deltaTone === 'good'}
            class:bg-emerald-500-10={deltaTone === 'good'}
            class:text-rose-700={deltaTone === 'bad'}
            class:text-[hsl(var(--muted-foreground))]={deltaTone === 'neutral'}
            style:background-color={deltaTone === 'good' ? 'hsl(160 38% 40% / 0.1)' : deltaTone === 'bad' ? 'hsl(350 52% 55% / 0.1)' : 'hsl(var(--muted))'}
          >
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'} {Math.abs(delta).toFixed(0)}%
          </span>
          <span class="text-[11px] text-[hsl(var(--muted-foreground))]">vs last month</span>
        {:else if foot && !loading}
          <span class="text-[11px] text-[hsl(var(--muted-foreground))]">{foot}</span>
        {/if}
      </div>
    </div>

    {#if spark.length >= 2 && !loading}
      <svg width="96" height="28" viewBox="0 0 96 28" class="shrink-0 overflow-visible" aria-hidden="true">
        <path d={sparkPath} fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.7" />
      </svg>
    {/if}
  </div>
</div>
