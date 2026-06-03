<script lang="ts">
/**
 * Bottom drawer (mobile sheet). Reuses Sheet with `side="bottom"` for
 * consistency. Exists as a separate name because the desktop variant is
 * nice in some flows where Sheet feels too heavyweight.
 */
import type { Snippet } from 'svelte';
import Sheet from './sheet.svelte';

type Props = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  class?: string;
  children?: Snippet;
};

let {
  open = $bindable(),
  onOpenChange,
  title,
  description,
  class: className,
  children,
}: Props = $props();
</script>

<Sheet bind:open {onOpenChange} side="bottom" {title} {description} class={className}>
  {@render children?.()}
</Sheet>
