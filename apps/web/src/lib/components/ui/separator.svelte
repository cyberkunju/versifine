<script lang="ts">
import { cn } from '$lib/utils/cn';

type Props = {
  class?: string;
  orientation?: 'horizontal' | 'vertical';
};
let { class: className, orientation = 'horizontal' }: Props = $props();
</script>

<div
  role="separator"
  aria-orientation={orientation}
  class={cn(
    'shrink-0 bg-[hsl(var(--border))]',
    orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
    className,
  )}
></div>
