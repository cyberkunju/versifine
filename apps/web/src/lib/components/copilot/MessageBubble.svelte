<script lang="ts">
/**
 * One chat bubble. Renders the assistant or user message; for assistant
 * messages we also render the tool calls inline (with results below)
 * so the user sees Vivien's reasoning instead of a black box.
 */
import { Sparkles, User, Wrench } from 'lucide-svelte';
import { formatCurrency } from '$lib/utils/format';
import { cn } from '$lib/utils/cn';

export type ToolEvent = {
  name: string;
  args?: string;
  result?: unknown;
};

type Props = {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  toolEvents?: ToolEvent[];
};

let { role, content, streaming = false, toolEvents = [] }: Props = $props();

function renderToolResult(name: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  if (name === 'compute_total' && typeof r.total === 'number') {
    const total = r.total;
    const currency = (r.currency as string) ?? 'INR';
    const count = (r.count as number | undefined) ?? 0;
    return `${formatCurrency(total, currency as never)} across ${count} entries`;
  }
  if (name === 'compute_category_breakdown' && Array.isArray(r.items)) {
    const items = r.items as Array<{ category: string; total: number }>;
    return items
      .slice(0, 5)
      .map((it) => `${it.category}: ${formatCurrency(it.total, 'INR')}`)
      .join('  •  ');
  }
  if (name === 'compute_forecast' && typeof r.total === 'number') {
    return `Projected ${formatCurrency(r.total as number, 'INR')} (recurring ${formatCurrency(
      (r.recurringBase as number) ?? 0,
      'INR',
    )})`;
  }
  if (name === 'find_recurring' && Array.isArray(r.items)) {
    return `${(r.items as unknown[]).length} active recurring items`;
  }
  if (name === 'compare_periods') {
    return 'Comparison ready';
  }
  if (name === 'log_transaction') {
    const tx = r.transaction as
      | { amount: number; currency: string; description: string; wallet?: string }
      | undefined;
    if (r.ok && tx) {
      const amount = formatCurrency(tx.amount, (tx.currency as never) ?? 'INR');
      return `Logged ${amount} — ${tx.description}${tx.wallet ? ` (${tx.wallet})` : ''}`;
    }
    if (typeof r.message === 'string') return String(r.message);
  }
  return JSON.stringify(r).slice(0, 140);
}
</script>

<div
  class={cn(
    'flex w-full gap-3',
    role === 'user' ? 'flex-row-reverse' : 'flex-row',
  )}
>
  <div
    class={cn(
      'grid h-8 w-8 shrink-0 place-items-center rounded-full',
      role === 'user'
        ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]'
        : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
    )}
    aria-hidden="true"
  >
    {#if role === 'user'}
      <User class="h-4 w-4" />
    {:else}
      <Sparkles class="h-4 w-4" />
    {/if}
  </div>
  <div class={cn('flex max-w-[85%] flex-col gap-2', role === 'user' && 'items-end')}>
    {#if toolEvents.length > 0 && role === 'assistant'}
      <div class="flex flex-wrap gap-1.5">
        {#each toolEvents as ev, i (i)}
          <span
            class="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))]"
            title={ev.args ?? ev.name}
          >
            <Wrench class="h-3 w-3" />
            {ev.name}{#if ev.result}<span class="text-[hsl(var(--foreground))]">: {renderToolResult(ev.name, ev.result)}</span>{/if}
          </span>
        {/each}
      </div>
    {/if}
    {#if content || streaming}
      <div
        class={cn(
          'whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed',
          role === 'user'
            ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
            : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]',
        )}
      >
        {content}{#if streaming}<span class="inline-block w-1 animate-pulse">▍</span>{/if}
      </div>
    {/if}
  </div>
</div>
