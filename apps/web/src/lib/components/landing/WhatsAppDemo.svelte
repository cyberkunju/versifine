<script lang="ts">
/**
 * Animated WhatsApp conversation. A scripted exchange between a user
 * and the Versifine bot — capture, voice, query, set-budget — with
 * realistic typing pauses. Loops; pauses on hover.
 *
 * Re-skinned for the editorial light theme: a real WhatsApp-green user
 * bubble (it IS WhatsApp, after all) against a soft paper chat ground,
 * with the bot replying in brand navy. Framed in a clean device shell.
 */
import { onDestroy, onMount } from 'svelte';
import { fly } from 'svelte/transition';
import { browser } from '$app/environment';
import { Mic, Plus, CheckCheck } from 'lucide-svelte';

type Bubble = {
  id: number;
  side: 'me' | 'bot';
  text: string;
  voice?: { seconds: number };
  delay: number;
  typingMs?: number;
};

const SCRIPT: Bubble[] = [
  { id: 1, side: 'me', text: 'spent 450 on auto', delay: 800 },
  {
    id: 2,
    side: 'bot',
    text: 'Logged ₹450 · Transportation\nAuto fare on your usual route.',
    delay: 1100,
    typingMs: 700,
  },
  { id: 3, side: 'me', text: '', voice: { seconds: 4 }, delay: 1400 },
  {
    id: 4,
    side: 'bot',
    text: 'Logged ₹320 · Restaurants\nBiryani at Paradise.',
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
    text: "Budget set. I'll nudge you at ₹2,400 (80%) and again at ₹3,000.",
    delay: 1100,
    typingMs: 700,
  },
];

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

  for (const bubble of SCRIPT) {
    if (myRun !== runId) return;
    if (bubble.typingMs && bubble.typingMs > 0) {
      await wait(bubble.delay - bubble.typingMs, () => myRun === runId);
      if (myRun !== runId) return;
      typing = bubble.side;
      await wait(bubble.typingMs, () => myRun === runId);
    } else {
      await wait(bubble.delay, () => myRun === runId);
    }
    if (myRun !== runId) return;
    typing = null;
    visibleIds = new Set([...visibleIds, bubble.id]);
    queueMicrotask(scrollToBottom);
  }
  await wait(2600, () => myRun === runId);
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
  scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
}

onMount(play);
onDestroy(() => {
  runId += 1;
  if (timer) clearTimeout(timer);
});

const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<div
  role="presentation"
  class="relative mx-auto w-full max-w-[min(100%,22rem)] lg:max-w-[clamp(21rem,24vw,28rem)]"
  onmouseenter={() => (paused = true)}
  onmouseleave={() => (paused = false)}
>
  <!-- Device shell -->
  <div class="overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-white p-1.5 shadow-[0_30px_60px_-25px_rgba(18,26,140,0.30)] ring-1 ring-black/[0.03] sm:rounded-[2.5rem] sm:p-2">
    <div class="overflow-hidden rounded-[1.5rem] bg-[#ECE5DD] sm:rounded-[2rem]">
      <!-- WhatsApp chat header -->
      <div class="flex items-center gap-3 bg-[hsl(var(--brand-navy))] px-4 py-3 text-[hsl(var(--brand-paper))]">
        <span class="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--brand-paper))] font-display text-sm font-semibold text-[hsl(var(--brand-navy))]">V</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-tight">Versifine</p>
          <p class="text-[11px] leading-tight text-[hsl(var(--brand-paper)/0.7)]">online</p>
        </div>
        <span class="text-[10px] uppercase tracking-wider text-[hsl(var(--brand-gold))]">encrypted</span>
      </div>

      <!-- Conversation -->
      <div
        bind:this={scrollContainer}
        class="h-[min(440px,58svh)] min-h-[330px] overflow-y-auto scrollbar-none px-3 py-4"
        style:background-image="radial-gradient(circle at 25% 15%, rgba(18,26,140,0.04), transparent 45%), radial-gradient(circle at 80% 85%, rgba(132,129,246,0.06), transparent 45%)"
        aria-label="Versifine WhatsApp demo"
      >
        <p class="mx-auto mb-4 w-fit rounded-full bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] shadow-sm">Today</p>
        <ul class="flex flex-col gap-2">
          {#each SCRIPT as bubble (bubble.id)}
            {#if visibleIds.has(bubble.id)}
              <li in:fly={{ y: 8, duration: 240 }} class={bubble.side === 'me' ? 'self-end' : 'self-start'}>
                <div
                  class={[
                    'max-w-[min(15rem,78vw)] px-3 py-2 text-[13px] leading-snug shadow-sm',
                    bubble.side === 'me'
                      ? 'rounded-2xl rounded-tr-sm bg-[#DCF8C6] text-[#0b3d12]'
                      : 'rounded-2xl rounded-tl-sm bg-white text-[hsl(var(--foreground))]',
                  ].join(' ')}
                >
                  {#if bubble.voice}
                    <div class="flex items-center gap-2 py-0.5">
                      <span class="grid h-7 w-7 place-items-center rounded-full bg-[hsl(var(--brand-navy))] text-[hsl(var(--brand-paper))]">▶</span>
                      <div class="flex h-5 items-end gap-[3px]">
                        {#each [6, 12, 8, 16, 10, 14, 18, 12, 8, 16, 14, 10, 18, 12] as h, i (i)}
                          <span class="block w-[2px] rounded-full bg-[hsl(var(--brand-navy)/0.55)]" style:height={`${h}px`}></span>
                        {/each}
                      </div>
                      <span class="text-[11px] text-[#0b3d12]/70">0:0{bubble.voice.seconds}</span>
                    </div>
                  {:else}
                    {#if bubble.side === 'bot' && bubble.text.includes('·')}
                      {@const [head, ...rest] = bubble.text.split('\n')}
                      <p class="font-semibold text-[hsl(var(--brand-navy))]">{head}</p>
                      {#if rest.length}<p class="mt-0.5 text-[hsl(var(--muted-foreground))]">{rest.join(' ')}</p>{/if}
                    {:else}
                      <p class="whitespace-pre-line">{bubble.text}</p>
                    {/if}
                  {/if}
                  <div class={['mt-1 flex items-center gap-1 text-[10px] leading-none', bubble.side === 'me' ? 'justify-end text-[#0b3d12]/55' : 'text-[hsl(var(--muted-foreground))]'].join(' ')}>
                    <span>{stamp}</span>
                    {#if bubble.side === 'me'}<CheckCheck class="h-3 w-3 text-[#1f7aef]" />{/if}
                  </div>
                </div>
              </li>
            {/if}
          {/each}

          {#if typing === 'bot'}
            <li in:fly={{ y: 6, duration: 200 }} class="self-start">
              <div class="flex h-8 items-center gap-1 rounded-2xl rounded-tl-sm bg-white px-3 shadow-sm">
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--brand-navy)/0.4)] [animation-delay:-300ms]"></span>
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--brand-navy)/0.4)] [animation-delay:-150ms]"></span>
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--brand-navy)/0.4)]"></span>
              </div>
            </li>
          {/if}
        </ul>
      </div>

      <!-- Compose bar -->
      <div class="flex items-center gap-2 bg-[#ECE5DD] px-3 py-2.5">
        <Plus class="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
        <div class="flex h-9 flex-1 items-center rounded-full bg-white px-3.5 text-[13px] text-[hsl(var(--muted-foreground))] shadow-sm">Message</div>
        <span class="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--brand-navy))]"><Mic class="h-4 w-4 text-[hsl(var(--brand-paper))]" /></span>
      </div>
    </div>
  </div>
</div>
