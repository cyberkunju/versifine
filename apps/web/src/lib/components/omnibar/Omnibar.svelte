<script lang="ts">
  /**
   * Omnibar — the single-input multimodal capture surface.
   *
   * - Type freely → POST /capture/text.
   * - Click the mic → record + POST /capture/voice.
   * - Drag/paste an image → POST /capture/image.
   * - Privacy mode disables voice/image and runs the local categoriser
   *   for text intents that look like an expense.
   * - ⌘L (or Ctrl+L) focuses the input from anywhere.
   */
  import { onDestroy, onMount } from 'svelte';
  import { Mic, ImagePlus, ShieldCheck, ShieldOff, Send, Wand2 } from 'lucide-svelte';
  import { browser } from '$app/environment';
  import { api } from '$lib/api/client';
  import { ApiError } from '$lib/api/types';
  import type { CaptureResponse, WalletSummary } from '$lib/api/types';
  import { invalidate } from '$lib/api/queries.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { pendingCaptures } from '$lib/stores/pendingCaptures.svelte';
  import { loadMinilm } from '$lib/ai/minilm-client';
  import { getMessages } from '$lib/i18n';
  import { cn } from '$lib/utils/cn';
  import { formatCurrency } from '$lib/utils/format';
  import { Button, Dialog, Sheet, Tooltip } from '$lib/components/ui';
  import VoiceCapture from './VoiceCapture.svelte';
  import ImageDrop from './ImageDrop.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

  type Props = {
    onOpenCopilot?: (initial?: string) => void;
  };
  let { onOpenCopilot }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state(undefined);
  let value = $state('');
  let busy = $state(false);
  let voiceOpen = $state(false);
  let imageOpen = $state(false);
  let confirmOpen = $state(false);
  let lastResponse = $state<CaptureResponse | null>(null);

  const m = $derived(getMessages(settings.language));

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
      // Privacy mode flow: classify locally first when it looks like an expense.
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
        toast.warning('Saved offline', 'Will sync when you’re back online.');
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
      // Open copilot pre-filled.
      onOpenCopilot?.(echoText);
      value = '';
      return;
    }
    if (result.needsConfirmation && result.draftId) {
      confirmOpen = true;
      return;
    }
    // Success path: a transaction was created or a query answered.
    if (result.queryResult) {
      const tx = (result.queryResult as { transaction?: { amount: number; currency: string; description: string } })
        .transaction;
      if (tx) {
        toast.success(
          'Logged',
          `${formatCurrency(tx.amount, tx.currency as never)} — ${tx.description}`,
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

  /**
   * Privacy-mode text capture: parse a simple "spent N on description"
   * pattern, run the local model, and post a fully-formed transaction so
   * the server never sees the raw text.
   */
  async function handleLocalExpense(text: string) {
    const parsed = parseExpenseText(text);
    if (!parsed) {
      // Falls back to the server pipeline for non-expense intents.
      const result = await api.capture.text(text, settings.language);
      handleResult(text, result);
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
    toast.success('Logged privately', `${formatCurrency(parsed.amount)} — ${parsed.description}`);
    invalidate(['transactions']);
    invalidate(['wallets']);
    invalidate(['budgets']);
    value = '';
  }

  function parseExpenseText(text: string): { amount: number; description: string; walletHint: string | null } | null {
    // Catch "spent 450 on auto", "450 for groceries", "100 cash uber"
    const match =
      text.match(/(?:spent|paid|spend|^)\s*(\d+(?:\.\d+)?)(?:\s+on\s+|\s+for\s+|\s+at\s+|\s+)(.+)/i) ??
      text.match(/^(\d+(?:\.\d+)?)\s+(.+)/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const description = match[2]?.trim() ?? '';
    if (!description) return null;
    const walletHint = description.match(/\b(cash|hdfc|icici|sbi|kotak|axis|amex|paytm|gpay|phonepe|upi|card|wallet)\b/i)?.[0] ?? null;
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

  async function handleVoice(blob: Blob) {
    voiceOpen = false;
    busy = true;
    try {
      const result = await api.capture.voice(blob, settings.language);
      handleResult('[voice]', result);
    } catch (err) {
      toast.error('Voice failed', err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function handleImage(file: File) {
    imageOpen = false;
    busy = true;
    try {
      const result = await api.capture.image(file, settings.language);
      handleResult('[receipt]', result);
    } catch (err) {
      toast.error('Image failed', err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="flex w-full max-w-3xl items-center gap-1.5"
  onsubmit={(e) => {
    e.preventDefault();
    void submit();
  }}
>
  <div class="relative flex-1">
    <Wand2
      class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
    />
    <input
      bind:this={inputEl}
      bind:value
      type="text"
      placeholder={m.topbar.omnibarPlaceholder}
      aria-label="Capture an expense or ask Vivien"
      class={cn(
        'h-10 w-full rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-10 pr-20 text-sm shadow-sm transition-colors',
        'placeholder:text-[hsl(var(--muted-foreground))]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
      )}
    />
    <kbd class="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))] sm:inline-block">
      {m.topbar.omnibarShortcut}
    </kbd>
  </div>

  <Tooltip text={settings.privacyMode ? m.topbar.privacyOn : m.topbar.voice}>
    {#snippet trigger()}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onclick={() => {
          if (settings.privacyMode) return;
          voiceOpen = true;
        }}
        disabled={settings.privacyMode}
        aria-label={m.topbar.voice}
      >
        <Mic class="h-4 w-4" />
      </Button>
    {/snippet}
  </Tooltip>

  <Tooltip text={settings.privacyMode ? m.topbar.privacyOn : m.topbar.image}>
    {#snippet trigger()}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onclick={() => {
          if (settings.privacyMode) return;
          imageOpen = true;
        }}
        disabled={settings.privacyMode}
        aria-label={m.topbar.image}
      >
        <ImagePlus class="h-4 w-4" />
      </Button>
    {/snippet}
  </Tooltip>

  {#if settings.privacyMode}
    <Tooltip text={m.topbar.privacyOn}>
      {#snippet trigger()}
        <span class="grid h-9 w-9 place-items-center text-emerald-600 dark:text-emerald-400" aria-hidden="true">
          <ShieldCheck class="h-4 w-4" />
        </span>
      {/snippet}
    </Tooltip>
  {:else}
    <Tooltip text={m.topbar.privacyOff}>
      {#snippet trigger()}
        <span class="grid h-9 w-9 place-items-center text-[hsl(var(--muted-foreground))]" aria-hidden="true">
          <ShieldOff class="h-4 w-4" />
        </span>
      {/snippet}
    </Tooltip>
  {/if}

  <Button type="submit" size="icon" disabled={busy || !value.trim()} aria-label="Submit capture">
    <Send class="h-4 w-4" />
  </Button>
</form>

<Dialog bind:open={voiceOpen} title="Record a voice note" description="Tap the mic, talk, tap to stop.">
  <VoiceCapture onComplete={handleVoice} onError={(message) => toast.error('Microphone', message)} />
</Dialog>

<Sheet bind:open={imageOpen} side="bottom" title="Attach a receipt" description="We’ll extract the amount and merchant.">
  <ImageDrop onPick={handleImage} />
</Sheet>

<ConfirmDialog
  bind:open={confirmOpen}
  response={lastResponse}
  onClose={() => {
    confirmOpen = false;
  }}
/>
