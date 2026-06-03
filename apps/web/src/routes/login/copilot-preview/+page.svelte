<script lang="ts">
import { Send, Sparkles } from 'lucide-svelte';
import CopilotPanel from '$lib/components/copilot/CopilotPanel.svelte';
import { Button } from '$lib/components/ui';

let open = $state(false);
let seed = $state<string | null>(null);
let value = $state('How much did I spend on food this month?');

function submit() {
  const text = value.trim();
  if (!text) return;
  seed = text;
  open = true;
  value = '';
}
</script>

<main class="min-h-screen overflow-hidden bg-[hsl(var(--background))]">
  <section class="grid min-h-screen place-items-center px-6 pb-40 text-center">
    <div class="max-w-xl">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--primary))]">Preview mode</p>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))] sm:text-4xl">
        Type in the omnibar below.
      </h1>
      <p class="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        Press send and the chat grows upward from the dock. Use the top-right control to maximize it.
      </p>
    </div>
  </section>

  {#if !open}
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div class="omnibar-preview-shell pointer-events-auto w-full max-w-[620px] rounded-[14px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_-2px_20px_rgba(0,0,0,0.08),0_4px_24px_rgba(18,26,140,0.12)]">
        <form
          class="flex min-h-[3.25rem] w-full items-center gap-3 rounded-[14px] px-[1.125rem] py-[0.875rem]"
          onsubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_10px_24px_-14px_hsl(var(--primary))]">
            <Sparkles class="h-4 w-4" />
          </span>
          <input
            bind:value
            type="text"
            aria-label="Preview omnibar"
            class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-[hsl(var(--foreground))] shadow-none outline-none placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none"
            placeholder="Ask Vivien anything..."
          />
          <Button
            type="submit"
            size="icon"
            disabled={!value.trim()}
            aria-label="Submit preview omnibar"
            class="h-8 w-8 rounded-lg border border-[hsl(var(--border))] bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"
          >
            <Send class="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  {/if}

  <CopilotPanel bind:open onOpenChange={(value) => (open = value)} {seed} />
</main>

<style>
  @property --vf-preview-border-angle {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }

  .omnibar-preview-shell {
    position: relative;
  }

  .omnibar-preview-shell::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: 15px;
    padding: 1.5px;
    background: conic-gradient(
      from var(--vf-preview-border-angle),
      transparent 0deg,
      transparent 220deg,
      hsl(var(--primary) / 0.08) 270deg,
      hsl(var(--primary) / 0.24) 300deg,
      hsl(var(--primary) / 0.08) 330deg,
      transparent 360deg
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    animation: previewBorderTrace 6s linear infinite;
  }

  @keyframes previewBorderTrace {
    to {
      --vf-preview-border-angle: 360deg;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .omnibar-preview-shell::before {
      animation: none;
    }
  }
</style>
