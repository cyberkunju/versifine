<script lang="ts">
/**
 * Hand-rolled SVG forecast chart. Two stacked layers (recurring + variable)
 * across the horizon, with a confidence band threading through. No chart
 * dep — Tailwind colour classes via inline `style` for the variable
 * confidence fill.
 */
import type { ForecastDay } from '$lib/api/types';
import { formatCurrency } from '$lib/utils/format';

type Props = {
  daily: ForecastDay[];
  height?: number;
  /** Show confidence band around the variable layer. */
  showBand?: boolean;
};
let { daily, height = 180, showBand = true }: Props = $props();

const width = 600;

type Computed = {
  points: {
    x: number;
    y: number;
    recY: number;
    lowerY: number;
    upperY: number;
    date: string;
    total: number;
  }[];
  bandPath: string;
  recurringPath: string;
  totalPath: string;
  yMax: number;
};

const computed = $derived.by<Computed>(() => {
  if (daily.length === 0) {
    return {
      points: [],
      bandPath: '',
      recurringPath: '',
      totalPath: '',
      yMax: 0,
    };
  }
  let max = 0;
  for (const d of daily) {
    const total = d.recurring + d.variable;
    if (total > max) max = total;
    if (d.upper > max) max = d.upper;
  }
  if (max === 0) max = 1;
  const stepX = width / Math.max(1, daily.length - 1);
  const pad = 12;
  const usable = height - pad * 2;
  const yFor = (value: number) => pad + (1 - value / max) * usable;
  const points = daily.map((d, i) => ({
    x: i * stepX,
    y: yFor(d.recurring + d.variable),
    recY: yFor(d.recurring),
    lowerY: yFor(d.lower),
    upperY: yFor(d.upper),
    date: d.date,
    total: d.recurring + d.variable,
  }));
  const totalPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const recurringPath =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.recY}`).join(' ') +
    ` L${width},${height - pad} L0,${height - pad} Z`;
  const upperPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.upperY}`).join(' ');
  const lowerPath = [...points]
    .reverse()
    .map((p) => `L${p.x},${p.lowerY}`)
    .join(' ');
  const bandPath = `${upperPath} ${lowerPath} Z`;
  return { points, bandPath, recurringPath, totalPath, yMax: max };
});
</script>

<div class="relative w-full">
  <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" class="h-full w-full">
    <defs>
      <linearGradient id="rec" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(var(--primary))" stop-opacity="0.4" />
        <stop offset="100%" stop-color="hsl(var(--primary))" stop-opacity="0" />
      </linearGradient>
    </defs>
    {#if computed.points.length > 0}
      <path d={computed.recurringPath} fill="url(#rec)" />
      {#if showBand}
        <path d={computed.bandPath} fill="hsl(var(--chart-1) / 0.18)" />
      {/if}
      <path
        d={computed.totalPath}
        fill="none"
        stroke="hsl(var(--chart-1))"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    {/if}
  </svg>
  {#if computed.points.length > 0}
    <div class="mt-2 flex items-center justify-between text-[10px] text-[hsl(var(--muted-foreground))]">
      <span>{computed.points[0]?.date.slice(5)}</span>
      <span class="text-[11px]">peak {formatCurrency(computed.yMax)}</span>
      <span>{computed.points[computed.points.length - 1]?.date.slice(5)}</span>
    </div>
  {/if}
</div>
