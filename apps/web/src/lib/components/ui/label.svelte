<script lang="ts">
  import { Label as L } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = {
    class?: string;
    for?: string;
    children?: Snippet;
  };

  let { class: className, for: htmlFor, children }: Props = $props();
</script>

<L.Root for={htmlFor} class={cn('text-sm font-medium leading-none', className)}>
  {@render children?.()}
</L.Root>
