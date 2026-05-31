<script lang="ts">
  /**
   * Settings page.
   *
   * Account profile, language picker, base currency, Privacy Mode toggle,
   * WhatsApp linking, and wallets management. Each card is self-contained
   * so the user can scan to the section they need.
   */
  import { fly } from 'svelte/transition';
  import {
    User,
    Languages,
    DollarSign,
    ShieldCheck,
    MessageSquare,
    Wallet as WalletIcon,
    Plus,
    Trash2,
    LogOut,
    Copy,
  } from 'lucide-svelte';
  import { LANGUAGES, LANGUAGE_META, type Language } from '@versifine/shared';
  import { CURRENCIES, type Currency } from '@versifine/shared';
  import { api } from '$lib/api/client';
  import { useQuery, invalidate } from '$lib/api/queries.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { toast } from '$lib/stores/toast.svelte';
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
    Switch,
    Badge,
    Skeleton,
  } from '$lib/components/ui';
  import { loadMinilm } from '$lib/ai/minilm-client';
  import type { WalletSummary, WalletType, PhoneLinkStartResponse } from '$lib/api/types';

  const m = $derived(getMessages(settings.language));

  // ───────── Account ─────────
  let displayName = $state(auth.user?.displayName ?? '');
  $effect(() => {
    if (auth.user) displayName = auth.user.displayName ?? '';
  });

  // ───────── Privacy mode ─────────
  let privacyOn = $state(settings.privacyMode);
  $effect(() => {
    privacyOn = settings.privacyMode;
  });

  let privacyState = $state<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  let privacyDownloadPct = $state(0);

  async function togglePrivacy(next: boolean) {
    if (!next) {
      settings.setPrivacyMode(false);
      privacyState = 'idle';
      return;
    }
    privacyState = 'loading';
    try {
      const classify = await loadMinilm((progress) => {
        if (progress.loaded && progress.total) {
          privacyDownloadPct = (progress.loaded / progress.total) * 100;
        }
      });
      if (!classify) {
        privacyState = 'unavailable';
        privacyOn = false;
        toast.warning('Privacy mode unavailable', 'Model artifact missing — see docs.');
        return;
      }
      settings.setPrivacyMode(true);
      privacyState = 'ready';
      toast.success('Privacy mode on', 'Categorization runs locally now.');
    } catch (err) {
      privacyState = 'unavailable';
      privacyOn = false;
      toast.warning(
        'Privacy mode unavailable',
        err instanceof Error ? err.message : 'Model artifact missing.',
      );
    }
  }

  // ───────── Phone link ─────────
  let linkInfo = $state<PhoneLinkStartResponse | null>(null);
  let linkBusy = $state(false);
  async function startLink() {
    linkBusy = true;
    try {
      linkInfo = await api.auth.phoneLinkStart();
      toast.success('Link code generated', 'Send the shown LINK command to the bot.');
    } catch (err) {
      toast.error('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      linkBusy = false;
    }
  }

  // ───────── Wallets ─────────
  const wallets = useQuery<{ wallets: WalletSummary[] }>(['wallets'], () => api.wallets.list());

  let newWalletName = $state('');
  let newWalletType = $state<WalletType>('cash');
  let newWalletCurrency = $state<string>('INR');
  let newWalletOpening = $state(0);
  let walletBusy = $state(false);

  async function addWallet() {
    if (!newWalletName.trim()) return;
    walletBusy = true;
    try {
      await api.wallets.create({
        name: newWalletName.trim(),
        type: newWalletType,
        currency: newWalletCurrency as never,
        openingBalance: newWalletOpening,
      } as never);
      invalidate(['wallets']);
      toast.success('Wallet added');
      newWalletName = '';
      newWalletOpening = 0;
    } catch (err) {
      toast.error('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      walletBusy = false;
    }
  }

  async function archiveWallet(w: WalletSummary) {
    if (!confirm(`Archive "${w.name}"?`)) return;
    try {
      await api.wallets.delete(w.id);
      invalidate(['wallets']);
      toast.success('Archived');
    } catch (err) {
      toast.error('Failed', err instanceof Error ? err.message : String(err));
    }
  }

  function copyToClipboard(text: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    toast.info('Copied');
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{m.settings.title}</h1>
      <p class="text-sm text-[hsl(var(--muted-foreground))]">
        Tune Versifine to match how you work.
      </p>
    </div>
    <Button variant="outline" onclick={() => auth.logout()}>
      <LogOut class="h-4 w-4" />
      {m.nav.signOut}
    </Button>
  </header>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- Account -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <User class="h-4 w-4" />
          {m.settings.account}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="space-y-1.5">
          <Label for="s-email">Email</Label>
          <Input id="s-email" value={auth.user?.email ?? ''} readonly class="bg-[hsl(var(--muted))]" />
        </div>
        <div class="space-y-1.5">
          <Label for="s-name">Display name</Label>
          <Input id="s-name" bind:value={displayName} placeholder="Your name" />
        </div>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">
          Account ID: {auth.user?.id?.slice(0, 8)}…
        </p>
      </CardContent>
    </Card>

    <!-- Language + currency -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <Languages class="h-4 w-4" />
          {m.settings.language} · {m.settings.baseCurrency}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div>
          <Label for="s-lang" class="text-xs text-[hsl(var(--muted-foreground))]">{m.settings.language}</Label>
          <select
            id="s-lang"
            value={settings.language}
            onchange={(e) => settings.setLanguage(e.currentTarget.value as Language)}
            class="mt-1 h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
          >
            {#each LANGUAGES as lang (lang)}
              <option value={lang}>
                {LANGUAGE_META[lang].englishName} — {LANGUAGE_META[lang].nativeName}
              </option>
            {/each}
          </select>
        </div>
        <div>
          <Label for="s-cur" class="text-xs text-[hsl(var(--muted-foreground))]">{m.settings.baseCurrency}</Label>
          <select
            id="s-cur"
            value={settings.baseCurrency}
            onchange={(e) => settings.setBaseCurrency(e.currentTarget.value as Currency)}
            class="mt-1 h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
          >
            {#each CURRENCIES as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </div>
      </CardContent>
    </Card>

    <!-- Privacy -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <ShieldCheck class="h-4 w-4" />
          {m.settings.privacy}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.settings.privacyHelp}</p>
        <div class="flex items-center justify-between rounded-md border border-[hsl(var(--border))] p-3">
          <div>
            <p class="text-sm font-medium">Privacy mode</p>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">
              {#if privacyState === 'loading'}
                {m.settings.privacyDownload} {privacyDownloadPct.toFixed(0)}%
              {:else if privacyState === 'ready' || settings.privacyMode}
                {m.settings.privacyReady}
              {:else if privacyState === 'unavailable'}
                {m.settings.privacyUnavailable}
              {:else}
                Off
              {/if}
            </p>
          </div>
          <Switch bind:checked={privacyOn} onCheckedChange={(v) => togglePrivacy(v)} />
        </div>
      </CardContent>
    </Card>

    <!-- Phone link -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <MessageSquare class="h-4 w-4" />
          {m.settings.phone}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{m.settings.phoneHelp}</p>
        {#if auth.user?.whatsappPhone}
          <div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <p class="font-medium">Linked: ****{auth.user.whatsappPhone.slice(-4)}</p>
            <p class="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              You can already send messages to the bot.
            </p>
          </div>
        {:else if linkInfo}
          <div class="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
            <p class="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Your code</p>
            {#if linkInfo.code}
              <div class="mt-1 flex items-center gap-2">
                <code class="text-2xl font-bold tracking-widest">{linkInfo.code}</code>
                <Button variant="ghost" size="icon" aria-label="Copy" onclick={() => copyToClipboard(linkInfo!.code!)}>
                  <Copy class="h-4 w-4" />
                </Button>
              </div>
              <p class="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                Send <span class="font-mono">LINK {linkInfo.code}</span> to the Versifine bot. Code expires {new Date(linkInfo.expiresAt).toLocaleString()}.
              </p>
            {:else}
              <p class="text-sm">
                Could not show a code. Generate a new link code and try again.
              </p>
            {/if}
          </div>
        {:else}
          <Button onclick={startLink} disabled={linkBusy}>
            {linkBusy ? 'Generating…' : m.settings.phoneStart}
          </Button>
        {/if}
      </CardContent>
    </Card>
  </div>

  <!-- Wallets -->
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2 text-base">
        <WalletIcon class="h-4 w-4" />
        {m.settings.wallets}
      </CardTitle>
    </CardHeader>
    <CardContent>
      {#if wallets.loading && !wallets.data}
        <Skeleton class="h-24 w-full" />
      {:else}
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each wallets.data?.wallets ?? [] as w (w.id)}
            <div
              class="flex items-center justify-between rounded-md border border-[hsl(var(--border))] p-3 text-sm"
              class:opacity-50={w.archived}
              in:fly={{ y: 6, duration: 200 }}
            >
              <div class="min-w-0">
                <p class="truncate font-medium">{w.name}</p>
                <p class="text-xs text-[hsl(var(--muted-foreground))]">
                  {w.type} · {w.currency}{w.archived ? ' · archived' : ''}
                </p>
              </div>
              <div class="text-right">
                <p class="tabular-nums font-semibold">{formatCurrency(w.balance, w.currency as never)}</p>
                {#if !w.archived}
                  <Button variant="ghost" size="icon" aria-label="Archive" onclick={() => archiveWallet(w)}>
                    <Trash2 class="h-4 w-4 text-rose-500" />
                  </Button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-4 grid gap-2 rounded-md border border-dashed border-[hsl(var(--border))] p-3 sm:grid-cols-5">
        <Input bind:value={newWalletName} placeholder="Name (e.g., HDFC)" class="sm:col-span-2" />
        <select
          bind:value={newWalletType}
          class="h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
        >
          <option value="cash">Cash</option>
          <option value="bank">Bank</option>
          <option value="upi">UPI</option>
          <option value="credit_card">Credit card</option>
          <option value="wallet">Wallet</option>
        </select>
        <select
          bind:value={newWalletCurrency}
          class="h-9 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 text-sm"
        >
          {#each CURRENCIES as c (c)}
            <option value={c}>{c}</option>
          {/each}
        </select>
        <Input type="number" min="0" step="100" bind:value={newWalletOpening} placeholder="Opening" />
        <Button onclick={addWallet} disabled={!newWalletName.trim() || walletBusy} class="sm:col-span-5">
          <Plus class="h-4 w-4" />
          {walletBusy ? 'Adding…' : m.settings.addWallet}
        </Button>
      </div>
    </CardContent>
  </Card>
</div>

{#if false}
  <DollarSign />
{/if}
