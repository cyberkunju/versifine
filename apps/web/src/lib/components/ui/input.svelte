<script lang="ts">
import type { HTMLInputAttributes } from 'svelte/elements';
import { cn } from '$lib/utils/cn';

type Props = HTMLInputAttributes & {
  class?: string;
  /** Bound value for two-way binding. */
  value?: string | number | undefined;
};

let { class: className, value = $bindable(), ...rest }: Props = $props();
</script>

<input
  bind:value
  class={cn(
    'flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-1 text-sm shadow-sm transition-colors',
    'placeholder:text-[hsl(var(--muted-foreground))]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'file:border-0 file:bg-transparent file:text-sm file:font-medium',
    className,
  )}
  {...rest}
/>
