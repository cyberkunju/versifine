<script lang="ts">
  /**
   * Month cashflow chart — the dashboard's centrepiece.
   *
   * Daily expense bars sit under a smooth cumulative-spend line, with a
   * dashed "even pace" guide (total ÷ days) so you instantly read whether
   * you're ahead of or behind a steady burn. Hover reveals a precise
   * read-out. Pure SVG, theme-driven colours, responsive via viewBox.
   */
  import type { DayBucket } from '$lib/utils/dashboard';
  import { compactINR } from '$lib/utils/dashboard';
  import { formatCurrency } from '$lib/utils/format';

  type Props = {
    buckets: DayBucket[];
    /** Today's day-of-month, for the "now" marker (current month only). */
    todayDay?: number | null;
    height?: number;
  };
  let { buckets, todayDay = null, height = 260 }: Props = $props();

  const W = 760;
  const padX = 8;
  const padTop = 16;
  const padBottom = 26;

  let hover = $state<number | null>(null);

  const model = $derived.by(() => {
    const n = buckets.length;
    const innerW = W - padX * 2;
    const innerH = height - padTop - padBottom;
    const slot = innerW / Math.max(1, n);

    // Cumulative line + peak scaling.
    let acc = 0;
    const cum = buckets.map((b) => (acc += b.expense));
    const totalSpend = acc;
    const maxDaily = Math.max(1, ...buckets.map((b) => b.expense));
    const maxCum = Math.max(1, totalSpend);

    const xFor = (i: number) => padX + slot * i + slot / 2;
    const yBar = (v: number) => padTop + innerH - (v / maxDaily) * (innerH * 0.62);
    const yCum = (v: number) => padTop + innerH - (v / maxCum) * innerH;

    const bars = buckets.map((b, i) => {
      const h = padTop + innerH - yBar(b.expense);
      return {
        x: padX + slot * i + slot * 0.18,
        w: slot * 0.64,
        y: yBar(b.expense),
        h: Math.max(b.expense > 0 ? 2 : 0, h),
        bucket: b,
        i,
      };
    });

    const cumPts = cum.map((v, i) => ({ x: xFor(i), y: yCum(v), v, i }));
    // Smooth cumulative path (Catmull-Rom → cubic bezier).
    const linePath = smoothPath(cumPts.map((p) => [p.x, p.y]));
    const areaPath = `${linePath} L ${cumPts[cumPts.length - 1]?.x ?? padX} ${padTop + innerH} L ${cumPts[0]?.x ?? padX} ${padTop + innerH} Z`;

    // Even-pace guide: a straight line from (day1, perDay) to (dayN, total).
    const paceEndY = yCum(totalSpend);
    const paceStartY = yCum(totalSpend / Math.max(1, n));

    return {
      slot, innerH, totalSpend, maxDaily, maxCum,
      bars, cumPts, linePath, areaPath,
      paceStartY, paceEndY,
      xFor, baseY: padTop + innerH,
    };
  });

  function smoothPath(pts: [number, number][]): string {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0]![0]} ${pts[0]![1]}`;
    let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[i + 2] ?? p2;
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  function onMove(e: PointerEvent, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((rel - padX) / model.slot);
    hover = i >= 0 && i < buckets.length ? i : null;
  }
</script>

<div class="relative w-full select-none">
  <svg
    viewBox={`0 0 ${W} ${height}`}
    class="h-auto w-full"
    role="img"
    aria-label="Daily and cumulative spending this month"
    onpointermove={(e) => onMove(e, e.currentTarget)}
    onpointerleave={() => (hover = null)}
  >
    <defs>
      <linearGradient id="cfArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0.16" />
        <stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- Even-pace guide -->
    {#if model.cumPts.length > 1}
      <line
        x1={model.cumPts[0]?.x} y1={model.paceStartY}
        x2={model.cumPts[model.cumPts.length - 1]?.x} y2={model.paceEndY}
        stroke="hsl(var(--muted-foreground))" stroke-opacity="0.35"
        stroke-width="1" stroke-dasharray="3 4"
      />
    {/if}

    <!-- Daily expense bars -->
    {#each model.bars as bar (bar.i)}
      <rect
        x={bar.x} y={bar.y} width={bar.w} height={bar.h}
        rx="1.5"
        fill={hover === bar.i ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.22)'}
        style="transition: fill 120ms ease"
      />
    {/each}

    <!-- Cumulative area + line -->
    <path d={model.areaPath} fill="url(#cfArea)" />
    <path
      d={model.linePath} fill="none"
      stroke="hsl(var(--primary))" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"
    />

    <!-- Today marker -->
    {#if todayDay && todayDay >= 1 && todayDay <= buckets.length}
      {@const tx = model.xFor(todayDay - 1)}
      <line x1={tx} y1={padTop} x2={tx} y2={model.baseY} stroke="hsl(var(--brand-gold))" stroke-width="1" stroke-opacity="0.7" />
    {/if}

    <!-- Hover guide + dot -->
    {#if hover !== null}
      {@const p = model.cumPts[hover]}
      {#if p}
        <line x1={p.x} y1={padTop} x2={p.x} y2={model.baseY} stroke="hsl(var(--foreground) / 0.25)" stroke-width="1" />
        <circle cx={p.x} cy={p.y} r="3.5" fill="hsl(var(--primary))" stroke="white" stroke-width="1.5" />
      {/if}
    {/if}
  </svg>

  <!-- Tooltip -->
  {#if hover !== null && buckets[hover]}
    {@const b = buckets[hover]!}
    {@const c = model.cumPts[hover]?.v ?? 0}
    <div
      class="pointer-events-none absolute top-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-3 py-2 text-xs shadow-lg"
      style:left={`clamp(0px, ${(model.xFor(hover) / W) * 100}% - 70px, calc(100% - 140px))`}
    >
      <p class="font-medium text-[hsl(var(--foreground))]">{b.date.slice(5)}</p>
      <p class="mt-0.5 text-[hsl(var(--muted-foreground))]">Spent <span class="font-semibold text-[hsl(var(--foreground))] tabular-nums">{formatCurrency(b.expense)}</span></p>
      <p class="text-[hsl(var(--muted-foreground))]">Running <span class="font-semibold text-[hsl(var(--foreground))] tabular-nums">{formatCurrency(c)}</span></p>
    </div>
  {/if}

  <!-- Axis ticks -->
  <div class="mt-1 flex items-center justify-between px-1 text-[10px] text-[hsl(var(--muted-foreground))]">
    <span>Day 1</span>
    <span class="tabular-nums">Total {compactINR(model.totalSpend)}</span>
    <span>Day {buckets.length}</span>
  </div>
</div>
