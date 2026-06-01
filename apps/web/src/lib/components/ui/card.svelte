<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils/cn';

  type Props = HTMLAttributes<HTMLDivElement> & {
    class?: string;
    children?: Snippet;
  };

  let { class: className, children, ...rest }: Props = $props();
</script>

<div
  class={cn(
    'rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-[0_1px_2px_rgba(18,26,140,0.04),0_12px_32px_-20px_rgba(18,26,140,0.25)] ring-1 ring-black/[0.02]',
    className,
  )}
  {...rest}
>
  {@render children?.()}
</div>
