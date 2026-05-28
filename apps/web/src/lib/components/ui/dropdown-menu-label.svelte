<script lang="ts">
  import { DropdownMenu as DM } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<DM.GroupHeading
  class={cn('px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]', className)}
>
  {@render children?.()}
</DM.GroupHeading>
