<script lang="ts">
  /**
   * Spending-by-category breakdown: a single stacked "ribbon" bar showing
   * each category's share of total expense, paired with a ranked legend.
   * Hovering a legend row highlights its ribbon segment and vice-versa.
   * Colours come from the editorial category palette.
   */
  import { categoryColor, categoryIcon } from '$lib/utils/dashboard';
  import { formatCurrency } from '$lib/utils/format';

  type Row = { category: string; total: number };
  type Props = { rows: Row[]; max?: number };
  let { rows, max = 7 }: Props = $props();

  let hover = $state<string | null>(null);

  const model = $derived.by(() => {
    const sorted = [...rows].filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    const total = sorted.reduce((s, r) => s + r.total, 0) || 1;
    const head = sorted.slice(0, max);
    const restTotal = sorted.slice(max).reduce((s, r) => s + r.total, 0);
    const segments = head.map((r) => ({ ...r, share: (r.total / total) * 100 }));
    if (restTotal > 0) {
      segments.push({ category: 'Other', total: restTotal, share: (restTotal / total) * 100 });
    }
    return { segments, total };
  });
</script>

<div class="space-y-4">
  <!-- Ribbon -->
  <div class="flex h-3 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
    {#each model.segments as seg (seg.category)}
      <div
        class="h-full transition-[opacity,flex-basis] duration-300"
        style:flex-basis={`${seg.share}%`}
        style:background-color={categoryColor(seg.category)}
        style:opacity={hover === null || hover === seg.category ? 1 : 0.32}
        role="presentation"
        onpointerenter={() => (hover = seg.category)}
        onpointerleave={() => (hover = null)}
      ></div>
    {/each}
  </div>

  <!-- Legend -->
  <ul class="space-y-1.5">
    {#each model.segments as seg (seg.category)}
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[hsl(var(--accent))]"
          style:opacity={hover === null || hover === seg.category ? 1 : 0.5}
          onpointerenter={() => (hover = seg.category)}
          onpointerleave={() => (hover = null)}
        >
          <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style:background-color={categoryColor(seg.category)}></span>
          <span class="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <span aria-hidden="true" class="text-xs">{categoryIcon(seg.category)}</span>
            <span class="truncate">{seg.category}</span>
          </span>
          <span class="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{seg.share.toFixed(0)}%</span>
          <span class="w-20 text-right text-sm font-medium tabular-nums">{formatCurrency(seg.total)}</span>
        </button>
      </li>
    {/each}
  </ul>
</div>
