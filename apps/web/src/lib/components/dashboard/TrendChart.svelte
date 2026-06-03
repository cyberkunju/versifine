<script lang="ts">
/**
 * Six-month cashflow trend — the dashboard's hero chart.
 *
 * Grouped vertical bars per month: income (accent) beside expense (deep
 * navy), on a quiet baseline grid with compact ₹ ticks. Unlike a daily
 * line this never looks "broken" with sparse data — an empty month is
 * simply a short bar. Hover lifts a precise read-out (income, spend, net).
 * Pure SVG, theme-driven, responsive via viewBox.
 */
import { formatCurrency } from '$lib/utils/format';
import { compactINR } from '$lib/utils/dashboard';

type MonthPoint = { label: string; income: number; expense: number };
type Props = { months: MonthPoint[]; height?: number };
let { months, height = 248 }: Props = $props();

const W = 720;
const padL = 44;
const padR = 12;
const padT = 14;
const padB = 28;

let hover = $state<number | null>(null);

const model = $derived.by(() => {
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(1, months.length);
  const groupW = innerW / n;
  const max = Math.max(1, ...months.flatMap((d) => [d.income, d.expense]));
  // "nice" rounded ceiling for the axis.
  const niceMax = niceCeil(max);

  const yFor = (v: number) => padT + innerH - (v / niceMax) * innerH;
  const barW = Math.min(22, (groupW - 14) / 2);
  const gap = 4;

  const groups = months.map((d, i) => {
    const cx = padL + groupW * i + groupW / 2;
    return {
      i,
      label: d.label,
      income: d.income,
      expense: d.expense,
      net: d.income - d.expense,
      incomeBar: {
        x: cx - barW - gap / 2,
        y: yFor(d.income),
        h: padT + innerH - yFor(d.income),
        w: barW,
      },
      expenseBar: {
        x: cx + gap / 2,
        y: yFor(d.expense),
        h: padT + innerH - yFor(d.expense),
        w: barW,
      },
      cx,
    };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    v: niceMax * f,
    y: padT + innerH - f * innerH,
  }));

  return { groups, ticks, innerH, baseY: padT + innerH, groupW, niceMax };
});

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function onMove(e: PointerEvent, el: SVGSVGElement) {
  const rect = el.getBoundingClientRect();
  const rel = ((e.clientX - rect.left) / rect.width) * W - padL;
  const i = Math.floor(rel / model.groupW);
  hover = i >= 0 && i < months.length ? i : null;
}
</script>

<div class="relative w-full select-none">
  <svg
    viewBox={`0 0 ${W} ${height}`}
    class="h-auto w-full"
    role="img"
    aria-label="Income and expense over the last six months"
    onpointermove={(e) => onMove(e, e.currentTarget)}
    onpointerleave={() => (hover = null)}
  >
    <defs>
      <linearGradient id="tcExpense" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(var(--brand-navy))" />
        <stop offset="100%" stop-color="hsl(var(--brand-navy-deep))" />
      </linearGradient>
    </defs>

    <!-- Gridlines + y ticks -->
    {#each model.ticks as t (t.v)}
      <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="hsl(var(--border))" stroke-width="1" stroke-opacity="0.7" />
      <text x={padL - 8} y={t.y + 3} text-anchor="end" class="fill-[hsl(var(--muted-foreground))]" font-size="9">{compactINR(t.v)}</text>
    {/each}

    <!-- Bars -->
    {#each model.groups as g (g.i)}
      <g style:opacity={hover === null || hover === g.i ? 1 : 0.4} style="transition: opacity 120ms ease">
        <!-- income -->
        <rect x={g.incomeBar.x} y={g.incomeBar.y} width={g.incomeBar.w} height={Math.max(0, g.incomeBar.h)} rx="3" fill="hsl(160 42% 42%)" />
        <!-- expense -->
        <rect x={g.expenseBar.x} y={g.expenseBar.y} width={g.expenseBar.w} height={Math.max(0, g.expenseBar.h)} rx="3" fill="url(#tcExpense)" />
      </g>
      <text x={g.cx} y={height - 9} text-anchor="middle" class="fill-[hsl(var(--muted-foreground))]" font-size="10" font-weight={hover === g.i ? '600' : '400'}>{g.label}</text>
    {/each}
  </svg>

  <!-- Tooltip -->
  {#if hover !== null && model.groups[hover]}
    {@const g = model.groups[hover]!}
    <div
      class="pointer-events-none absolute top-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-3 py-2 text-xs shadow-lg"
      style:left={`clamp(0px, ${(g.cx / W) * 100}% - 64px, calc(100% - 132px))`}
    >
      <p class="mb-1 font-semibold text-[hsl(var(--foreground))]">{g.label}</p>
      <p class="flex items-center justify-between gap-4 text-[hsl(var(--muted-foreground))]"><span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm" style="background:hsl(160 42% 42%)"></span>Income</span><span class="font-medium tabular-nums text-[hsl(var(--foreground))]">{formatCurrency(g.income)}</span></p>
      <p class="flex items-center justify-between gap-4 text-[hsl(var(--muted-foreground))]"><span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-sm" style="background:hsl(var(--brand-navy))"></span>Spent</span><span class="font-medium tabular-nums text-[hsl(var(--foreground))]">{formatCurrency(g.expense)}</span></p>
      <p class="mt-1 flex items-center justify-between gap-4 border-t border-[hsl(var(--border))] pt-1 text-[hsl(var(--muted-foreground))]"><span>Net</span><span class="font-semibold tabular-nums" style:color={g.net >= 0 ? 'hsl(160 42% 36%)' : 'hsl(350 52% 52%)'}>{g.net >= 0 ? '+' : ''}{formatCurrency(g.net)}</span></p>
    </div>
  {/if}
</div>
