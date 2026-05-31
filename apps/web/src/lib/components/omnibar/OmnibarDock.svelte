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
    class="pointer-events-auto w-full max-w-2xl rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.82)] p-2 shadow-[0_8px_40px_-12px_rgba(8,12,40,0.28)] ring-1 ring-black/[0.02] backdrop-blur-xl transition-shadow"
  >
    <Omnibar {onOpenCopilot} />
  </div>
</div>
