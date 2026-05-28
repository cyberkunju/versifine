<script lang="ts">
  /**
   * Right-side detail drawer for a single transaction. Inline editable
   * fields (amount, date, description, category, wallet); the category
   * chip itself is the picker. Delete button at the bottom.
   */
  import { CATEGORIES, CATEGORY_META, type Category } from '@finehance/shared';
  import { api } from '$lib/api/client';
  import { invalidate } from '$lib/api/queries';
  import type { TransactionSummary, WalletSummary } from '$lib/api/types';
  import { toast } from '$lib/stores/toast.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, formatDate } from '$lib/utils/format';
  import { Sheet, Button, Input, Label, Badge, Popover } from '$lib/components/ui';

  type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transaction: TransactionSummary | null;
    wallets: WalletSummary[];
  };

  let { open = $bindable(), onOpenChange, transaction, wallets }: Props = $props();
  const m = $derived(getMessages(settings.language));

  let amount = $state<number>(0);
  let description = $state('');
  let date = $state('');
  let walletId = $state('');
  let saving = $state(false);
  let categoryPickerOpen = $state(false);

  $effect(() => {
    if (transaction) {
      amount = transaction.amount;
      description = transaction.description;
      date = transaction.date;
      walletId = transaction.walletId;
    }
  });

  async function save() {
    if (!transaction) return;
    saving = true;
    try {
      const body: Record<string, unknown> = {};
      if (amount !== transaction.amount) body.amount = amount;
      if (description !== transaction.description) body.description = description;
      if (date !== transaction.date) body.date = date;
      if (walletId !== transaction.walletId) body.walletId = walletId;
      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        return;
      }
      await api.transactions.patch(transaction.id, body as never);
      invalidate(['transactions']);
      invalidate(['wallets']);
      invalidate(['budgets']);
      toast.success(m.transactions.saved);
      onOpenChange(false);
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }

  async function pickCategory(cat: Category) {
    if (!transaction) return;
    categoryPickerOpen = false;
    try {
      await api.transactions.correctCategory(transaction.id, cat);
      invalidate(['transactions']);
      invalidate(['budgets']);
      toast.success('Category updated');
    } catch (err) {
      toast.error('Failed', err instanceof Error ? err.message : String(err));
    }
  }

  async function remove() {
    if (!transaction) return;
    try {
      await api.transactions.delete(transaction.id);
      invalidate(['transactions']);
      invalidate(['wallets']);
      invalidate(['budgets']);
      toast.success(m.transactions.deleted);
      onOpenChange(false);
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : String(err));
    }
  }
</script>

<Sheet bind:open onOpenChange={(v) => onOpenChange(v)} side="right" title={transaction?.description ?? ''}>
  {#if transaction}
    {@const meta = transaction.category ? CATEGORY_META[transaction.category as Category] : null}
    <div class="flex flex-col gap-4 overflow-y-auto pr-2">
      <div class="flex items-center justify-between">
        <span class="text-2xl font-semibold tabular-nums">
          {transaction.type === 'expense' ? '−' : ''}{formatCurrency(transaction.amount, transaction.currency)}
        </span>
        <Popover bind:open={categoryPickerOpen}>
          {#snippet trigger()}
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs hover:bg-[hsl(var(--accent))]"
              aria-label={m.transactions.correctCategory}
            >
              <span aria-hidden="true">{meta?.icon ?? '•'}</span>
              {transaction.category ?? 'Uncategorised'}
            </button>
          {/snippet}
          {#snippet content()}
            <div class="grid max-h-72 grid-cols-2 gap-1 overflow-y-auto">
              {#each CATEGORIES as cat (cat)}
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[hsl(var(--accent))]"
                  onclick={() => pickCategory(cat)}
                >
                  <span aria-hidden="true">{CATEGORY_META[cat].icon}</span>
                  {cat}
                </button>
              {/each}
            </div>
          {/snippet}
        </Popover>
      </div>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">
        {formatDate(transaction.date)} · {transaction.source}{#if transaction.categorizedBy} · {transaction.categorizedBy}{/if}
      </p>

      <div class="grid gap-3">
        <div class="space-y-1.5">
          <Label for="t-amount">Amount</Label>
          <Input id="t-amount" type="number" min="0" step="0.01" bind:value={amount} />
        </div>
        <div class="space-y-1.5">
          <Label for="t-desc">Description</Label>
          <Input id="t-desc" bind:value={description} />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="t-date">Date</Label>
            <Input id="t-date" type="date" bind:value={date} />
          </div>
          <div class="space-y-1.5">
            <Label for="t-wallet">Wallet</Label>
            <select
              id="t-wallet"
              bind:value={walletId}
              class="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            >
              {#each wallets as w (w.id)}
                <option value={w.id}>{w.name}</option>
              {/each}
            </select>
          </div>
        </div>
        {#if transaction.tags && transaction.tags.length > 0}
          <div class="flex flex-wrap gap-1">
            {#each transaction.tags as tag, i (i)}
              <Badge variant="outline">{tag}</Badge>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mt-2 flex flex-row-reverse gap-2">
        <Button onclick={save} disabled={saving}>
          {saving ? 'Saving…' : m.common.save}
        </Button>
        <Button variant="ghost" onclick={() => onOpenChange(false)}>{m.common.cancel}</Button>
      </div>
      <div class="mt-2 border-t border-[hsl(var(--border))] pt-3">
        <Button variant="destructive" onclick={remove}>{m.transactions.delete}</Button>
      </div>
    </div>
  {/if}
</Sheet>
