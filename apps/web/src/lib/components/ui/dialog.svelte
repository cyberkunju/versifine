<script lang="ts">
/**
 * Modal dialog. Pass `bind:open` from the parent and use `header`,
 * `description`, and `children` snippets to fill the body. The X button
 * top-right is wired to bits-ui's Close primitive.
 */
import { Dialog as D } from 'bits-ui';
import { X } from 'lucide-svelte';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils/cn';

type Props = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  class?: string;
  children?: Snippet;
  footer?: Snippet;
};

let {
  open = $bindable(),
  onOpenChange,
  title,
  description,
  class: className,
  children,
  footer,
}: Props = $props();
</script>

<D.Root bind:open onOpenChange={(v) => onOpenChange?.(v)}>
  <D.Portal>
    <D.Overlay
      class="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 backdrop-blur-sm"
    />
    <D.Content
      class={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 shadow-xl duration-200',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
    >
      {#if title || description}
        <div class="flex flex-col gap-1.5 text-left">
          {#if title}
            <D.Title class="text-base font-semibold leading-none tracking-tight">{title}</D.Title>
          {/if}
          {#if description}
            <D.Description class="text-sm text-[hsl(var(--muted-foreground))]">{description}</D.Description>
          {/if}
        </div>
      {/if}
      <div>{@render children?.()}</div>
      {#if footer}
        <div class="flex flex-row-reverse gap-2 pt-2">{@render footer()}</div>
      {/if}
      <D.Close class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-[hsl(var(--background))] transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-2">
        <X class="h-4 w-4" />
        <span class="sr-only">Close</span>
      </D.Close>
    </D.Content>
  </D.Portal>
</D.Root>
