<script lang="ts">
  /**
   * Slide-in side panel. Built on bits-ui's Dialog primitive with a
   * different transform so the same a11y wiring (focus trap, esc, overlay)
   * applies. Used for the Copilot panel and the Transaction details drawer.
   */
  import { Dialog as D } from 'bits-ui';
  import { X } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Side = 'left' | 'right' | 'top' | 'bottom';
  type Props = {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    side?: Side;
    title?: string;
    description?: string;
    class?: string;
    children?: Snippet;
    /** Close button is shown by default; set to false to hide. */
    showClose?: boolean;
  };

  let {
    open = $bindable(),
    onOpenChange,
    side = 'right',
    title,
    description,
    class: className,
    children,
    showClose = true,
  }: Props = $props();

  const baseSide: Record<Side, string> = {
    right:
      'inset-y-0 right-0 h-full w-full max-w-md border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
    left:
      'inset-y-0 left-0 h-full w-full max-w-md border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
    top:
      'inset-x-0 top-0 h-auto border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
    bottom:
      'inset-x-0 bottom-0 h-auto border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  };
</script>

<D.Root bind:open onOpenChange={(v) => onOpenChange?.(v)}>
  <D.Portal>
    <D.Overlay
      class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <D.Content
      class={cn(
        'fixed z-50 flex flex-col gap-4 bg-[hsl(var(--background))] p-6 shadow-xl border-[hsl(var(--border))] transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300',
        baseSide[side],
        className,
      )}
    >
      {#if title || description}
        <div class="flex flex-col gap-1.5">
          {#if title}
            <D.Title class="text-lg font-semibold leading-none tracking-tight">{title}</D.Title>
          {/if}
          {#if description}
            <D.Description class="text-sm text-[hsl(var(--muted-foreground))]">{description}</D.Description>
          {/if}
        </div>
      {/if}
      {@render children?.()}
      {#if showClose}
        <D.Close class="absolute right-4 top-4 rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]">
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </D.Close>
      {/if}
    </D.Content>
  </D.Portal>
</D.Root>
