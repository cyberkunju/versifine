<script lang="ts">
  /**
   * Drag-drop / paste / file-picker wrapper. When a file lands, we hand it
   * back via `onPick`; the parent decides whether to upload or stash it.
   */
  import { ImagePlus } from 'lucide-svelte';

  type Props = { onPick: (file: File) => void };
  let { onPick }: Props = $props();

  let dragOver = $state(false);
  let inputEl: HTMLInputElement | undefined = $state(undefined);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) onPick(file);
  }

  function handleSelect(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file) onPick(file);
    target.value = '';
  }
</script>

<div
  class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-sm transition-colors"
  class:border-primary={dragOver}
  class:bg-accent={dragOver}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={handleDrop}
  role="region"
  aria-label="Drop a receipt image"
>
  <ImagePlus class="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
  <p class="text-[hsl(var(--muted-foreground))]">Drop a receipt here, or</p>
  <button
    type="button"
    class="rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs font-medium hover:bg-[hsl(var(--accent))]"
    onclick={() => inputEl?.click()}
  >
    Choose file
  </button>
  <input
    bind:this={inputEl}
    type="file"
    accept="image/*"
    capture="environment"
    class="sr-only"
    onchange={handleSelect}
  />
</div>
