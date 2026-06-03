<script lang="ts">
import { cn } from '$lib/utils/cn';
type Props = { class?: string };
let { class: className }: Props = $props();
</script>

<div
  class={cn('animate-pulse rounded-md bg-[hsl(var(--muted))]', className)}
  aria-hidden="true"
></div>
