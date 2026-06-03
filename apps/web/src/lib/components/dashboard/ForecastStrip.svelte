<script lang="ts">
/**
 * Forecast strip — a refined, modern take on the 30-day outlook.
 *
 * A smooth cumulative-projection curve over the horizon with a soft
 * gradient fill and a confidence band, framed by a clean baseline and a
 * single end-label for the projected month-end total. Deliberately calmer
 * and more legible than the stock forecast card: no axis clutter, one
 * idea (where spend is heading) stated clearly.
 */
import type { ForecastDay } from '$lib/api/types';
import { compactINR } from '$lib/utils/dashboard';
import { formatCurrency } from '$lib/utils/format';

type Props = { daily: ForecastDay[]; total: number; height?: number };
let { daily, total, height = 132 }: Props = $props();

const W = 360;
const padX = 6;
const padT = 10;
const padB = 6;

const model = $derived.by(() => {
  if (daily.length === 0) return { line: '', area: '', band: '', endX: 0, endY: 0 };
  const innerW = W - padX * 2;
  const innerH = height - padT - padB;
  // Cumulative projected spend across the horizon.
  let acc = 0;
  const cum = daily.map((d) => (acc += d.recurring + d.variable));
  let accU = 0;
  const upper = daily.map((d) => (accU += d.recurring + d.upper));
  let accL = 0;
  const lower = daily.map((d) => (accL += d.recurring + d.lower));
  const max = Math.max(1, upper[upper.length - 1] ?? acc);
  const stepX = innerW / Math.max(1, daily.length - 1);
  const x = (i: number) => padX + i * stepX;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const pts = cum.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = smooth(pts);
  const area = `${line} L ${x(daily.length - 1)} ${padT + innerH} L ${x(0)} ${padT + innerH} Z`;
  const upPts = upper.map((v, i) => [x(i), y(v)] as [number, number]);
  const loPts = lower.map((v, i) => [x(i), y(v)] as [number, number]).reverse();
  const band = `${smooth(upPts)} L ${loPts.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z`;

  return { line, area, band, endX: x(daily.length - 1), endY: y(cum[cum.length - 1] ?? 0) };
});

function smooth(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]![0]} ${pts[0]![1]}`;
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
</script>

<div class="w-full">
  <svg viewBox={`0 0 ${W} ${height}`} class="h-auto w-full" role="img" aria-label="Projected spending over the next 30 days">
    <defs>
      <linearGradient id="fsArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(var(--brand-navy))" stop-opacity="0.22" />
        <stop offset="100%" stop-color="hsl(var(--brand-navy))" stop-opacity="0.01" />
      </linearGradient>
    </defs>
    {#if model.line}
      <path d={model.band} fill="hsl(var(--brand-navy) / 0.08)" />
      <path d={model.area} fill="url(#fsArea)" />
      <path d={model.line} fill="none" stroke="hsl(var(--brand-navy))" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx={model.endX} cy={model.endY} r="3" fill="hsl(var(--brand-navy))" stroke="white" stroke-width="1.5" />
    {/if}
  </svg>
  <div class="mt-2 flex items-center justify-between text-xs">
    <span class="text-[hsl(var(--muted-foreground))]">Next 30 days</span>
    <span class="font-semibold tabular-nums">≈ {formatCurrency(Math.round(total))}</span>
  </div>
</div>
