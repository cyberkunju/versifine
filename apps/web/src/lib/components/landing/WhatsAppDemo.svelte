<script lang="ts">
  /**
   * Animated WhatsApp conversation demo. Plays a scripted exchange
   * between a user and the Versifine bot showing capture, voice,
   * categorisation, and forecasting. Loops indefinitely with a
   * pause-on-hover and a "type indicator" between bubbles for realism.
   *
   * Designed to live inside the standard "phone" frame the landing page
   * provides; the component itself is layout-agnostic.
   */
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { Mic, ImagePlus, CheckCheck, Volume2 } from 'lucide-svelte';

  type Bubble = {
    id: number;
    side: 'me' | 'bot';
    /** Plain text body. */
    text: string;
    /** Optional embellishments. */
    voice?: { seconds: number };
    image?: string;
    /** Render time in ms after the previous bubble. */
    delay: number;
    /** Time the bot 'types' before this bubble appears (bot bubbles only). */
    typingMs?: number;
  };

  // The script — six exchanges in roughly 30 seconds.
  const SCRIPT: Bubble[] = [
    { id: 1, side: 'me', text: 'spent 450 on auto', delay: 800 },
    {
      id: 2,
      side: 'bot',
      text: '✓ Logged ₹450 — Transportation. Auto fare from your usual route.',
      delay: 1100,
      typingMs: 700,
    },
    { id: 3, side: 'me', text: '', voice: { seconds: 4 }, delay: 1400 },
    {
      id: 4,
      side: 'bot',
      text: '✓ Logged ₹320 — Restaurants. Biryani at Paradise.',
      delay: 1100,
      typingMs: 800,
    },
    { id: 5, side: 'me', text: 'how much on food this month?', delay: 1500 },
    {
      id: 6,
      side: 'bot',
      text: '₹4,820 across 14 transactions — 60% restaurants, 40% delivery.',
      delay: 1300,
      typingMs: 900,
    },
    { id: 7, side: 'me', text: 'set budget transport 3000', delay: 1500 },
    {
      id: 8,
      side: 'bot',
      text: '✓ Budget set. I\'ll warn at ₹2,400 (80%) and again at ₹3,000.',
      delay: 1100,
      typingMs: 700,
    },
  ];

  const TOTAL_DURATION = SCRIPT.reduce((sum, b) => sum + b.delay + (b.typingMs ?? 0), 0) + 2500;

  let visibleIds = $state<Set<number>>(new Set());
  let typing = $state<'me' | 'bot' | null>(null);
  let paused = $state(false);
  let scrollContainer = $state<HTMLElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let runId = 0;

  async function play() {
    if (!browser) return;
    runId += 1;
    const myRun = runId;
    visibleIds = new Set();
    typing = null;

    let elapsed = 0;
    for (const bubble of SCRIPT) {
      elapsed += bubble.delay;
      if (myRun !== runId) return;

      if (bubble.typingMs && bubble.typingMs > 0) {
        await wait(bubble.delay - bubble.typingMs, () => myRun === runId);
        if (myRun !== runId) return;
        typing = bubble.side;
        await wait(bubble.typingMs, () => myRun === runId);
        if (myRun !== runId) return;
      } else {
        await wait(bubble.delay, () => myRun === runId);
        if (myRun !== runId) return;
      }
      typing = null;
      visibleIds = new Set([...visibleIds, bubble.id]);
      // Defer scroll to let the bubble's enter transition start; we want
      // the element measured.
      queueMicrotask(scrollToBottom);
    }

    await wait(2500, () => myRun === runId);
    if (myRun === runId) play();
  }

  function wait(ms: number, alive: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const tick = () => {
        if (!alive()) return resolve();
        if (paused) {
          timer = setTimeout(tick, 80);
          return;
        }
        resolve();
      };
      timer = setTimeout(tick, ms);
    });
  }

  function scrollToBottom() {
    if (!scrollContainer) return;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
  }

  onMount(() => {
    play();
  });
  onDestroy(() => {
    runId += 1;
    if (timer) clearTimeout(timer);
  });

  function nowLabel(): string {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const stamp = nowLabel();
</script>

<div
  role="presentation"
  class="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-1 shadow-2xl shadow-violet-900/40"
  onmouseenter={() => (paused = true)}
  onmouseleave={() => (paused = false)}
>
  <!-- Phone frame -->
  <div class="rounded-[2rem] border border-white/5 bg-slate-900/80 p-2">
    <div class="rounded-[1.6rem] bg-[#0b141a] shadow-inner">
      <!-- Status bar -->
      <div class="flex items-center justify-between rounded-t-[1.6rem] bg-[#202c33] px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-emerald-200/70">
        <span>{stamp}</span>
        <span class="flex items-center gap-1">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          end-to-end
        </span>
      </div>

      <!-- Chat header -->
      <div class="flex items-center gap-3 bg-[#202c33] px-4 py-3 text-white">
        <span class="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold">
          V
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium leading-tight">Versifine</p>
          <p class="text-xs leading-tight text-emerald-300">online · typing as needed</p>
        </div>
      </div>

      <!-- Conversation -->
      <div
        bind:this={scrollContainer}
        class="h-[420px] overflow-y-auto bg-[#0b141a] bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.08),transparent_50%),radial-gradient(circle_at_70%_80%,rgba(16,185,129,0.06),transparent_50%)] px-3 py-4"
        aria-label="Versifine WhatsApp conversation demo"
      >
        <p class="mx-auto mb-4 w-fit rounded-full bg-amber-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-300">
          Today
        </p>
        <ul class="flex flex-col gap-2.5">
          {#each SCRIPT as bubble (bubble.id)}
            {#if visibleIds.has(bubble.id)}
              <li
                in:fly={{ y: 8, duration: 260 }}
                class={bubble.side === 'me' ? 'self-end' : 'self-start'}
              >
                <div
                  class={[
                    'max-w-[16rem] rounded-2xl px-3 py-2 text-sm shadow-sm',
                    bubble.side === 'me'
                      ? 'rounded-tr-sm bg-emerald-500/90 text-white'
                      : 'rounded-tl-sm bg-[#202c33] text-slate-100',
                  ].join(' ')}
                >
                  {#if bubble.voice}
                    <div class="flex items-center gap-2 py-0.5">
                      <Volume2 class="h-4 w-4 opacity-90" />
                      <div class="flex h-5 items-end gap-0.5">
                        {#each Array(18) as _, i (i)}
                          <span
                            class="block w-0.5 rounded-full bg-white/80"
                            style:height={`${[6, 12, 8, 16, 10, 14, 18, 12, 8, 16, 14, 10, 18, 12, 8, 14, 10, 6][i]}px`}
                          ></span>
                        {/each}
                      </div>
                      <span class="text-xs opacity-80">0:0{bubble.voice.seconds}</span>
                    </div>
                  {:else if bubble.text}
                    <p class="whitespace-pre-line">{bubble.text}</p>
                  {/if}
                  <div class={[
                    'mt-1 flex items-center gap-1 text-[10px] leading-none',
                    bubble.side === 'me' ? 'justify-end text-emerald-50/80' : 'text-slate-400',
                  ].join(' ')}>
                    <span>{stamp}</span>
                    {#if bubble.side === 'me'}
                      <CheckCheck class="h-3 w-3" />
                    {/if}
                  </div>
                </div>
              </li>
            {/if}
          {/each}

          {#if typing === 'bot'}
            <li in:fly={{ y: 6, duration: 200 }} class="self-start">
              <div class="flex h-7 items-center gap-1 rounded-2xl rounded-tl-sm bg-[#202c33] px-3 py-2">
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-300ms]"></span>
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-150ms]"></span>
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"></span>
              </div>
            </li>
          {/if}
        </ul>
      </div>

      <!-- Compose bar -->
      <div class="flex items-center gap-2 rounded-b-[1.6rem] bg-[#202c33] px-3 py-2.5">
        <ImagePlus class="h-5 w-5 text-slate-400" />
        <div class="flex h-9 flex-1 items-center rounded-full bg-[#2a3942] px-3 text-sm text-slate-400">
          Message
        </div>
        <Mic class="h-5 w-5 text-slate-400" />
      </div>
    </div>
  </div>

  <!-- Subtle ambient glow behind the phone -->
  <span class="pointer-events-none absolute -inset-12 -z-10 bg-[radial-gradient(60%_50%_at_50%_50%,rgba(124,58,237,0.35),transparent_70%)]"></span>
</div>
