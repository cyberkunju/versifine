<script lang="ts">
  import { Tabs as T } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { value: string; class?: string; children?: Snippet; disabled?: boolean };
  let { class: className, children, value, disabled }: Props = $props();
</script>

<T.Trigger
  {value}
  {disabled}
  class={cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-[hsl(var(--background))] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    'data-[state=active]:bg-[hsl(var(--background))] data-[state=active]:text-[hsl(var(--foreground))] data-[state=active]:shadow',
    className,
  )}
>
  {@render children?.()}
</T.Trigger>
