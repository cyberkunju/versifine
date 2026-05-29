<script lang="ts">
  /**
   * Animated AI Copilot demo. Shows a question being typed, then the
   * answer streaming in token-by-token with a tool-call card appearing
   * inline (the way the real copilot renders compute_total / breakdown
   * results). Loops through three different prompts.
   */
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { Sparkles, BarChart3, TrendingUp, AlertTriangle } from 'lucide-svelte';

  type ToolBreakdown = { category: string; total: number; pct: number };
  type Step =
    | { kind: 'question'; text: string }
    | { kind: 'tool'; tool: 'breakdown'; rows: ToolBreakdown[]; total: number }
    | { kind: 'tool'; tool: 'forecast'; recurring: number; variable: number; total: number }
    | { kind: 'tool'; tool: 'compare'; thisMonth: number; lastMonth: number; deltaCategory: string; deltaPct: number }
    | { kind: 'answer'; text: string };

  type Conversation = {
    id: string;
    icon: typeof Sparkles;
    label: string;
    steps: Step[];
  };

  const CONVERSATIONS: Conversation[] = [
    {
      id: 'where',
      icon: BarChart3,
      label: 'Where did my money go?',
      steps: [
        { kind: 'question', text: 'Where did my money go this month?' },
        {
          kind: 'tool',
          tool: 'breakdown',
          total: 38420,
          rows: [
            { category: 'Restaurants', total: 8200, pct: 21 },
            { category: 'Groceries', total: 7850, pct: 20 },
            { category: 'Transportation', total: 4980, pct: 13 },
            { category: 'Subscriptions', total: 4120, pct: 11 },
            { category: 'Bills & Utilities', total: 3480, pct: 9 },
          ],
        },
        {
          kind: 'answer',
          text: 'You spent ₹38,420 across 14 categories this month. The biggest five are listed above — Restaurants leads at ₹8,200 (21%), and Subscriptions are notably high at ₹4,120 because Spotify, Netflix, and Zerodha SIP all hit on the 12th.',
        },
      ],
    },
    {
      id: 'forecast',
      icon: TrendingUp,
      label: 'Forecast next 30 days',
      steps: [
        { kind: 'question', text: 'Forecast my spending for the next 30 days.' },
        { kind: 'tool', tool: 'forecast', recurring: 27200, variable: 31480, total: 58680 },
        {
          kind: 'answer',
          text: 'Based on 90 days of history and your active recurring charges, you\'re on track to spend about ₹58,680 next month. ₹27,200 of that is locked in (rent, SIP, subscriptions); the remaining ₹31,480 is the variable component my ARIMA model projects from your daily spend.',
        },
      ],
    },
    {
      id: 'compare',
      icon: AlertTriangle,
      label: 'Where am I overspending?',
      steps: [
        { kind: 'question', text: 'Where am I overspending compared to last month?' },
        {
          kind: 'tool',
          tool: 'compare',
          thisMonth: 38420,
          lastMonth: 32150,
          deltaCategory: 'Food Delivery',
          deltaPct: 64,
        },
        {
          kind: 'answer',
          text: 'You\'re ₹6,270 over last month, mostly in Food Delivery — that line is up 64%. Swiggy hit twice last week; if you cut one of those orders, you\'d be back on trend. Your Restaurants and Groceries categories are flat, which is healthy.',
        },
      ],
    },
  ];

  let activeIdx = $state(0);
  const active = $derived(CONVERSATIONS[activeIdx] ?? CONVERSATIONS[0]!);

  let typedQuestion = $state('');
  let revealedSteps = $state<number[]>([]);
  let typedAnswer = $state('');
  let busy = $state(false);
  let runId = 0;

  async function play(idx: number) {
    runId += 1;
    const myRun = runId;
    activeIdx = idx;
    typedQuestion = '';
    revealedSteps = [];
    typedAnswer = '';
    busy = true;

    const conv = CONVERSATIONS[idx]!;
    const question = conv.steps.find((s) => s.kind === 'question') as { kind: 'question'; text: string };
    const answer = conv.steps.find((s) => s.kind === 'answer') as { kind: 'answer'; text: string };
    const toolStepIdx = conv.steps.findIndex((s) => s.kind === 'tool');

    // 1. Type the question
    for (let i = 1; i <= question.text.length; i += 1) {
      if (myRun !== runId) return;
      typedQuestion = question.text.slice(0, i);
      await wait(20 + Math.random() * 30);
    }
    revealedSteps = [0];

    // 2. "Thinking" pause then tool call render
    await wait(450);
    if (myRun !== runId) return;
    revealedSteps = [...revealedSteps, toolStepIdx];

    // 3. Brief pause before answer streams
    await wait(900);
    if (myRun !== runId) return;
    revealedSteps = [...revealedSteps, conv.steps.length - 1];

    // 4. Stream the answer
    for (let i = 1; i <= answer.text.length; i += 1) {
      if (myRun !== runId) return;
      typedAnswer = answer.text.slice(0, i);
      // Faster streaming for realism (~80 chars/sec)
      await wait(answer.text[i - 1] === ' ' ? 14 : 7);
    }
    busy = false;

    // 5. Hold then advance
    await wait(3500);
    if (myRun !== runId) return;
    play((idx + 1) % CONVERSATIONS.length);
  }

  function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  function selectConversation(idx: number) {
    if (idx === activeIdx) return;
    play(idx);
  }

  function inr(n: number): string {
    return `₹${n.toLocaleString('en-IN')}`;
  }

  onMount(() => play(0));
  onDestroy(() => {
    runId += 1;
  });
