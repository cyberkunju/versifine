<script lang="ts">
  import { Tooltip as T } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = {
    /** Trigger snippet — typically a button or icon. */
    trigger: Snippet;
    /** Content snippet — the floating bubble. */
    content?: Snippet;
    text?: string;
    class?: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
  };

  let { trigger, content, text, class: className, side = 'top' }: Props = $props();
</script>

<T.Provider>
  <T.Root>
    <T.Trigger>{@render trigger()}</T.Trigger>
    <T.Portal>
      <T.Content
        sideOffset={6}
        {side}
        class={cn(
          'z-50 overflow-hidden rounded-md bg-[hsl(var(--foreground))] px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--background))] shadow-md',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out fade-in-0 zoom-in-95 fade-out-0 zoom-out-95',
          className,
        )}
      >
        {#if text}{text}{:else}{@render content?.()}{/if}
      </T.Content>
    </T.Portal>
  </T.Root>
</T.Provider>
