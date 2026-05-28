<script lang="ts">
  /**
   * Budgets page.
   *
   * Lists every budget with progress bars per category, color-coded by
   * the warn/exceed thresholds. Create/edit form is a slide-in sheet
   * with a `{category: amount}` builder. Live recompute is wired through
   * the WS layer in +layout.svelte — every transaction event invalidates
   * the budgets query so the bars move on their own.
   */
  import { fly } from 'svelte/transition';
  import { Plus, Pencil, Trash2, AlertCircle } from 'lucide-svelte';
  import {
    BUDGETABLE_CATEGORIES,
    CATEGORIES,
    CATEGORY_META,
    type Category,
  } from '@finehance/shared';
  import { api } from '$lib/api/client';
  import { useQuery, invalidate } from '$lib/api/queries';
  import { toast } from '$lib/stores/toast.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency } from '$lib/utils/format';
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    Input,
    Label,
    Sheet,
    Skeleton,
    Badge,
  } from '$lib/components/ui';
  import type { BudgetSummary, BudgetProgress } from '$lib/api/types';

  const m = $derived(getMessages(settings.language));

  const budgets = useQuery<{ budgets: BudgetSummary[] }>(['budgets'], () => api.budgets.list());

  // Per-budget progress, keyed by id.
  let progressMap = $state<Record<string, BudgetProgress>>({});

  $effect(() => {
    const list = budgets.data?.budgets;
    if (!list) return;
    void (async () => {
      const next: Record<string, BudgetProgress> = {};
      for (const b of list) {
        try {
          const { progress } = await api.budgets.progress(b.id);
          next[b.id] = progress;
        } catch {
          // skip
        }
      }
      progressMap = next;
    })();
  });

  // Derived totals across every budget.
  const totals = $derived(() => {
    let allocated = 0;
    let spent = 0;
    for (const b of budgets.data?.budgets ?? []) {
      const p = progressMap[b.id];
      if (!p) continue;
      allocated += p.totals.allocated;
      spent += p.totals.spent;
    }
    return { allocated, spent, remaining: allocated - spent };
  });

  // Form state (create + edit share the same sheet)
  let formOpen = $state(false);
  let editing = $state<BudgetSummary | null>(null);
  let formName = $state('');
  let formAllocations = $state<Array<{ category: Category | ''; amount: number }>>([
    { category: '', amount: 0 },
  ]);
  let saving = $state(false);

  function startCreate() {
    editing = null;
    formName = '';
    formAllocations = [{ category: '', amount: 0 }];
    formOpen = true;
  }

  function startEdit(b: BudgetSummary) {
    editing = b;
    formName = b.name;
    formAllocations = Object.entries(b.allocations).map(([cat, amt]) => ({
      category: cat as Category,
      amount: amt,
    }));
    if (formAllocations.length === 0) formAllocations = [{ category: '', amount: 0 }];
    formOpen = true;
  }

  function addAllocation() {
    formAllocations = [...formAllocations, { category: '', amount: 0 }];
  }

  function removeAllocation(idx: number) {
    formAllocations = formAllocations.filter((_, i) => i !== idx);
    if (formAllocations.length === 0) formAllocations = [{ category: '', amount: 0 }];
  }

  async function save() {
    if (!formName.trim()) {
      toast.warning('Name required');
      return;
    }
    const allocations: Record<string, number> = {};
    for (const row of formAllocations) {
      if (row.category && row.amount > 0) allocations[row.category] = row.amount;
    }
    if (Object.keys(allocations).length === 0) {
      toast.warning('Add at least one allocation');
      return;
    }
    saving = true;
    try {
      if (editing) {
        await api.budgets.patch(editing.id, { name: formName.trim(), allocations } as never);
      } else {
        await api.budgets.create({
          name: formName.trim(),
          recurrence: 'monthly',
          allocations,
        } as never);
      }
      invalidate(['budgets']);
      toast.success(editing ? 'Budget updated' : 'Budget created');
      formOpen = false;
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }

  async function remove(b: BudgetSummary) {
    if (!confirm(`Delete budget "${b.name}"?`)) return;
    try {
      await api.budgets.delete(b.id);
      invalidate(['budgets']);
      toast.success('Deleted');
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : String(err));
    }
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{m.budgets.title}</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Track spending against monthly category budgets.
      </p>
    </div>
    <Button onclick={startCreate}>
      <Plus class="h-4 w-4" />
      {m.budgets.create}
    </Button>
  </header>

  <div class="grid gap-4 sm:grid-cols-3">
    {@render Tile(m.budgets.totalAllocated, totals().allocated)}
    {@render Tile(m.budgets.totalSpent, totals().spent)}
    {@render Tile(m.budgets.totalRemaining, totals().remaining, totals().remaining < 0 ? 'rose' : 'emerald')}
  </div>

  {#snippet Tile(label: string, value: number, tone: 'default' | 'emerald' | 'rose' = 'default')}
    <Card>
      <CardContent class="space-y-1 p-5">
        <p class="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
        <p
          class="text-2xl font-semibold tabular-nums"
          class:text-emerald-600={tone === 'emerald' && value >= 0}
          class:text-rose-600={tone === 'rose' && value < 0}
        >
          {formatCurrency(value)}
        </p>
      </CardContent>
    </Card>
  {/snippet}

  {#if budgets.loading && !budgets.data}
    <div class="space-y-3">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if (budgets.data?.budgets ?? []).length === 0}
    <Card>
      <CardContent class="grid place-items-center gap-3 p-12 text-center">
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.budgets.noBudgets}</p>
        <Button onclick={startCreate}>
          <Plus class="h-4 w-4" />
          {m.budgets.create}
        </Button>
      </CardContent>
    </Card>
  {:else}
    <div class="grid gap-4">
      {#each budgets.data?.budgets ?? [] as b (b.id)}
        {@const progress = progressMap[b.id]}
        <div in:fly={{ y: 8, duration: 200 }}>
        <Card>
          <CardHeader class="flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <div>
              <CardTitle class="text-base">{b.name}</CardTitle>
              <p class="text-xs text-[hsl(var(--muted-foreground))]">
                {b.recurrence} · warn at {b.warnThreshold}% · exceeded at {b.exceedThreshold}%
              </p>
            </div>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Edit" onclick={() => startEdit(b)}>
                <Pencil class="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Delete" onclick={() => remove(b)}>
                <Trash2 class="h-4 w-4 text-rose-500" />
              </Button>
            </div>
          </CardHeader>
          <CardContent class="space-y-3">
            {#if !progress}
              <Skeleton class="h-20 w-full" />
            {:else}
              <div class="space-y-3">
                {#each Object.entries(progress.perCategory) as [cat, info] (cat)}
                  {@const meta = CATEGORY_META[cat as Category]}
                  {@const pct = Math.min(120, info.percentage)}
                  <div>
                    <div class="mb-1 flex items-center justify-between text-sm">
                      <span class="inline-flex items-center gap-2">
                        <span aria-hidden="true">{meta?.icon}</span>
                        <span class="font-medium">{cat}</span>
                        {#if info.status === 'warn'}
                          <Badge variant="secondary" class="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">warn</Badge>
                        {:else if info.status === 'exceeded'}
                          <Badge variant="secondary" class="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">exceeded</Badge>
                        {/if}
                      </span>
                      <span class="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
                        {formatCurrency(info.spent)} / {formatCurrency(info.allocated)}
                      </span>
                    </div>
                    <div class="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                      <div
                        class="h-full rounded-full transition-all duration-500"
                        class:bg-emerald-500={info.status === 'ok'}
                        class:bg-amber-500={info.status === 'warn'}
                        class:bg-rose-500={info.status === 'exceeded'}
                        style:width={`${pct}%`}
                      ></div>
                    </div>
                  </div>
                {/each}
                <div class="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3 text-sm">
                  <span class="text-[hsl(var(--muted-foreground))]">
                    {progress.periodStart} → {progress.periodEnd}
                  </span>
                  <span class="font-semibold tabular-nums">
                    {formatCurrency(progress.totals.spent)} / {formatCurrency(progress.totals.allocated)}
                  </span>
                </div>
              </div>
            {/if}
          </CardContent>
        </Card>
        </div>
      {/each}
    </div>
  {/if}
</div>

<Sheet
  bind:open={formOpen}
  onOpenChange={(v) => (formOpen = v)}
  side="right"
  title={editing ? m.budgets.edit : m.budgets.create}
>
  <div class="flex flex-col gap-4 overflow-y-auto pr-1">
    <div class="space-y-1.5">
      <Label for="b-name">{m.budgets.name}</Label>
      <Input id="b-name" bind:value={formName} placeholder="Monthly food" />
    </div>

    <div class="space-y-2">
      <p class="text-sm font-medium">Allocations</p>
      <div class="space-y-2">
        {#each formAllocations as row, i (i)}
          <div class="flex items-center gap-2">
            <select
              bind:value={row.category}
              class="h-9 flex-1 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            >
              <option value="">Pick category…</option>
              {#each BUDGETABLE_CATEGORIES as c (c)}
                <option value={c}>{c}</option>
              {/each}
            </select>
            <Input
              type="number"
              min="0"
              step="100"
              placeholder="₹"
              bind:value={row.amount}
              class="w-28"
            />
            <Button variant="ghost" size="icon" aria-label="Remove" onclick={() => removeAllocation(i)}>
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        {/each}
      </div>
      <Button variant="outline" size="sm" onclick={addAllocation}>
        <Plus class="h-4 w-4" />
        Add row
      </Button>
    </div>

    <div class="mt-auto flex flex-row-reverse gap-2 pt-4">
      <Button onclick={save} disabled={saving}>
        {saving ? 'Saving…' : m.common.save}
      </Button>
      <Button variant="ghost" onclick={() => (formOpen = false)}>{m.common.cancel}</Button>
    </div>
  </div>
</Sheet>

{#if false}
  <AlertCircle />
  <span>{CATEGORIES[0]}</span>
{/if}