</script>

<div class="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-2xl shadow-violet-900/30 backdrop-blur">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-white/10 bg-slate-900/80 px-4 py-3">
    <div class="flex items-center gap-2">
      <span class="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600">
        <Sparkles class="h-3.5 w-3.5 text-white" />
      </span>
      <div>
        <p class="text-sm font-medium leading-tight text-white">Vivien</p>
        <p class="text-[10px] uppercase tracking-wide text-slate-400">AI co-pilot · grounded in your data</p>
      </div>
    </div>
    {#if busy}
      <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-violet-300">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"></span>
        thinking…
      </div>
    {/if}
  </div>

  <!-- Quick prompts -->
  <div class="flex flex-wrap gap-2 border-b border-white/5 bg-slate-900/50 px-4 py-3">
    {#each CONVERSATIONS as conv, i (conv.id)}
      {@const Icon = conv.icon}
      <button
        type="button"
        onclick={() => selectConversation(i)}
        class={[
          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
          i === activeIdx
            ? 'border-violet-500/40 bg-violet-500/10 text-violet-200'
            : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white',
        ].join(' ')}
      >
        <Icon class="h-3 w-3" />
        {conv.label}
      </button>
    {/each}
  </div>

  <!-- Conversation area -->
  <div class="min-h-[360px] space-y-3 px-4 py-4">
    <!-- Question -->
    {#if typedQuestion}
      <div class="self-end" in:fly={{ y: 6, duration: 200 }}>
        <div class="ml-auto max-w-prose rounded-2xl rounded-tr-sm bg-violet-500/15 px-4 py-2.5 text-sm text-violet-100">
          {typedQuestion}
          {#if !revealedSteps.includes(0) || (revealedSteps.length === 1 && busy)}
            <span class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-violet-300 align-middle"></span>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Tool result (renders inline) -->
    {#if revealedSteps.includes(active.steps.findIndex((s) => s.kind === 'tool'))}
      {@const tool = active.steps.find((s) => s.kind === 'tool') as Extract<Step, { kind: 'tool' }>}
      <div in:fly={{ y: 6, duration: 240 }}>
        <div class="rounded-xl border border-white/10 bg-slate-950/60 p-3.5 text-sm text-slate-200">
          {#if tool.tool === 'breakdown'}
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-violet-300">compute_category_breakdown</span>
              <span class="text-xs font-medium text-slate-400">total {inr(tool.total)}</span>
            </div>
            <ul class="space-y-1.5">
              {#each tool.rows as row, i (row.category)}
                <li in:fade={{ delay: i * 60, duration: 220 }} class="flex items-center gap-3">
                  <span class="w-32 truncate text-xs">{row.category}</span>
                  <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <span
                      class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                      style:width={`${row.pct}%`}
                    ></span>
                  </div>
                  <span class="w-20 text-right text-xs tabular-nums text-slate-300">{inr(row.total)}</span>
                </li>
              {/each}
            </ul>
          {:else if tool.tool === 'forecast'}
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-violet-300">compute_forecast</span>
              <span class="text-xs font-medium text-slate-400">next 30d</span>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-400">Recurring</p>
                <p class="mt-0.5 text-base font-semibold text-white tabular-nums">{inr(tool.recurring)}</p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-400">Variable</p>
                <p class="mt-0.5 text-base font-semibold text-white tabular-nums">{inr(tool.variable)}</p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-400">Total</p>
                <p class="mt-0.5 text-base font-semibold text-violet-300 tabular-nums">{inr(tool.total)}</p>
              </div>
            </div>
            <!-- Mini area chart -->
            <svg viewBox="0 0 200 50" class="mt-3 h-12 w-full overflow-visible" aria-hidden="true">
              <defs>
                <linearGradient id="forecast-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stop-color="rgb(139 92 246)" stop-opacity="0.4" />
                  <stop offset="1" stop-color="rgb(139 92 246)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,40 L20,32 L40,36 L60,28 L80,22 L100,30 L120,18 L140,24 L160,14 L180,16 L200,8 L200,50 L0,50 Z" fill="url(#forecast-fill)" />
              <path d="M0,40 L20,32 L40,36 L60,28 L80,22 L100,30 L120,18 L140,24 L160,14 L180,16 L200,8" fill="none" stroke="rgb(167 139 250)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          {:else if tool.tool === 'compare'}
            <div class="mb-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-violet-300">compare_periods</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-lg bg-white/5 p-3">
                <p class="text-[10px] uppercase tracking-wider text-slate-400">Last month</p>
                <p class="mt-0.5 text-base font-semibold text-slate-300 tabular-nums">{inr(tool.lastMonth)}</p>
              </div>
              <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p class="text-[10px] uppercase tracking-wider text-amber-300">This month</p>
                <p class="mt-0.5 text-base font-semibold text-amber-200 tabular-nums">{inr(tool.thisMonth)}</p>
              </div>
            </div>
            <p class="mt-3 text-xs text-slate-300">
              Biggest delta: <span class="font-semibold text-amber-300">{tool.deltaCategory}</span>
              <span class="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">+{tool.deltaPct}%</span>
            </p>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Streamed answer -->
    {#if typedAnswer}
      <div in:fly={{ y: 6, duration: 240 }}>
        <div class="max-w-prose rounded-2xl rounded-tl-sm bg-white/5 px-4 py-3 text-sm leading-relaxed text-slate-100">
          {typedAnswer}{#if busy}<span class="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-violet-300 align-middle"></span>{/if}
        </div>
      </div>
    {/if}
  </div>
</div>
