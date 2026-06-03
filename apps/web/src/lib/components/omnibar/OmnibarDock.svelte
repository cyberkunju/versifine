<script lang="ts">
/**
 * Floating omnibar dock.
 *
 * Anchors the capture omnibar to the bottom-centre of the viewport as a
 * raised, glassy pill that floats above the page — the app's persistent
 * "command line for money". It sits clear of the sidebar on desktop and
 * spans the safe area on mobile. The omnibar itself is unchanged; this is
 * purely the floating chrome around it.
 */
import Omnibar from './Omnibar.svelte';

type Props = {
  onOpenCopilot?: (initial?: string) => void;
};
let { onOpenCopilot }: Props = $props();
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:pl-[calc(var(--vf-sidebar,16rem)+2rem)] lg:pr-8">
  <div
    class="omnibar-dock-shell pointer-events-auto w-full max-w-[620px] rounded-[14px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_-2px_20px_rgba(0,0,0,0.08),0_4px_24px_rgba(18,26,140,0.12)] transition-shadow"
  >
    <Omnibar {onOpenCopilot} />
  </div>
</div>

<style>
  @property --vf-omni-border-angle {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }

  .omnibar-dock-shell {
    position: relative;
  }

  .omnibar-dock-shell::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: 15px;
    padding: 1.5px;
    background: conic-gradient(
      from var(--vf-omni-border-angle),
      transparent 0deg,
      transparent 220deg,
      hsl(var(--primary) / 0.08) 270deg,
      hsl(var(--primary) / 0.24) 300deg,
      hsl(var(--primary) / 0.08) 330deg,
      transparent 360deg
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    animation: omnibarBorderTrace 6s linear infinite;
  }

  @keyframes omnibarBorderTrace {
    to {
      --vf-omni-border-angle: 360deg;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .omnibar-dock-shell::before {
      animation: none;
    }
  }
</style>
