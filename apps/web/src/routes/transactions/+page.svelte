<script lang="ts">
  /**
   * Transactions ledger.
   *
   * Filterable list with inline search, type/category/wallet selects, a
   * date range, and a side drawer for editing. CSV import + export work
   * straight off the API. Bulk actions cover the most common housekeeping:
   * change category for the selection, soft-delete the selection.
   */
  import { fly, fade } from 'svelte/transition';
  import {
    Search,
    Download,
    Upload,
    Trash2,
    Tag,
    Sparkles,
    XCircle,
    ArrowRight,
  } from 'lucide-svelte';
  import { CATEGORIES, CATEGORY_META, type Category } from '@versifine/shared';
  import { api } from '$lib/api/client';
  import { useQuery, invalidate } from '$lib/api/queries.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { formatCurrency, relativeDate } from '$lib/utils/format';
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Button,
    Input,
    Badge,
    Skeleton,
  } from '$lib/components/ui';
  import TransactionDrawer from '$lib/components/transactions/TransactionDrawer.svelte';
  import type {
    TransactionListQuery,
    TransactionSummary,
    TransactionType,
    WalletSummary,
  } from '$lib/api/types';

  const m = $derived(getMessages(settings.language));

  // Filter state
  let from = $state<string>('');
  let to = $state<string>('');
  let typeFilter = $state<TransactionType | ''>('');
  let categoryFilter = $state<string>('');
  let walletFilter = $state<string>('');
  let search = $state<string>('');
  let limit = $state(50);
  let offset = $state(0);

  const wallets = useQuery<{ wallets: WalletSummary[] }>(['wallets'], () => api.wallets.list());

  const filters = $derived<Partial<TransactionListQuery>>({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(typeFilter ? { type: typeFilter as TransactionType } : {}),
    ...(categoryFilter ? { category: categoryFilter as Category } : {}),
    ...(walletFilter ? { walletId: walletFilter } : {}),
    ...(search ? { search } : {}),
    limit,
    offset,
  });

  // Use a reactive query that re-fetches when filter key changes.
  const transactions = useQuery<{
    items: TransactionSummary[];
    total: number;
    limit: number;
    offset: number;
  }>(['transactions', 'list'], () => api.transactions.list(filters));
  $effect(() => {
    // Re-run on any filter change.
    void filters;
    transactions.refetch();
  });

  // Bulk selection
  let selected = $state<Set<string>>(new Set<string>());
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function selectAll() {
    selected = new Set((transactions.data?.items ?? []).map((t) => t.id));
  }
  function clearSelection() {
    selected = new Set();
  }

  // Detail drawer
  let drawerOpen = $state(false);
  let activeTx = $state<TransactionSummary | null>(null);

  function openTransaction(tx: TransactionSummary) {
    activeTx = tx;
    drawerOpen = true;
  }

  async function bulkChangeCategory(category: Category) {
    if (selected.size === 0) return;
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      try {
        await api.transactions.correctCategory(id, category);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    invalidate(['transactions']);
    invalidate(['budgets']);
    invalidate(['reports']);
    clearSelection();
    if (fail === 0) toast.success(`Updated ${ok}`, `Now in ${category}.`);
    else toast.warning(`Updated ${ok}, failed ${fail}`);
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`)) return;
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      try {
        await api.transactions.delete(id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    invalidate(['transactions']);
    invalidate(['budgets']);
    invalidate(['reports']);
    clearSelection();
    if (fail === 0) toast.success(`Deleted ${ok}`);
    else toast.warning(`Deleted ${ok}, failed ${fail}`);
  }

  function exportCsv() {
    const url = api.transactions.exportCsvUrl(filters);
    window.open(url, '_blank');
  }

  let importInput = $state<HTMLInputElement | null>(null);
  async function importCsv(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await api.transactions.import(form);
      toast.success('Imported', `${result.imported} added, ${result.skipped} skipped.`);
      invalidate(['transactions']);
      invalidate(['budgets']);
    } catch {
      toast.error('Import failed', 'Check the CSV format and try again.');
    } finally {
      input.value = '';
    }
  }

  function clearAllFilters() {
    from = '';
    to = '';
    typeFilter = '';
    categoryFilter = '';
    walletFilter = '';
    search = '';
    offset = 0;
  }

  const total = $derived(transactions.data?.total ?? 0);
  const pageStart = $derived(offset + 1);
  const pageEnd = $derived(Math.min(offset + limit, total));
  const hasPrev = $derived(offset > 0);
  const hasNext = $derived(offset + limit < total);
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{m.transactions.title}</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        {transactions.loading ? m.common.loading : `${total.toLocaleString()} total`}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <input
        bind:this={importInput}
        type="file"
        accept=".csv,text/csv"
        class="hidden"
        onchange={importCsv}
      />
      <Button variant="outline" size="sm" onclick={() => importInput?.click()}>
        <Upload class="h-4 w-4" />
        {m.transactions.importCsv}
      </Button>
      <Button variant="outline" size="sm" onclick={exportCsv}>
        <Download class="h-4 w-4" />
        {m.transactions.exportCsv}
      </Button>
    </div>
  </header>

  <Card>
    <CardContent class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
      <div class="lg:col-span-2">
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="search">{m.transactions.search}</label>
        <div class="relative mt-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <Input
            id="search"
            class="pl-9"
            placeholder="merchant, note, tag…"
            bind:value={search}
          />
        </div>
      </div>
      <div>
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="from">{m.transactions.from}</label>
        <Input id="from" type="date" bind:value={from} class="mt-1" />
      </div>
      <div>
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="to">{m.transactions.to}</label>
        <Input id="to" type="date" bind:value={to} class="mt-1" />
      </div>
      <div>
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="type">{m.transactions.type}</label>
        <select
          id="type"
          bind:value={typeFilter}
          class="mt-1 h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
        >
          <option value="">All</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>
      <div>
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="cat">{m.transactions.category}</label>
        <select
          id="cat"
          bind:value={categoryFilter}
          class="mt-1 h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
        >
          <option value="">All</option>
          {#each CATEGORIES as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
      </div>
      <div class="lg:col-span-2">
        <label class="text-xs font-medium text-[hsl(var(--muted-foreground))]" for="wallet">{m.transactions.wallet}</label>
        <select
          id="wallet"
          bind:value={walletFilter}
          class="mt-1 h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
        >
          <option value="">All wallets</option>
          {#each (wallets.data?.wallets ?? []).filter((w) => !w.archived) as w (w.id)}
            <option value={w.id}>{w.name} ({w.currency})</option>
          {/each}
        </select>
      </div>
      <div class="flex items-end justify-end gap-2 lg:col-span-2">
        <Button variant="ghost" size="sm" onclick={clearAllFilters}>
          <XCircle class="h-4 w-4" />
          Clear
        </Button>
      </div>
    </CardContent>
  </Card>

  {#if selected.size > 0}
    <div
      class="flex items-center gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-2 text-sm"
      in:fly={{ y: -8, duration: 200 }}
    >
      <span class="font-medium">{selected.size} selected</span>
      <span class="ml-auto inline-flex items-center gap-2">
        <select
          class="h-8 rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-xs"
          onchange={(e) => {
            const value = (e.currentTarget as HTMLSelectElement).value;
            if (value) {
              void bulkChangeCategory(value as Category);
              (e.currentTarget as HTMLSelectElement).value = '';
            }
          }}
        >
          <option value="">{m.transactions.bulkChangeCategory}…</option>
          {#each CATEGORIES as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
        <Button variant="destructive" size="sm" onclick={bulkDelete}>
          <Trash2 class="h-4 w-4" />
          {m.transactions.bulkDelete}
        </Button>
        <Button variant="ghost" size="sm" onclick={clearSelection}>Cancel</Button>
      </span>
    </div>
  {/if}

  <Card>
    <CardContent class="p-0">
      {#if transactions.loading && !transactions.data}
        <div class="space-y-2 p-4">
          {#each Array(8) as _, i (i)}
            <Skeleton class="h-10 w-full" />
          {/each}
        </div>
      {:else if (transactions.data?.items ?? []).length === 0}
        <p class="p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          {m.transactions.none}
        </p>
      {:else}
        <table class="w-full text-sm">
          <thead class="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
            <tr>
              <th class="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={(transactions.data?.items.length ?? 0) > 0 &&
                    (transactions.data?.items.every((t) => selected.has(t.id)) ?? false)}
                  onchange={(e) => ((e.currentTarget as HTMLInputElement).checked ? selectAll() : clearSelection())}
                />
              </th>
              <th class="px-3 py-3">Date</th>
              <th class="px-3 py-3">Description</th>
              <th class="px-3 py-3">Category</th>
              <th class="px-3 py-3">Wallet</th>
              <th class="px-3 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {#each transactions.data?.items ?? [] as tx (tx.id)}
              {@const meta = tx.category ? CATEGORY_META[tx.category as Category] : null}
              {@const wallet = wallets.data?.wallets.find((w) => w.id === tx.walletId)}
              <tr
                class="cursor-pointer border-b border-[hsl(var(--border))] last:border-0 transition-colors hover:bg-[hsl(var(--muted)/0.4)]"
                in:fade={{ duration: 150 }}
                onclick={() => openTransaction(tx)}
              >
                <td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select transaction"
                    checked={selected.has(tx.id)}
                    onchange={() => toggle(tx.id)}
                  />
                </td>
                <td class="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
                  {relativeDate(tx.date)}
                </td>
                <td class="px-3 py-3">
                  <div class="flex items-center gap-2">
                    <span class="grid h-7 w-7 place-items-center rounded-full bg-[hsl(var(--muted))] text-sm">
                      {meta?.icon ?? '•'}
                    </span>
                    <span class="font-medium">{tx.description}</span>
                  </div>
                </td>
                <td class="px-3 py-3">
                  {#if tx.category}
                    <Badge variant="secondary" class="text-xs">{tx.category}</Badge>
                  {:else}
                    <span class="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                  {/if}
                </td>
                <td class="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                  {wallet?.name ?? '—'}
                </td>
                <td
                  class="px-3 py-3 text-right tabular-nums font-semibold"
                  class:text-emerald-600={tx.type === 'income'}
                >
                  {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}{formatCurrency(tx.amount, tx.currency)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </CardContent>
  </Card>

  {#if total > limit}
    <div class="flex items-center justify-between text-sm">
      <span class="text-[hsl(var(--muted-foreground))]">
        Showing {pageStart}–{pageEnd} of {total.toLocaleString()}
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrev}
          onclick={() => (offset = Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onclick={() => (offset = offset + limit)}
        >
          Next
          <ArrowRight class="h-4 w-4" />
        </Button>
      </div>
    </div>
  {/if}
</div>

<TransactionDrawer
  bind:open={drawerOpen}
  onOpenChange={(v) => {
    drawerOpen = v;
    if (!v) activeTx = null;
  }}
  transaction={activeTx}
  wallets={wallets.data?.wallets ?? []}
/>

<!-- Reference imports the linker would otherwise drop. -->
{#if false}
  <Tag />
  <Sparkles />
{/if}
