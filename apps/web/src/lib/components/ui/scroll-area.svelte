<script lang="ts">
  import { ScrollArea as SA } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<SA.Root class={cn('relative overflow-hidden', className)}>
  <SA.Viewport class="h-full w-full rounded-[inherit]">
    {@render children?.()}
  </SA.Viewport>
  <SA.Scrollbar
    orientation="vertical"
    class="flex touch-none select-none transition-colors p-px h-full w-2 border-l border-l-transparent"
  >
    <SA.Thumb class="relative flex-1 rounded-full bg-[hsl(var(--border))]" />
  </SA.Scrollbar>
  <SA.Corner />
</SA.Root>
