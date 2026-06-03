<script lang="ts">
/**
 * Goals page.
 *
 * Cards grid with progress rings, projected completion, atRisk badge.
 * The "+ contribution" button opens a small dialog → POST /goals/:id/progress.
 * Create / edit shares one slide-in sheet.
 */
import { fly } from 'svelte/transition';
import { Plus, Pencil, Trash2, Target, Sparkles, AlertTriangle } from 'lucide-svelte';
import { CATEGORIES, type Category } from '@versifine/shared';
import { api } from '$lib/api/client';
import { useQuery, invalidate } from '$lib/api/queries.svelte';
import { toast } from '$lib/stores/toast.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { getMessages } from '$lib/i18n';
import { formatCurrency, formatDate } from '$lib/utils/format';
import {
  Card,
  CardContent,
  Button,
  Input,
  Label,
  Sheet,
  Dialog,
  Skeleton,
  Badge,
} from '$lib/components/ui';
import type { GoalSummary } from '$lib/api/types';

const m = $derived(getMessages(settings.language));

const goals = useQuery<{ goals: GoalSummary[] }>(['goals'], () => api.goals.list());

// Create/edit form
let formOpen = $state(false);
let editing = $state<GoalSummary | null>(null);
let formName = $state('');
let formTarget = $state(0);
let formCurrent = $state(0);
let formDeadline = $state('');
let formCategory = $state<string>('');
let saving = $state(false);

// Contribute dialog
let contributeOpen = $state(false);
let contributeFor = $state<GoalSummary | null>(null);
let contributeAmount = $state(0);
let contributeNote = $state('');

function startCreate() {
  editing = null;
  formName = '';
  formTarget = 0;
  formCurrent = 0;
  formDeadline = '';
  formCategory = '';
  formOpen = true;
}

function startEdit(g: GoalSummary) {
  editing = g;
  formName = g.name;
  formTarget = g.targetAmount;
  formCurrent = g.currentAmount;
  formDeadline = g.deadline ?? '';
  formCategory = g.linkedCategory ?? '';
  formOpen = true;
}

async function save() {
  if (!formName.trim() || formTarget <= 0) {
    toast.warning('Name and target required');
    return;
  }
  saving = true;
  try {
    if (editing) {
      await api.goals.patch(editing.id, {
        name: formName.trim(),
        targetAmount: formTarget,
        currentAmount: formCurrent,
        deadline: formDeadline || null,
        linkedCategory: (formCategory as Category) || null,
      } as never);
    } else {
      await api.goals.create({
        name: formName.trim(),
        targetAmount: formTarget,
        currentAmount: formCurrent,
        ...(formDeadline ? { deadline: formDeadline } : {}),
        ...(formCategory ? { linkedCategory: formCategory as Category } : {}),
      } as never);
    }
    invalidate(['goals']);
    toast.success(editing ? 'Goal updated' : 'Goal created');
    formOpen = false;
  } catch (err) {
    toast.error('Save failed', err instanceof Error ? err.message : String(err));
  } finally {
    saving = false;
  }
}

function startContribute(g: GoalSummary) {
  contributeFor = g;
  contributeAmount = 0;
  contributeNote = '';
  contributeOpen = true;
}

async function commitContribution() {
  if (!contributeFor || contributeAmount <= 0) return;
  try {
    await api.goals.progress(contributeFor.id, {
      amount: contributeAmount,
      ...(contributeNote ? { note: contributeNote } : {}),
    });
    invalidate(['goals']);
    toast.success(`+${formatCurrency(contributeAmount)} to ${contributeFor.name}`);
    contributeOpen = false;
  } catch (err) {
    toast.error('Failed', err instanceof Error ? err.message : String(err));
  }
}

async function remove(g: GoalSummary) {
  if (!confirm(`Delete goal "${g.name}"?`)) return;
  try {
    await api.goals.delete(g.id);
    invalidate(['goals']);
    toast.success('Deleted');
  } catch (err) {
    toast.error('Delete failed', err instanceof Error ? err.message : String(err));
  }
}

