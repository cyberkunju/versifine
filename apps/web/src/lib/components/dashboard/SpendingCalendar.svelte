<script lang="ts">
  /**
   * Spending calendar — the dashboard's signature visual.
   *
   * A month laid out as a contributions-style grid: one rounded cell per
   * day, its fill intensity scaled to that day's spend. Unlike a line chart
   * this degrades gracefully — a single transaction lights one cell instead
   * of drawing a broken flat-then-spike line — and it reveals rhythm
   * (weekend clusters, payday spikes) at a glance. Mon-first weeks, today is
   * ringed in gold, upcoming days sit faint. Hover reveals the exact figure.
   */
  import type { DayBucket } from '$lib/utils/dashboard';
  import { formatCurrency } from '$lib/utils/format';

  type Props = {
    buckets: DayBucket[];
    /** Month start (used for weekday offset + labels). */
    monthStart: Date;
    /** Today's day-of-month when this is the live month, else null. */
    todayDay?: number | null;
  };
  let { buckets, monthStart, todayDay = null }: Props = $props();

  const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  let hover = $state<number | null>(null);

  const model = $derived.by(() => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
    const leadBlanks = (firstDow + 6) % 7; // Mon-first offset
    const maxSpend = Math.max(1, ...buckets.map((b) => b.expense));
    const cells: Array<{ blank: boolean; bucket?: DayBucket; level: number; isToday: boolean; isFuture: boolean }> = [];
    for (let i = 0; i < leadBlanks; i++) cells.push({ blank: true, level: 0, isToday: false, isFuture: false });
    for (const b of buckets) {
      const ratio = b.expense / maxSpend;
      const level = b.expense <= 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
      cells.push({
        blank: false,
        bucket: b,
        level,
        isToday: todayDay === b.day,
        isFuture: todayDay !== null && b.day > todayDay,
      });
    }
    // Trailing blanks to complete the final week row.
    while (cells.length % 7 !== 0) cells.push({ blank: true, level: 0, isToday: false, isFuture: false });
    return { cells, maxSpend };
  });

  function fill(level: number, isFuture: boolean): string {
    if (isFuture) return 'hsl(var(--muted) / 0.5)';
    switch (level) {
      case 4: return 'hsl(var(--primary) / 0.92)';
      case 3: return 'hsl(var(--primary) / 0.64)';
      case 2: return 'hsl(var(--primary) / 0.4)';
      case 1: return 'hsl(var(--primary) / 0.2)';
      default: return 'hsl(var(--muted))';
    }
  }
</script>

<div class="select-none">
  <!-- Weekday header -->
  <div class="mb-1.5 grid grid-cols-7 gap-1.5 px-0.5">
    {#each WEEKDAYS as d, i (i)}
      <span class="text-center text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{d}</span>
    {/each}
  </div>

  <!-- Day grid -->
  <div class="grid grid-cols-7 gap-1.5">
    {#each model.cells as cell, i (i)}
      {#if cell.blank}
        <div class="aspect-square"></div>
      {:else}
        <button
          type="button"
          class="group relative aspect-square rounded-[5px] transition-[transform,box-shadow] duration-150 hover:scale-[1.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          style:background-color={fill(cell.level, cell.isFuture)}
          style:box-shadow={cell.isToday ? '0 0 0 2px hsl(var(--brand-gold)), 0 0 0 3px hsl(var(--card))' : 'none'}
          style:animation-delay={`${i * 8}ms`}
          onpointerenter={() => (hover = cell.bucket?.day ?? null)}
          onpointerleave={() => (hover = null)}
          aria-label={cell.bucket ? `${cell.bucket.date}: ${formatCurrency(cell.bucket.expense)}` : ''}
        >
          <span
            class="absolute inset-0 grid place-items-center text-[10px] font-medium tabular-nums"
            style:color={cell.level >= 3 ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))'}
            style:opacity={cell.isFuture ? 0.4 : 0.85}
          >{cell.bucket?.day}</span>
        </button>
      {/if}
    {/each}
  </div>

  <!-- Legend -->
  <div class="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
    <span>Less</span>
    {#each [0, 1, 2, 3, 4] as lvl (lvl)}
      <span class="h-2.5 w-2.5 rounded-[3px]" style:background-color={fill(lvl, false)}></span>
    {/each}
    <span>More</span>
  </div>

  <!-- Hover read-out -->
  {#if hover !== null}
    {@const b = buckets[hover - 1]}
    {#if b}
      <p class="mt-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
        <span class="font-medium text-[hsl(var(--foreground))]">{b.date}</span>
        · {b.count} {b.count === 1 ? 'transaction' : 'transactions'}
        · spent <span class="font-semibold text-[hsl(var(--foreground))] tabular-nums">{formatCurrency(b.expense)}</span>
      </p>
    {/if}
  {/if}
</div>
