<script lang="ts">
import type { HTMLTextareaAttributes } from 'svelte/elements';
import { cn } from '$lib/utils/cn';

type Props = HTMLTextareaAttributes & {
  class?: string;
  value?: string | undefined;
};

let { class: className, value = $bindable(), ...rest }: Props = $props();
</script>

<textarea
  bind:value
  class={cn(
    'flex min-h-[80px] w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm shadow-sm',
    'placeholder:text-[hsl(var(--muted-foreground))]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...rest}
></textarea>
