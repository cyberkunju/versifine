<script lang="ts">
  import { DropdownMenu as DM } from 'bits-ui';
  import { cn } from '$lib/utils/cn';

  type Props = { class?: string };
  let { class: className }: Props = $props();
</script>

<DM.Separator class={cn('-mx-1 my-1 h-px bg-[hsl(var(--border))]', className)} />
