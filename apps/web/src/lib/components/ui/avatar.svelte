<script lang="ts">
  import { Avatar as A } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = {
    class?: string;
    src?: string;
    alt?: string;
    fallback?: Snippet;
  };

  let { class: className, src, alt, fallback }: Props = $props();
</script>

<A.Root
  class={cn(
    'relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[hsl(var(--muted))]',
    className,
  )}
>
  {#if src}
    <A.Image {src} {alt} class="aspect-square h-full w-full" />
  {/if}
  <A.Fallback class="flex h-full w-full items-center justify-center text-xs font-medium uppercase text-[hsl(var(--muted-foreground))]">
    {@render fallback?.()}
  </A.Fallback>
</A.Root>
