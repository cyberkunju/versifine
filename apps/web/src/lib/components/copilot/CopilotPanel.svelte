<script lang="ts">
/**
 * Omnibar-born copilot chat. The compact panel grows upward from the bottom
 * dock, then can expand into a near-fullscreen floating workspace.
 */
import { onDestroy, onMount } from 'svelte';
import { Maximize2, Minimize2, Sparkles, Send, X } from 'lucide-svelte';
import { auth } from '$lib/stores/auth.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { getMessages } from '$lib/i18n';
import { Button } from '$lib/components/ui';
import { cn } from '$lib/utils/cn';
import MessageBubble, { type ToolEvent } from './MessageBubble.svelte';
import type { CopilotMessage } from '$lib/api/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional prefilled prompt set when the omnibar dispatches a chat intent. */
  seed?: string | null;
};

let { open = $bindable(), onOpenChange, seed = null }: Props = $props();

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  toolEvents: ToolEvent[];
};

const m = $derived(getMessages(settings.language));
let messages = $state<ChatMessage[]>([]);
let draft = $state<ChatMessage | null>(null);
let input = $state('');
let streaming = $state(false);
let maximized = $state(false);
let abort: AbortController | null = null;
let scrollEl: HTMLDivElement | undefined = $state(undefined);
let nextId = 1;
let appliedSeed: string | null = null;

$effect(() => {
  if (!open) {
    maximized = false;
    appliedSeed = null;
    return;
  }
  if (seed && seed !== appliedSeed && !streaming) {
    input = seed;
    appliedSeed = seed;
    queueMicrotask(() => void send(seed));
  }
});

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open) {
    event.preventDefault();
    close();
  }
}

onMount(() => {
  window.addEventListener('keydown', handleWindowKeydown);
});

onDestroy(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
});

function scrollToBottom() {
  queueMicrotask(() => {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
}

function quickPrompt(text: string) {
  input = text;
  void send();
}

async function send(textOverride?: string) {
  const text = (textOverride ?? input).trim();
  if (!text || streaming) return;
  input = '';
  const user: ChatMessage = { id: nextId++, role: 'user', content: text, toolEvents: [] };
  messages = [...messages, user];
  draft = { id: nextId++, role: 'assistant', content: '', toolEvents: [] };
  streaming = true;
  scrollToBottom();

  abort?.abort();
  abort = new AbortController();

  const wireMessages: CopilotMessage[] = messages
    .filter((mm) => mm.role !== 'assistant' || mm.content.trim().length > 0)
    .map((mm) => ({ role: mm.role, content: mm.content }));
  wireMessages.push({ role: 'user', content: text });

  try {
    const res = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: auth.accessToken ? `Bearer ${auth.accessToken}` : '',
      },
      body: JSON.stringify({ messages: wireMessages }),
      signal: abort.signal,
    });

    if (!res.ok || !res.body) {
      if (draft) draft.content = m.copilot.error;
      finalizeDraft();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() ?? '';
      for (const block of events) {
        handleEvent(block);
      }
    }
  } catch (err) {
    if (draft && (err as Error)?.name !== 'AbortError') {
      draft.content = m.copilot.error;
    }
  } finally {
    finalizeDraft();
  }
}

