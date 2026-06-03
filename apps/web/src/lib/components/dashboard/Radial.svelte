<script lang="ts">
/**
 * Editorial arc gauge. A 270° track with a single value arc, rendered as
 * SVG strokes so it stays crisp at any size. Used for the savings-rate
 * dial. No labels baked in — the caller composes the centre content as a
 * slot so the gauge stays a pure visual primitive.
 */
import type { Snippet } from 'svelte';

type Props = {
  /** 0–100. Clamped. */
  value: number;
  size?: number;
  stroke?: number;
  /** Arc colour; defaults to the indigo primary. */
  color?: string;
  trackColor?: string;
  children?: Snippet;
};

let {
  value,
  size = 168,
  stroke = 12,
  color = 'hsl(var(--primary))',
  trackColor = 'hsl(var(--muted))',
  children,
}: Props = $props();

const SWEEP = 270; // degrees of the open arc
const START = 135; // start angle (bottom-left), going clockwise

const clamped = $derived(Math.max(0, Math.min(100, value)));
const r = $derived((size - stroke) / 2);
const cx = $derived(size / 2);
const cy = $derived(size / 2);
const circ = $derived(2 * Math.PI * r);
const trackLen = $derived((SWEEP / 360) * circ);
const valueLen = $derived((clamped / 100) * trackLen);

function polar(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
// Arc path for the full track (START → START+SWEEP clockwise).
const trackPath = $derived.by(() => {
  const s = polar(START);
  const e = polar(START + SWEEP);
  const large = SWEEP > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
});
</script>

<div class="relative inline-grid place-items-center" style:width={`${size}px`} style:height={`${size}px`}>
  <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="-rotate-0">
    <path
      d={trackPath}
      fill="none"
      stroke={trackColor}
      stroke-width={stroke}
      stroke-linecap="round"
    />
    <path
      d={trackPath}
      fill="none"
      stroke={color}
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={`${valueLen} ${circ}`}
      style="transition: stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1)"
    />
  </svg>
  <div class="absolute inset-0 grid place-items-center text-center">
    {@render children?.()}
  </div>
</div>
