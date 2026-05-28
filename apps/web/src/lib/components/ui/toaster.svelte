<script lang="ts">
  /**
   * Renders the toast queue. Mount once near the root of the layout.
   * Toasts are absolutely positioned bottom-right and stack vertically.
   */
  import { fly } from 'svelte/transition';
  import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn } from '$lib/utils/cn';

  const variantClass = {
    info: 'border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))]',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    error: 'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100',
  } as const;

  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  } as const;
</script>

<div
  class="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
  aria-live="polite"
>
  {#each toast.items as item (item.id)}
    {@const I = Icon[item.variant]}
    <div
      class={cn(
        'pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border px-4 py-3 shadow-md backdrop-blur',
        variantClass[item.variant],
      )}
      role="status"
      in:fly={{ y: 12, duration: 220 }}
      out:fly={{ x: 60, duration: 200 }}
    >
      <I class="mt-0.5 h-4 w-4 shrink-0" />
      <div class="flex-1 text-sm">
        <p class="font-medium">{item.title}</p>
        {#if item.description}
          <p class="mt-0.5 text-xs opacity-80">{item.description}</p>
        {/if}
      </div>
      <button
        type="button"
        class="rounded-md p-1 opacity-60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        onclick={() => toast.dismiss(item.id)}
        aria-label="Dismiss"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  {/each}
</div>
