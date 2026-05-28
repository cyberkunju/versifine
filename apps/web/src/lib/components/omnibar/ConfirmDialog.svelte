<script lang="ts">
  /**
   * Draft confirmation. Surfaces the parsed transaction fields and lets
   * the user nudge anything before committing — wallet, category, amount,
   * description, date.
   */
  import type { CaptureResponse } from '$lib/api/types';
  import { CATEGORIES, type Category } from '@finehance/shared';
  import { api } from '$lib/api/client';
  import { invalidate } from '$lib/api/queries';
  import { toast } from '$lib/stores/toast.svelte';
  import { formatCurrency } from '$lib/utils/format';
  import { Button, Dialog, Input, Label } from '$lib/components/ui';

  type Props = {
    open: boolean;
    response: CaptureResponse | null;
    onClose: () => void;
  };
  let { open = $bindable(), response, onClose }: Props = $props();

  let amount = $state<number | undefined>(undefined);
  let description = $state('');
  let category = $state<Category | ''>('');
  let date = $state('');
  let walletHint = $state('');
  let saving = $state(false);

  $effect(() => {
    const draft = response?.draft;
    if (!draft) return;
    amount = draft.amount ?? undefined;
    description = draft.description ?? '';
    category = (draft.category as Category) ?? '';
    date = draft.date ?? new Date().toISOString().slice(0, 10);
    walletHint = draft.walletHint ?? '';
  });

  async function commit() {
    if (!response?.draftId) return;
    saving = true;
    try {
      const edits: Record<string, unknown> = {};
      if (amount !== undefined) edits.amount = Number(amount);
      if (description) edits.description = description;
      if (category) edits.categoryHint = category;
      if (date) edits.date = date;
      if (walletHint) edits.walletHint = walletHint;
      const result = await api.capture.confirm({ draftId: response.draftId, edits });
      const tx = (result.queryResult?.transaction as { amount: number; currency: string; description: string }) ?? null;
      if (tx) {
        toast.success(
          'Saved',
          `${formatCurrency(tx.amount, tx.currency as never)} — ${tx.description}`,
        );
      } else {
        toast.success('Saved', response.followupQuestion ?? '');
      }
      invalidate(['transactions']);
      invalidate(['wallets']);
      invalidate(['budgets']);
      invalidate(['forecast']);
      onClose();
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }
</script>

<Dialog
  bind:open
  onOpenChange={(v) => {
    if (!v) onClose();
  }}
  title="Confirm transaction"
  description={response?.followupQuestion ?? 'Looks like a draft — confirm or edit before saving.'}
>
  {#if response?.draft}
    <div class="grid gap-3">
      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <Label for="amount">Amount</Label>
          <Input id="amount" type="number" min="0" step="0.01" bind:value={amount} />
        </div>
        <div class="space-y-1.5">
          <Label for="date">Date</Label>
          <Input id="date" type="date" bind:value={date} />
        </div>
      </div>
      <div class="space-y-1.5">
        <Label for="desc">Description</Label>
        <Input id="desc" bind:value={description} placeholder="What was it?" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <Label for="cat">Category</Label>
          <select
            id="cat"
            bind:value={category}
            class="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
          >
            <option value="">Auto</option>
            {#each CATEGORIES as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </div>
        <div class="space-y-1.5">
          <Label for="wallet">Wallet hint</Label>
          <Input id="wallet" bind:value={walletHint} placeholder="cash" />
        </div>
      </div>
    </div>
  {/if}
  {#snippet footer()}
    <Button onclick={commit} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </Button>
    <Button variant="ghost" onclick={onClose}>Cancel</Button>
  {/snippet}
</Dialog>
