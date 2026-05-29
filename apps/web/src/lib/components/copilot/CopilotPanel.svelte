<script lang="ts">
  /**
   * Slide-in copilot. Streams from the SvelteKit /api/copilot proxy
   * (which forwards to the API's /copilot/chat). Each `data: …` line is
   * decoded and dispatched by `type` — chunks accumulate into the active
   * draft message, tool events surface as inline pills.
   */
  import { Sparkles, Send, X } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { Sheet, Button, Textarea } from '$lib/components/ui';
  import MessageBubble, { type ToolEvent } from './MessageBubble.svelte';
  import type { CopilotMessage } from '$lib/api/types';

  type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Optional prefilled prompt — set when the omnibar dispatches a chat intent. */
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
  let abort: AbortController | null = null;
  let scrollEl: HTMLDivElement | undefined = $state(undefined);
  let nextId = 1;

  $effect(() => {
    if (!open) return;
    if (seed && messages.length === 0 && !streaming) {
      input = seed;
    }
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

  async function send() {
    const text = input.trim();
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
      // Call the API's streaming endpoint directly through nginx
      // (`/api/* -> api`, prefix stripped → `/copilot/chat`). The bearer
      // token rides the Authorization header; fetch reads the SSE body as
      // a stream natively, so no SvelteKit proxy is needed.
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

<Sheet bind:open onOpenChange={(v) => onOpenChange(v)} side="right" class="w-full sm:max-w-md flex flex-col p-0">
  <header class="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
    <div class="flex items-center gap-2">
      <span class="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
        <Sparkles class="h-4 w-4" />
      </span>
      <div>
        <h2 class="text-sm font-semibold leading-none">{m.copilot.title}</h2>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">{m.app.tagline}</p>
      </div>
    </div>
    <Button size="icon" variant="ghost" onclick={close} aria-label="Close">
      <X class="h-4 w-4" />
    </Button>
  </header>

  <div bind:this={scrollEl} class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
    {#if messages.length === 0 && !draft}
      <div class="flex flex-col items-center gap-3 py-10 text-center">
        <Sparkles class="h-8 w-8 text-[hsl(var(--primary))]" />
        <p class="text-sm text-[hsl(var(--muted-foreground))]">
          Ask Vivien anything about your money. Math always goes through tools — every number is real.
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
    class="flex items-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3"
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    <Textarea
      bind:value={input}
      placeholder={m.copilot.placeholder}
      rows={1}
      class="min-h-[40px] resize-none"
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void send();
        }
      }}
    />
    <Button type="submit" size="icon" disabled={streaming || !input.trim()} aria-label="Send">
      <Send class="h-4 w-4" />
    </Button>
  </form>
</Sheet>
