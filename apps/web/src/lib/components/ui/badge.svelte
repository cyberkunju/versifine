<script lang="ts" module>
import { tv, type VariantProps } from 'tailwind-variants';

/** Color-coded chip — same variants as shadcn-svelte's Badge. */
export const badgeVariants = tv({
  base: 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  variants: {
    variant: {
      default: 'border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
      secondary:
        'border-transparent bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]',
      outline: 'text-[hsl(var(--foreground))] border-[hsl(var(--border))]',
      destructive:
        'border-transparent bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]',
      success: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      warning: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
    },
  },
  defaultVariants: { variant: 'default' },
});
export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Props = { variant?: BadgeVariant; class?: string; children?: Snippet };
  let { variant = 'default', class: className, children }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)}>
  {@render children?.()}
</span>
