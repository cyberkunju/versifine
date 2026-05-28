<script lang="ts">
  import { Tabs as T } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { class?: string; children?: Snippet };
  let { class: className, children, ...rest }: Props = $props();
</script>

<T.List
  class={cn(
    'inline-flex h-9 items-center justify-center rounded-lg bg-[hsl(var(--muted))] p-1 text-[hsl(var(--muted-foreground))]',
    className,
  )}
  {...rest}
>
  {@render children?.()}
</T.List>