function ringDashOffset(percent: number, circumference: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return circumference * (1 - clamped / 100);
}
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{m.goals.title}</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Set targets, watch them grow.
      </p>
    </div>
    <Button onclick={startCreate}>
      <Plus class="h-4 w-4" />
      {m.goals.create}
    </Button>
  </header>

  {#if goals.loading && !goals.data}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each Array(3) as _, i (i)}
        <Skeleton class="h-48 w-full" />
      {/each}
    </div>
  {:else if (goals.data?.goals ?? []).length === 0}
    <Card>
      <CardContent class="grid place-items-center gap-3 p-12 text-center">
        <Target class="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.goals.noGoals}</p>
        <Button onclick={startCreate}>
          <Plus class="h-4 w-4" />
          {m.goals.create}
        </Button>
      </CardContent>
    </Card>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each goals.data?.goals ?? [] as g (g.id)}
        {@const radius = 36}
        {@const circumference = 2 * Math.PI * radius}
        {@const offset = ringDashOffset(g.progressPercentage, circumference)}
        <div in:fly={{ y: 8, duration: 200 }}>
        <Card>
          <CardContent class="flex flex-col gap-3 p-5">
            <div class="flex items-center gap-4">
              <svg width="84" height="84" viewBox="0 0 84 84" class="flex-shrink-0">
                <circle cx="42" cy="42" r={radius} fill="none" stroke="hsl(var(--muted))" stroke-width="6" />
                <circle
                  cx="42"
                  cy="42"
                  r={radius}
                  fill="none"
                  stroke={g.atRisk ? 'hsl(var(--destructive))' : g.status === 'achieved' ? 'rgb(16 185 129)' : 'hsl(var(--primary))'}
                  stroke-width="6"
                  stroke-linecap="round"
                  stroke-dasharray={circumference}
                  stroke-dashoffset={offset}
                  transform="rotate(-90 42 42)"
                  class="transition-all duration-500"
                />
                <text x="42" y="46" text-anchor="middle" class="fill-[hsl(var(--foreground))] text-sm font-semibold">
                  {Math.round(g.progressPercentage)}%
                </text>
              </svg>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <h2 class="truncate text-base font-semibold">{g.name}</h2>
                  <div class="flex flex-shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" aria-label="Edit" onclick={() => startEdit(g)}>
                      <Pencil class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete" onclick={() => remove(g)}>
                      <Trash2 class="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                </div>
                <p class="mt-0.5 text-sm tabular-nums">
                  <span class="font-semibold">{formatCurrency(g.currentAmount)}</span>
                  <span class="text-[hsl(var(--muted-foreground))]"> / {formatCurrency(g.targetAmount)}</span>
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  {#if g.atRisk}
                    <Badge variant="secondary" class="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                      <AlertTriangle class="h-3 w-3" />
                      {m.goals.atRisk}
                    </Badge>
                  {/if}
                  {#if g.status === 'achieved'}
                    <Badge variant="secondary" class="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <Sparkles class="h-3 w-3" />
                      Achieved
                    </Badge>
                  {/if}
                  {#if g.linkedCategory}
                    <Badge variant="outline" class="text-xs">{g.linkedCategory}</Badge>
                  {/if}
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 border-t border-[hsl(var(--border))] pt-3 text-xs">
              <div>
                <p class="text-[hsl(var(--muted-foreground))]">{m.goals.deadline}</p>
                <p class="font-medium">{g.deadline ? formatDate(g.deadline) : '—'}</p>
              </div>
              <div>
                <p class="text-[hsl(var(--muted-foreground))]">{m.goals.projected}</p>
                <p class="font-medium">{g.projectedCompletion ? formatDate(g.projectedCompletion) : '—'}</p>
              </div>
            </div>

            <Button variant="outline" size="sm" onclick={() => startContribute(g)} disabled={g.status !== 'active'}>
              <Plus class="h-4 w-4" />
              {m.goals.contribute}
            </Button>
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
  title={editing ? 'Edit goal' : m.goals.create}
>
  <div class="flex flex-col gap-4 overflow-y-auto pr-1">
    <div class="space-y-1.5">
      <Label for="g-name">Name</Label>
      <Input id="g-name" bind:value={formName} placeholder="Emergency Fund" />
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label for="g-target">{m.goals.target}</Label>
        <Input id="g-target" type="number" min="0" step="500" bind:value={formTarget} />
      </div>
      <div class="space-y-1.5">
        <Label for="g-current">{m.goals.current}</Label>
        <Input id="g-current" type="number" min="0" step="500" bind:value={formCurrent} />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label for="g-deadline">{m.goals.deadline}</Label>
        <Input id="g-deadline" type="date" bind:value={formDeadline} />
      </div>
      <div class="space-y-1.5">
        <Label for="g-cat">Category (auto-progress)</Label>
        <select
          id="g-cat"
          bind:value={formCategory}
          class="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
        >
          <option value="">—</option>
          {#each CATEGORIES as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="mt-auto flex flex-row-reverse gap-2 pt-4">
      <Button onclick={save} disabled={saving}>
        {saving ? 'Saving…' : m.common.save}
      </Button>
      <Button variant="ghost" onclick={() => (formOpen = false)}>{m.common.cancel}</Button>
    </div>
  </div>
</Sheet>

<Dialog
  bind:open={contributeOpen}
  onOpenChange={(v) => (contributeOpen = v)}
  title={contributeFor ? `+ ${contributeFor.name}` : 'Contribute'}
>
  <div class="flex flex-col gap-3">
    <div class="space-y-1.5">
      <Label for="c-amount">Amount</Label>
      <Input id="c-amount" type="number" min="0" step="100" bind:value={contributeAmount} />
    </div>
    <div class="space-y-1.5">
      <Label for="c-note">Note (optional)</Label>
      <Input id="c-note" bind:value={contributeNote} placeholder="Bonus, refund…" />
    </div>
    <div class="flex flex-row-reverse gap-2 pt-2">
      <Button onclick={commitContribution} disabled={contributeAmount <= 0}>{m.common.add}</Button>
      <Button variant="ghost" onclick={() => (contributeOpen = false)}>{m.common.cancel}</Button>
    </div>
  </div>
</Dialog>
