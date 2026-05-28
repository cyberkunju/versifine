<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<p class={cn('text-sm text-[hsl(var(--muted-foreground))]', className)}>
  {@render children?.()}
</p>
