<script lang="ts">
  /**
   * Animated AI Copilot demo, editorial light theme. Question types in,
   * an inline tool-call card renders (breakdown / forecast / compare),
   * then the grounded answer streams token-by-token. Loops through three
   * prompts; chips switch manually.
   */
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { BarChart3, TrendingUp, Scale } from 'lucide-svelte';

  type ToolBreakdown = { category: string; total: number; pct: number };
  type Step =
    | { kind: 'question'; text: string }
    | { kind: 'tool'; tool: 'breakdown'; rows: ToolBreakdown[]; total: number }
    | { kind: 'tool'; tool: 'forecast'; recurring: number; variable: number; total: number }
    | { kind: 'tool'; tool: 'compare'; thisMonth: number; lastMonth: number; deltaCategory: string; deltaPct: number }
    | { kind: 'answer'; text: string };

  type Conversation = { id: string; icon: typeof BarChart3; label: string; steps: Step[] };

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
            { category: 'Restaurants', total: 8200, pct: 100 },
            { category: 'Groceries', total: 7850, pct: 96 },
            { category: 'Transportation', total: 4980, pct: 61 },
            { category: 'Subscriptions', total: 4120, pct: 50 },
            { category: 'Bills & Utilities', total: 3480, pct: 42 },
          ],
        },
        { kind: 'answer', text: 'You spent ₹38,420 across 14 categories this month. Restaurants leads at ₹8,200, and Subscriptions are unusually high — Spotify, Netflix and your Zerodha SIP all landed on the 12th.' },
      ],
    },
    {
      id: 'forecast',
      icon: TrendingUp,
      label: 'Forecast next 30 days',
      steps: [
        { kind: 'question', text: 'Forecast my spending for the next 30 days.' },
        { kind: 'tool', tool: 'forecast', recurring: 27200, variable: 31480, total: 58680 },
        { kind: 'answer', text: 'You\'re on track for about ₹58,680 next month. ₹27,200 is locked in — rent, SIP, subscriptions. The remaining ₹31,480 is the variable component my ARIMA model projects from your daily spend.' },
      ],
    },
    {
      id: 'compare',
      icon: Scale,
      label: 'Where am I overspending?',
      steps: [
        { kind: 'question', text: 'Where am I overspending vs last month?' },
        { kind: 'tool', tool: 'compare', thisMonth: 38420, lastMonth: 32150, deltaCategory: 'Food Delivery', deltaPct: 64 },
        { kind: 'answer', text: 'You\'re ₹6,270 over last month, almost entirely in Food Delivery — up 64%. Swiggy hit twice last week. Cut one order and you\'re back on trend. Groceries and Restaurants are flat, which is healthy.' },
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

    for (let i = 1; i <= question.text.length; i += 1) {
      if (myRun !== runId) return;
      typedQuestion = question.text.slice(0, i);
      await wait(18 + Math.random() * 26);
    }
    revealedSteps = [0];
    await wait(420);
    if (myRun !== runId) return;
    revealedSteps = [...revealedSteps, toolStepIdx];
    await wait(820);
    if (myRun !== runId) return;
    revealedSteps = [...revealedSteps, conv.steps.length - 1];
    for (let i = 1; i <= answer.text.length; i += 1) {
      if (myRun !== runId) return;
      typedAnswer = answer.text.slice(0, i);
      await wait(answer.text[i - 1] === ' ' ? 12 : 6);
    }
    busy = false;
    await wait(3600);
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

<div class="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-[0_24px_60px_-30px_rgba(18,26,140,0.4)]">
  <!-- Title bar -->
  <div class="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
    <div class="flex items-center gap-2.5">
      <span class="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--brand-navy))] font-display text-sm font-semibold text-[hsl(var(--brand-paper))]">V</span>
      <div>
        <p class="text-sm font-semibold leading-tight text-[hsl(var(--brand-navy))]">Vivien</p>
        <p class="text-[11px] leading-tight text-[hsl(var(--muted-foreground))]">Grounded in your data</p>
      </div>
    </div>
    {#if busy}
      <span class="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--brand-gold))]">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--brand-gold))]"></span>
        thinking
      </span>
    {/if}
  </div>

  <!-- Prompt chips -->
  <div class="flex flex-wrap gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.5)] px-5 py-3">
    {#each CONVERSATIONS as conv, i (conv.id)}
      {@const Icon = conv.icon}
      <button
        type="button"
        onclick={() => selectConversation(i)}
        class={[
          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
          i === activeIdx
            ? 'border-[hsl(var(--brand-navy))] bg-[hsl(var(--brand-navy))] text-[hsl(var(--brand-paper))]'
            : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--brand-navy)/0.4)] hover:text-[hsl(var(--brand-navy))]',
        ].join(' ')}
      >
        <Icon class="h-3 w-3" />
        {conv.label}
      </button>
    {/each}
  </div>

  <!-- Conversation -->
  <div class="min-h-[340px] space-y-3 px-5 py-5">
    {#if typedQuestion}
      <div in:fly={{ y: 6, duration: 200 }}>
        <div class="ml-auto w-fit max-w-prose rounded-2xl rounded-tr-sm bg-[hsl(var(--brand-navy))] px-4 py-2.5 text-sm text-[hsl(var(--brand-paper))]">
          {typedQuestion}{#if !revealedSteps.includes(0)}<span class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-[hsl(var(--brand-gold))] align-middle"></span>{/if}
        </div>
      </div>
    {/if}

    {#if revealedSteps.includes(active.steps.findIndex((s) => s.kind === 'tool'))}
      {@const tool = active.steps.find((s) => s.kind === 'tool') as Extract<Step, { kind: 'tool' }>}
      <div in:fly={{ y: 6, duration: 240 }}>
        <div class="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.45)] p-4">
          {#if tool.tool === 'breakdown'}
            <div class="mb-3 flex items-center justify-between">
              <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--brand-gold))]">compute_category_breakdown</span>
              <span class="text-xs font-medium text-[hsl(var(--muted-foreground))]">total {inr(tool.total)}</span>
            </div>
            <ul class="space-y-2">
              {#each tool.rows as row, i (row.category)}
                <li in:fade={{ delay: i * 70, duration: 240 }} class="flex items-center gap-3">
                  <span class="w-28 truncate text-xs text-[hsl(var(--foreground))]">{row.category}</span>
                  <div class="relative h-2 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <span class="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--brand-navy))]" style:width={`${row.pct}%`}></span>
                  </div>
                  <span class="w-16 text-right text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{inr(row.total)}</span>
                </li>
              {/each}
            </ul>
          {:else if tool.tool === 'forecast'}
            <div class="mb-3 flex items-center justify-between">
              <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--brand-gold))]">compute_forecast</span>
              <span class="text-xs font-medium text-[hsl(var(--muted-foreground))]">next 30 days</span>
            </div>
            <div class="grid grid-cols-3 gap-3">
              {#each [{ l: 'Recurring', v: tool.recurring, c: 'text-[hsl(var(--foreground))]' }, { l: 'Variable', v: tool.variable, c: 'text-[hsl(var(--foreground))]' }, { l: 'Total', v: tool.total, c: 'text-[hsl(var(--brand-navy))]' }] as cell (cell.l)}
                <div>
                  <p class="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{cell.l}</p>
                  <p class="mt-0.5 font-display text-lg font-semibold tabular-nums {cell.c}">{inr(cell.v)}</p>
                </div>
              {/each}
            </div>
            <svg viewBox="0 0 200 46" class="mt-3 h-12 w-full" aria-hidden="true">
              <defs>
                <linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stop-color="hsl(236 77% 31%)" stop-opacity="0.16" />
                  <stop offset="1" stop-color="hsl(236 77% 31%)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,38 L20,30 L40,34 L60,26 L80,20 L100,28 L120,16 L140,22 L160,12 L180,15 L200,7 L200,46 L0,46 Z" fill="url(#fc-fill)" />
              <path d="M0,38 L20,30 L40,34 L60,26 L80,20 L100,28 L120,16 L140,22 L160,12 L180,15 L200,7" fill="none" stroke="hsl(236 77% 31%)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          {:else if tool.tool === 'compare'}
            <div class="mb-3">
              <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--brand-gold))]">compare_periods</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-lg border border-[hsl(var(--border))] bg-white p-3">
                <p class="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Last month</p>
                <p class="mt-0.5 font-display text-lg font-semibold tabular-nums text-[hsl(var(--muted-foreground))]">{inr(tool.lastMonth)}</p>
              </div>
              <div class="rounded-lg border border-[hsl(var(--brand-gold)/0.4)] bg-[hsl(var(--brand-gold)/0.08)] p-3">
                <p class="text-[10px] uppercase tracking-wider text-[hsl(var(--brand-gold))]">This month</p>
                <p class="mt-0.5 font-display text-lg font-semibold tabular-nums text-[hsl(var(--brand-navy))]">{inr(tool.thisMonth)}</p>
              </div>
            </div>
            <p class="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
              Biggest delta: <span class="font-semibold text-[hsl(var(--brand-navy))]">{tool.deltaCategory}</span>
              <span class="ml-1 rounded-full bg-[hsl(var(--brand-gold)/0.15)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--brand-gold))]">+{tool.deltaPct}%</span>
            </p>
          {/if}
        </div>
      </div>
    {/if}

    {#if typedAnswer}
      <div in:fly={{ y: 6, duration: 240 }}>
        <div class="w-fit max-w-prose rounded-2xl rounded-tl-sm bg-[hsl(var(--muted))] px-4 py-3 text-sm leading-relaxed text-[hsl(var(--foreground))]">
          {typedAnswer}{#if busy}<span class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-[hsl(var(--brand-gold))] align-middle"></span>{/if}
        </div>
      </div>
    {/if}
  </div>
</div>
