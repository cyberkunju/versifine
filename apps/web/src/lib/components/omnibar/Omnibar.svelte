<script lang="ts">
/**
 * Omnibar - the persistent bottom command input.
 *
 * The visual shell intentionally mirrors the Finehance reference omnibar:
 * a single raised input surface with Vivien's mark on the left and send on
 * the right. Text still flows through the existing capture endpoint.
 */
import { onDestroy, onMount } from 'svelte';
import { Send, Sparkles } from 'lucide-svelte';
import { browser } from '$app/environment';
import { api } from '$lib/api/client';
import { ApiError } from '$lib/api/types';
import type { CaptureResponse, WalletSummary } from '$lib/api/types';
import { invalidate } from '$lib/api/queries.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { toast } from '$lib/stores/toast.svelte';
import { pendingCaptures } from '$lib/stores/pendingCaptures.svelte';
import { loadMinilm } from '$lib/ai/minilm-client';
import { formatCurrency } from '$lib/utils/format';
import { Button } from '$lib/components/ui';
import ConfirmDialog from './ConfirmDialog.svelte';

type Props = {
  onOpenCopilot?: (initial?: string) => void;
};
let { onOpenCopilot }: Props = $props();

let inputEl: HTMLInputElement | undefined = $state(undefined);
let value = $state('');
let busy = $state(false);
let confirmOpen = $state(false);
let lastResponse = $state<CaptureResponse | null>(null);

function handleKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    inputEl?.focus();
  }
}

onMount(() => {
  if (!browser) return;
  window.addEventListener('keydown', handleKey);
});

onDestroy(() => {
  if (!browser) return;
  window.removeEventListener('keydown', handleKey);
});

async function submit() {
  const text = value.trim();
  if (!text || busy) return;
  busy = true;
  try {
    if (settings.privacyMode) {
      await handleLocalExpense(text);
      return;
    }
    const result = await api.capture.text(text, settings.language);
    handleResult(text, result);
  } catch (err) {
    if (err instanceof ApiError) {
      toast.error('Capture failed', err.message);
    } else if (!navigator.onLine) {
      await pendingCaptures.add(text, settings.language);
      toast.warning('Saved offline', "Will sync when you're back online.");
      value = '';
    } else {
      toast.error('Network error', err instanceof Error ? err.message : String(err));
    }
  } finally {
    busy = false;
  }
}

function handleResult(echoText: string, result: CaptureResponse) {
  lastResponse = result;
  if (result.intent === 'chat') {
    onOpenCopilot?.(echoText);
    value = '';
    return;
  }
  if (result.needsConfirmation && result.draftId) {
    confirmOpen = true;
    return;
  }
  if (result.queryResult) {
    const tx = (
      result.queryResult as {
        transaction?: { amount: number; currency: string; description: string };
      }
    ).transaction;
    if (tx) {
      toast.success(
        'Logged',
        `${formatCurrency(tx.amount, tx.currency as never)} - ${tx.description}`,
      );
    } else {
      toast.info('Got it', JSON.stringify(result.queryResult));
    }
  } else {
    toast.success('Captured', result.echo);
  }
  invalidate(['transactions']);
  invalidate(['wallets']);
  invalidate(['budgets']);
  invalidate(['forecast']);
  invalidate(['reports']);
  value = '';
}

async function handleLocalExpense(text: string) {
  const parsed = parseExpenseText(text);
  if (!parsed) {
    toast.warning(
      'Privacy mode is on',
      'This needs server-side understanding. Rephrase as "spent 450 on groceries", or turn off Privacy mode to use the AI parser.',
    );
    return;
  }
  const classifier = await loadMinilm();
  const wallets = await api.wallets.list();
  const wallet = pickWallet(wallets.wallets, parsed.walletHint);
  if (!wallet) {
    toast.error('No wallet', 'Add a wallet in Settings first.');
    return;
  }
  let category: string | undefined;
  if (classifier) {
    const hit = await classifier(parsed.description);
    category = hit?.category;
  }
  await api.transactions.create({
    type: 'expense',
    amount: parsed.amount,
    currency: 'INR',
    date: new Date().toISOString().slice(0, 10),
    description: parsed.description,
    walletId: wallet.id,
    ...(category ? { category: category as never } : {}),
    categorizedBy: 'client',
    tags: [],
  });
  const note = classifier
    ? `${formatCurrency(parsed.amount)} - ${parsed.description}`
    : `${formatCurrency(parsed.amount)} - ${parsed.description} - categorized on the server (local model unavailable)`;
  toast.success('Logged privately', note);
  invalidate(['transactions']);
  invalidate(['wallets']);
  invalidate(['budgets']);
  value = '';
}

function parseExpenseText(
  text: string,
): { amount: number; description: string; walletHint: string | null } | null {
  const match =
    text.match(
      /(?:spent|paid|spend|^)\s*(\d+(?:\.\d+)?)(?:\s+on\s+|\s+for\s+|\s+at\s+|\s+)(.+)/i,
    ) ?? text.match(/^(\d+(?:\.\d+)?)\s+(.+)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const description = match[2]?.trim() ?? '';
  if (!description) return null;
  const walletHint =
    description.match(
      /\b(cash|hdfc|icici|sbi|kotak|axis|amex|paytm|gpay|phonepe|upi|card|wallet)\b/i,
    )?.[0] ?? null;
  return { amount, description, walletHint };
}

function pickWallet(wallets: WalletSummary[], hint: string | null): WalletSummary | null {
  const live = wallets.filter((w) => !w.archived);
  if (live.length === 0) return null;
  if (hint) {
    const match = live.find((w) => w.name.toLowerCase().includes(hint.toLowerCase()));
    if (match) return match;
  }
  return live[0] ?? null;
}
</script>

<form
  class="omni-input-bar flex w-full items-center gap-3"
  onsubmit={(e) => {
    e.preventDefault();
    void submit();
  }}
>
  <span class="omni-input-icon grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_10px_24px_-14px_hsl(var(--primary))]">
    <Sparkles class="h-4 w-4" />
  </span>

  <input
    bind:this={inputEl}
    bind:value
    type="text"
    placeholder="Ask Vivien anything..."
    aria-label="Capture an expense or ask Vivien"
    class="omni-input min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-[hsl(var(--foreground))] shadow-none outline-none placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none"
  />

  <Button
    type="submit"
    size="icon"
    disabled={busy || !value.trim()}
    aria-label="Submit capture"
    class="omni-send h-8 w-8 rounded-lg border border-[hsl(var(--border))] bg-transparent text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))]"
  >
    <Send class="h-4 w-4" />
  </Button>
</form>

<ConfirmDialog
  bind:open={confirmOpen}
  response={lastResponse}
  onClose={() => {
    confirmOpen = false;
  }}
/>

<style>
  .omni-input-bar {
    min-height: 3.25rem;
    border-radius: 0.875rem;
    padding: 0.875rem 1.125rem;
    position: relative;
  }

  .omni-input::placeholder {
    font-weight: 400;
  }
</style>
