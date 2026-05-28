<script lang="ts">
  import { Popover as P } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger: Snippet;
    content: Snippet;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'right' | 'bottom' | 'left';
    class?: string;
  };

  let {
    open = $bindable(),
    onOpenChange,
    trigger,
    content,
    align = 'center',
    side = 'bottom',
    class: className,
  }: Props = $props();
</script>

<P.Root bind:open onOpenChange={(v) => onOpenChange?.(v)}>
  <P.Trigger>{@render trigger()}</P.Trigger>
  <P.Portal>
    <P.Content
      sideOffset={8}
      {align}
      {side}
      class={cn(
        'z-50 w-72 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-4 text-[hsl(var(--popover-foreground))] shadow-md outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
    >
      {@render content()}
    </P.Content>
  </P.Portal>
</P.Root>
