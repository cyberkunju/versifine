<script lang="ts">
  /**
   * WhatsApp demo allowlist — operator console.
   *
   * Lists the seed (static, read-only) numbers and the dynamic numbers that
   * earned access at runtime, and lets the operator add/remove dynamic
   * numbers. All requests go through the server proxy at /api/allowlist,
   * which holds the bot secret; this page only ever sends an admin token
   * (kept in sessionStorage for the tab's lifetime).
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { Check, Loader2, Lock, Plus, RefreshCw, Trash2, X } from 'lucide-svelte';

  const TOKEN_KEY = 'vf_admin_token';

  let token = $state('');
  let authed = $state(false);
  let tokenInput = $state('');

  let loading = $state(false);
  let working = $state(false);
  let errorMsg = $state<string | null>(null);
  let notice = $state<string | null>(null);

  let seed = $state<string[]>([]);
  let dynamic = $state<string[]>([]);
  let demoMode = $state(true);
  let newPhone = $state('');

  function fmt(phone: string): string {
    // Pretty-print Indian numbers as +91 XXXXX XXXXX; otherwise +<digits>.
    if (phone.length === 12 && phone.startsWith('91')) {
      return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
    }
    return `+${phone}`;
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'x-admin-token': token, ...extra };
  }

  async function load() {
    loading = true;
    errorMsg = null;
    try {
      const res = await fetch('/allowlist/api', { headers: headers() });
      if (res.status === 401) {
        authed = false;
        forgetToken();
        errorMsg = 'That admin token was rejected.';
        return;
      }
      if (!res.ok) {
        errorMsg = await readError(res);
        return;
      }
      const data = (await res.json()) as { seed: string[]; dynamic: string[]; demoMode: boolean };
      seed = data.seed ?? [];
      dynamic = data.dynamic ?? [];
      demoMode = data.demoMode ?? true;
      authed = true;
      rememberToken();
    } catch {
      errorMsg = 'Network error reaching the server.';
    } finally {
      loading = false;
    }
  }

  async function add() {
    const phone = newPhone.trim();
    if (!phone) return;
    working = true;
    errorMsg = null;
    notice = null;
    try {
      const res = await fetch('/allowlist/api', {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        errorMsg = await readError(res);
        return;
      }
      const data = (await res.json()) as { added: boolean; phone: string; reason?: string };
      if (data.reason === 'seed') {
        notice = `${fmt(data.phone)} is already a seed number.`;
      } else if (data.added) {
        notice = `Added ${fmt(data.phone)}.`;
      } else {
        notice = `${fmt(data.phone)} was already on the list.`;
      }
      newPhone = '';
      await load();
    } catch {
      errorMsg = 'Network error while adding.';
    } finally {
      working = false;
    }
  }

  async function remove(phone: string) {
    working = true;
    errorMsg = null;
    notice = null;
    try {
      const res = await fetch('/allowlist/api', {
        method: 'DELETE',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        errorMsg = await readError(res);
        return;
      }
      notice = `Removed ${fmt(phone)}.`;
      await load();
    } catch {
      errorMsg = 'Network error while removing.';
    } finally {
      working = false;
    }
  }

  async function readError(res: Response): Promise<string> {
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      return data.message ?? data.error ?? `Request failed (${res.status}).`;
    } catch {
      return `Request failed (${res.status}).`;
    }
  }

  function submitToken(e: Event) {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    token = tokenInput.trim();
    load();
  }

  function rememberToken() {
    if (!browser) return;
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage blocked — fine, just won't persist for the tab */
    }
  }
  function forgetToken() {
    if (!browser) return;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }
  function signOut() {
    token = '';
    tokenInput = '';
    authed = false;
    seed = [];
    dynamic = [];
    forgetToken();
  }

  onMount(() => {
    if (!browser) return;
    let saved = '';
    try {
      saved = sessionStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      saved = '';
    }
    if (saved) {
      token = saved;
      load();
    }
  });
</script>

