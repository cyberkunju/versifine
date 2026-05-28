<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';

  /**
   * Button styles. Mirrors the shadcn-svelte API but compiled to a single
   * Svelte component for less plumbing — `<Button variant="outline">`.
   */
  export const buttonVariants = tv({
    base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] disabled:pointer-events-none disabled:opacity-50',
    variants: {
      variant: {
        default:
          'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm hover:bg-[hsl(var(--primary)/0.9)]',
        secondary:
          'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--secondary)/0.8)]',
        outline:
          'border border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]',
        ghost:
          'hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]',
        destructive:
          'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] shadow-sm hover:bg-[hsl(var(--destructive)/0.9)]',
        link: 'text-[hsl(var(--primary))] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
  export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils/cn';

  type CommonProps = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    class?: string;
    children?: Snippet;
  };
  type Props =
    | (CommonProps & HTMLButtonAttributes & { href?: undefined })
    | (CommonProps & HTMLAnchorAttributes & { href: string });

  let {
    variant = 'default',
    size = 'default',
    class: className,
    href,
    children,
    ...rest
  }: Props = $props();
</script>

{#if href}
  <a
    {href}
    class={cn(buttonVariants({ variant, size }), className)}
    {...(rest as HTMLAnchorAttributes)}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    type={(rest as HTMLButtonAttributes).type ?? 'button'}
    class={cn(buttonVariants({ variant, size }), className)}
    {...(rest as HTMLButtonAttributes)}
  >
    {@render children?.()}
  </button>
{/if}
