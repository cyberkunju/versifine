<script lang="ts">
import { DropdownMenu as DM } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils/cn';

type Props = {
  onSelect?: () => void;
  class?: string;
  disabled?: boolean;
  children?: Snippet;
};

let { onSelect, class: className, disabled, children }: Props = $props();
</script>

<DM.Item
  onSelect={() => onSelect?.()}
  {disabled}
  class={cn(
    'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
    'focus:bg-[hsl(var(--accent))] focus:text-[hsl(var(--accent-foreground))]',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    className,
  )}
>
  {@render children?.()}
</DM.Item>