<svelte:head>
  <title>Allowlist · Versifine bot</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="min-h-screen bg-[hsl(var(--brand-paper,0_0%_99%))] px-4 py-10 text-slate-900 sm:py-16">
  <div class="mx-auto w-full max-w-2xl">
    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">WhatsApp demo</p>
      <h1 class="mt-2 font-display text-3xl font-medium text-slate-900">Allowlist</h1>
      <p class="mt-2 text-sm text-slate-500">
        Numbers allowed to chat with the demo bot. Seed numbers come from the server config and
        are read-only; dynamic numbers (including everyone who tapped “Try the demo”) can be
        added or removed here.
      </p>
    </header>

    {#if !authed}
      <!-- ============================ Token gate ============================ -->
      <form
        onsubmit={submitToken}
        class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div class="flex items-center gap-2 text-slate-700">
          <Lock class="h-4 w-4" />
          <span class="text-sm font-medium">Admin access</span>
        </div>
        <p class="mt-2 text-sm text-slate-500">Enter the admin token to manage the allowlist.</p>
        <input
          type="password"
          bind:value={tokenInput}
          placeholder="Admin token"
          autocomplete="off"
          class="mt-4 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />
        {#if errorMsg}
          <p class="mt-3 text-sm text-red-600">{errorMsg}</p>
        {/if}
        <button
          type="submit"
          disabled={loading || !tokenInput.trim()}
          class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          {#if loading}<Loader2 class="h-4 w-4 animate-spin" />{/if}
          Unlock
        </button>
      </form>
    {:else}
      <!-- ============================ Console ============================ -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-slate-500">
          <span class={['inline-block h-2 w-2 rounded-full', demoMode ? 'bg-emerald-500' : 'bg-amber-500'].join(' ')}></span>
          {demoMode ? 'Demo mode on — only listed numbers get replies.' : 'Demo mode OFF — bot replies to everyone.'}
        </div>
        <div class="flex items-center gap-2">
          <button
            onclick={load}
            disabled={loading}
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw class={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} />
            Refresh
          </button>
          <button
            onclick={signOut}
            class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </div>

      <!-- Add a number -->
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <form
          onsubmit={(e) => {
            e.preventDefault();
            add();
          }}
          class="flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="tel"
            bind:value={newPhone}
            placeholder="Add a number, e.g. +91 98765 43210"
            class="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
          <button
            type="submit"
            disabled={working || !newPhone.trim()}
            class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {#if working}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Plus class="h-4 w-4" />{/if}
            Add
          </button>
        </form>
        {#if notice}
          <p class="mt-3 flex items-center gap-1.5 text-sm text-emerald-700"><Check class="h-4 w-4" />{notice}</p>
        {/if}
        {#if errorMsg}
          <p class="mt-3 flex items-center gap-1.5 text-sm text-red-600"><X class="h-4 w-4" />{errorMsg}</p>
        {/if}
      </div>

      <!-- Dynamic numbers -->
      <section class="mt-6">
        <h2 class="mb-2 text-sm font-semibold text-slate-700">
          Dynamic <span class="font-normal text-slate-400">({dynamic.length})</span>
        </h2>
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {#if dynamic.length === 0}
            <p class="px-4 py-6 text-center text-sm text-slate-400">No dynamic numbers yet.</p>
          {:else}
            <ul>
              {#each dynamic as phone (phone)}
                <li class="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                  <span class="font-mono text-sm text-slate-800">{fmt(phone)}</span>
                  <button
                    onclick={() => remove(phone)}
                    disabled={working}
                    class="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    aria-label={`Remove ${fmt(phone)}`}
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                    Remove
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </section>

      <!-- Seed numbers (read-only) -->
      <section class="mt-6">
        <h2 class="mb-2 text-sm font-semibold text-slate-700">
          Seed <span class="font-normal text-slate-400">({seed.length}) · from server config, read-only</span>
        </h2>
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
          {#if seed.length === 0}
            <p class="px-4 py-6 text-center text-sm text-slate-400">No seed numbers configured.</p>
          {:else}
            <ul>
              {#each seed as phone (phone)}
                <li class="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                  <span class="font-mono text-sm text-slate-600">{fmt(phone)}</span>
                  <span class="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    <Lock class="h-3 w-3" /> seed
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </section>
    {/if}
  </div>
</div>
