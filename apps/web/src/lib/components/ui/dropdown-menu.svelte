<script lang="ts">
/**
 * Wrapper around bits-ui DropdownMenu that applies the shadcn skin.
 * Pass `trigger` and `content` snippets; `content` should compose
 * `<DropdownMenuItem>` children.
 */
import { DropdownMenu as DM } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils/cn';

type Props = {
  trigger: Snippet;
  content: Snippet;
  align?: 'start' | 'center' | 'end';
  class?: string;
};

let { trigger, content, align = 'end', class: className }: Props = $props();
</script>

<DM.Root>
  <DM.Trigger>{@render trigger()}</DM.Trigger>
  <DM.Portal>
    <DM.Content
      {align}
      sideOffset={8}
      class={cn(
        'z-50 min-w-[12rem] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1 text-[hsl(var(--popover-foreground))] shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
    >
      {@render content()}
    </DM.Content>
  </DM.Portal>
</DM.Root>
