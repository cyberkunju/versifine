<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { class?: string; children?: Snippet };
  let { class: className, children }: Props = $props();
</script>

<div class={cn('relative w-full overflow-auto', className)}>
  <table class="w-full caption-bottom text-sm">
    {@render children?.()}
  </table>
</div>