function handleEvent(block: string) {
  const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return;
  const json = dataLine.replace(/^data:\s*/, '');
  if (!json) return;
  let parsed: { type?: string; [k: string]: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  if (!draft) return;
  switch (parsed.type) {
    case 'chunk':
      draft.content += String(parsed.delta ?? '');
      scrollToBottom();
      break;
    case 'tool_call':
      draft.toolEvents = [
        ...draft.toolEvents,
        { name: String(parsed.name ?? ''), args: parsed.args as string | undefined },
      ];
      break;
    case 'tool_result': {
      const idx = draft.toolEvents.findLastIndex(
        (e) => e.name === parsed.name && e.result === undefined,
      );
      if (idx >= 0) {
        draft.toolEvents = draft.toolEvents.map((e, i) =>
          i === idx ? { ...e, result: parsed.result } : e,
        );
      } else {
        draft.toolEvents = [
          ...draft.toolEvents,
          { name: String(parsed.name ?? ''), result: parsed.result },
        ];
      }
      break;
    }
    case 'done':
      finalizeDraft();
      break;
    case 'error':
      draft.content += `\n\n${m.copilot.error}`;
      break;
  }
}

function finalizeDraft() {
  if (draft) {
    messages = [...messages, draft];
    draft = null;
  }
  streaming = false;
  abort = null;
  scrollToBottom();
}

function close() {
  abort?.abort();
  onOpenChange(false);
}
</script>

{#if open}
  <div
    role="dialog"
    aria-modal="false"
    aria-label={m.copilot.title}
    class={cn(
      'copilot-shell fixed z-50 flex flex-col overflow-hidden border border-[hsl(var(--border)/0.82)] bg-[hsl(var(--background)/0.94)] shadow-[0_28px_90px_-36px_rgba(18,26,140,0.42)] ring-1 ring-white/70 backdrop-blur-2xl transition-[inset,width,height,border-radius,box-shadow] duration-300 ease-out',
      maximized
        ? 'copilot-shell--max rounded-2xl max-w-none'
        : 'copilot-shell--compact rounded-[22px]',
    )}
    style={maximized
      ? 'left: 1rem; top: 1rem; width: calc(100dvw - 2rem); height: calc(100dvh - 2rem);'
      : undefined}
  >
    <div class="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--primary)/0.55)] to-transparent"></div>
    <div class="pointer-events-none absolute -top-24 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full bg-[hsl(var(--primary)/0.10)] blur-3xl"></div>

    <header class="relative flex items-center justify-between border-b border-[hsl(var(--border)/0.75)] bg-gradient-to-b from-white/90 to-white/55 px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_10px_24px_-14px_hsl(var(--primary))]">
          <Sparkles class="h-4 w-4" />
        </span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="truncate text-sm font-semibold leading-none">{m.copilot.title}</h2>
            <span class="hidden rounded-full border border-[hsl(var(--primary)/0.16)] bg-[hsl(var(--primary)/0.07)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))] sm:inline-flex">
              From omnibar
            </span>
          </div>
          <p class="truncate text-xs text-[hsl(var(--muted-foreground))]">{m.app.tagline}</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          class="h-8 w-8"
          onclick={() => (maximized = !maximized)}
          aria-label={maximized ? 'Restore chat window' : 'Maximize chat window'}
          title={maximized ? 'Restore chat window' : 'Maximize chat window'}
        >
          {#if maximized}
            <Minimize2 class="h-4 w-4" />
          {:else}
            <Maximize2 class="h-4 w-4" />
          {/if}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          class="h-8 w-8"
          onclick={close}
          aria-label="Close chat"
          title="Close chat"
        >
          <X class="h-4 w-4" />
        </Button>
      </div>
    </header>

    <div bind:this={scrollEl} class="copilot-messages relative flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-[hsl(var(--background))] to-[hsl(var(--muted)/0.55)] px-4 py-4">
      {#if messages.length === 0 && !draft}
        <div class="flex flex-col items-center gap-3 py-10 text-center">
          <span class="grid h-12 w-12 place-items-center rounded-2xl border border-[hsl(var(--primary)/0.12)] bg-[hsl(var(--primary)/0.07)] text-[hsl(var(--primary))] shadow-sm">
            <Sparkles class="h-6 w-6" />
          </span>
          <p class="max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Ask Vivien anything about your money - or just say "log 1,200 for groceries" and it's recorded. Every number runs through real tools.
          </p>
          <div class="grid w-full grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
            <button
              type="button"
              class="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-xs hover:bg-[hsl(var(--accent))]"
              onclick={() => quickPrompt(m.dashboard.promptWhereDidMyMoneyGo)}
            >
              {m.dashboard.promptWhereDidMyMoneyGo}
            </button>
            <button
              type="button"
              class="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-xs hover:bg-[hsl(var(--accent))]"
              onclick={() => quickPrompt(m.dashboard.promptForecast30)}
            >
              {m.dashboard.promptForecast30}
            </button>
            <button
              type="button"
              class="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-xs hover:bg-[hsl(var(--accent))]"
              onclick={() => quickPrompt(m.dashboard.promptOverspending)}
            >
              {m.dashboard.promptOverspending}
            </button>
            <button
              type="button"
              class="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-xs hover:bg-[hsl(var(--accent))]"
              onclick={() => quickPrompt(m.dashboard.promptCompareLastMonth)}
            >
              {m.dashboard.promptCompareLastMonth}
            </button>
          </div>
        </div>
      {/if}

      {#each messages as mm (mm.id)}
        <MessageBubble role={mm.role} content={mm.content} toolEvents={mm.toolEvents} />
      {/each}

      {#if draft}
        <MessageBubble role="assistant" content={draft.content} toolEvents={draft.toolEvents} streaming={streaming} />
      {/if}
    </div>

    <form
      class="copilot-composer relative flex items-center gap-3 border-t border-[hsl(var(--border)/0.72)] bg-[hsl(var(--card))] px-5 py-3 backdrop-blur-xl"
      onsubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_10px_24px_-14px_hsl(var(--primary))]">
        <Sparkles class="h-4 w-4" />
      </span>
      <div class="copilot-composer-field relative flex-1">
        <input
          bind:value={input}
          type="text"
          placeholder={m.copilot.placeholder}
          aria-label={m.copilot.placeholder}
          class="copilot-composer-input h-8 w-full border-0 bg-transparent p-0 text-sm font-medium text-[hsl(var(--foreground))] shadow-none outline-none placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none"
          disabled={streaming}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
      <Button
        type="submit"
        size="icon"
        disabled={streaming || !input.trim()}
        aria-label="Send"
        class="h-8 w-8 rounded-lg border border-[hsl(var(--border))] bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"
      >
        <Send class="h-4 w-4" />
      </Button>
    </form>
  </div>
{/if}

<style>
  @property --vf-border-angle {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }

  .copilot-shell {
    isolation: isolate;
  }

  .copilot-shell--compact {
    --vf-chat-offset: 0px;
    bottom: max(1rem, env(safe-area-inset-bottom));
    height: min(34rem, calc(100dvh - 6rem));
    left: calc(50% + var(--vf-chat-offset));
    transform: translateX(-50%);
    transform-origin: 50% 100%;
    width: min(calc(100dvw - 2rem), 620px);
    animation: copilotOmniRise 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .copilot-shell--max {
    transform-origin: 50% 100%;
    animation: copilotMaximize 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
    box-shadow: 0 30px 110px -38px rgba(18, 26, 140, 0.55);
  }

  .copilot-messages {
    min-height: 0;
  }

  .copilot-composer {
    min-height: 4.75rem;
    box-shadow: 0 -18px 38px -34px rgba(8, 12, 40, 0.55);
  }

  .copilot-composer::before {
    content: '';
    position: absolute;
    inset: 0.75rem;
    border-radius: 0.875rem;
    padding: 1.5px;
    background: conic-gradient(
      from var(--vf-border-angle),
      transparent 0deg,
      transparent 225deg,
      hsl(var(--primary) / 0.08) 270deg,
      hsl(var(--primary) / 0.28) 296deg,
      hsl(var(--primary) / 0.08) 326deg,
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
    animation: copilotBorderTrace 5.5s linear infinite;
  }

  .copilot-composer-input {
    position: relative;
  }

  @keyframes copilotBorderTrace {
    to {
      --vf-border-angle: 360deg;
    }
  }

  @keyframes copilotOmniRise {
    0% {
      opacity: 0.92;
      clip-path: inset(calc(100% - 4.7rem) 0 0 0 round 22px);
      filter: blur(0.5px);
    }
    55% {
      opacity: 1;
      filter: blur(0);
    }
    100% {
      opacity: 1;
      clip-path: inset(0 0 0 0 round 22px);
      filter: blur(0);
    }
  }

  @keyframes copilotMaximize {
    from {
      opacity: 0.96;
      clip-path: inset(8% 8% 0 8% round 22px);
    }
    to {
      opacity: 1;
      clip-path: inset(0 0 0 0 round 16px);
    }
  }

  @media (min-width: 1024px) {
    .copilot-shell--compact {
      --vf-chat-offset: calc(var(--vf-sidebar, 16rem) / 2);
    }
  }

  @media (max-width: 640px) {
    .copilot-shell--compact {
      bottom: max(0.75rem, env(safe-area-inset-bottom));
      height: min(34rem, calc(100dvh - 2rem));
      width: min(calc(100dvw - 1rem), 620px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .copilot-shell--compact,
    .copilot-shell--max,
    .copilot-composer::before {
      animation: none;
    }
  }
</style>
