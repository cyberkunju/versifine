<script lang="ts">
  /**
   * Versifine operator console — /admin.
   *
   * Single page, credential-gated (httpOnly cookie session minted by
   * /admin/api/login). Houses everything operational:
   *   - WhatsApp pairing: live QR with auto-refresh + connection status,
   *     and an Unlink action that logs the device out and re-shows a QR.
   *   - Demo allowlist: seed (read-only) + dynamic numbers, add/remove.
   *
   * No tokens to type once logged in — the server holds the bot secret.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import {
    Check,
    Loader2,
    LogOut,
    Plus,
    QrCode,
    RefreshCw,
    ShieldCheck,
    Smartphone,
    Trash2,
    TriangleAlert,
    Unlink,
    X,
  } from 'lucide-svelte';

  // ----- auth state -----
  let booting = $state(true);
  let authed = $state(false);
  let username = $state('');
  let password = $state('');
  let loginError = $state<string | null>(null);
  let loggingIn = $state(false);

  // ----- whatsapp pairing state -----
  type QrState = { ready: boolean; hasQr: boolean; dataUri: string | null; svg: string | null };
  let qr = $state<QrState>({ ready: false, hasQr: false, dataUri: null, svg: null });
  let qrLoading = $state(false);
  let qrError = $state<string | null>(null);
  let unlinking = $state(false);
  let confirmUnlink = $state(false);
  let qrTimer: ReturnType<typeof setInterval> | null = null;

  // ----- allowlist state -----
  let seed = $state<string[]>([]);
  let dynamic = $state<string[]>([]);
  let demoMode = $state(true);
  let listLoading = $state(false);
  let listError = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let newPhone = $state('');
  let working = $state(false);

  function fmtPhone(phone: string): string {
    if (phone.length === 12 && phone.startsWith('91')) {
      return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
    }
    return `+${phone}`;
  }

  async function readError(res: Response): Promise<string> {
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      return data.message ?? data.error ?? `Request failed (${res.status}).`;
    } catch {
      return `Request failed (${res.status}).`;
    }
  }

  // ---------------------------------------------------------------- auth
  async function checkSession() {
    try {
      const res = await fetch('/admin/api/session');
      const data = (await res.json()) as { authed: boolean };
      authed = data.authed;
    } catch {
      authed = false;
    } finally {
      booting = false;
    }
    if (authed) startSession();
  }

  async function login(e: Event) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    loggingIn = true;
    loginError = null;
    try {
      const res = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        loginError = await readError(res);
        return;
      }
      authed = true;
      password = '';
      startSession();
    } catch {
      loginError = 'Network error. Try again.';
    } finally {
      loggingIn = false;
    }
  }

  async function logout() {
    stopQrPolling();
    try {
      await fetch('/admin/api/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    authed = false;
    username = '';
    password = '';
  }

  function startSession() {
    void loadAllowlist();
    void loadQr();
    startQrPolling();
  }

  // ------------------------------------------------------------- whatsapp
  async function loadQr() {
    qrLoading = true;
    qrError = null;
    try {
      const res = await fetch('/admin/api/qr');
      if (res.status === 401) {
        authed = false;
        return;
      }
      if (!res.ok) {
        qrError = await readError(res);
        return;
      }
      qr = (await res.json()) as QrState;
    } catch {
      qrError = 'Could not reach the bot.';
    } finally {
      qrLoading = false;
    }
  }

  function startQrPolling() {
    stopQrPolling();
    // Poll every 4s: QR rotates ~every 20s and we want a fresh one quickly
    // after an unlink, plus near-instant flip to "connected" once scanned.
    qrTimer = setInterval(() => {
      if (authed && !qr.ready) void loadQr();
      else if (authed && qr.ready) void loadQr(); // keep status fresh, cheap
    }, 4000);
  }
  function stopQrPolling() {
    if (qrTimer) {
      clearInterval(qrTimer);
      qrTimer = null;
    }
  }

  async function doUnlink() {
    unlinking = true;
    qrError = null;
    try {
      const res = await fetch('/admin/api/unlink', { method: 'POST' });
      if (!res.ok) {
        qrError = await readError(res);
        return;
      }
      confirmUnlink = false;
      // The bot restarts; flip UI to "waiting for QR" and poll harder.
      qr = { ready: false, hasQr: false, dataUri: null, svg: null };
      // Give the bot a moment to come back up, then refresh.
      setTimeout(() => void loadQr(), 3000);
    } catch {
      qrError = 'Unlink request failed.';
    } finally {
      unlinking = false;
    }
  }

  // ------------------------------------------------------------ allowlist
  async function loadAllowlist() {
    listLoading = true;
    listError = null;
    try {
      const res = await fetch('/admin/api/allowlist');
      if (res.status === 401) {
        authed = false;
        return;
      }
      if (!res.ok) {
        listError = await readError(res);
        return;
      }
      const data = (await res.json()) as { seed: string[]; dynamic: string[]; demoMode: boolean };
      seed = data.seed ?? [];
      dynamic = data.dynamic ?? [];
      demoMode = data.demoMode ?? true;
    } catch {
      listError = 'Network error loading the allowlist.';
    } finally {
      listLoading = false;
    }
  }

  async function addPhone(e: Event) {
    e.preventDefault();
    const phone = newPhone.trim();
    if (!phone) return;
    working = true;
    listError = null;
    notice = null;
    try {
      const res = await fetch('/admin/api/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        listError = await readError(res);
        return;
      }
      const data = (await res.json()) as { added: boolean; phone: string; reason?: string };
      notice =
        data.reason === 'seed'
          ? `${fmtPhone(data.phone)} is already a seed number.`
          : data.added
            ? `Added ${fmtPhone(data.phone)}.`
            : `${fmtPhone(data.phone)} was already on the list.`;
      newPhone = '';
      await loadAllowlist();
    } catch {
      listError = 'Network error while adding.';
    } finally {
      working = false;
    }
  }

  async function removePhone(phone: string) {
    working = true;
    listError = null;
    notice = null;
    try {
      const res = await fetch('/admin/api/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        listError = await readError(res);
        return;
      }
      notice = `Removed ${fmtPhone(phone)}.`;
      await loadAllowlist();
    } catch {
      listError = 'Network error while removing.';
    } finally {
      working = false;
    }
  }

  onMount(() => {
    if (!browser) return;
    void checkSession();
  });
  onDestroy(stopQrPolling);
</script>

<svelte:head>
  <title>Operator Console · Versifine</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="admin-root min-h-screen text-slate-100">
  {#if booting}
    <div class="grid min-h-screen place-items-center">
      <Loader2 class="h-6 w-6 animate-spin text-slate-400" />
    </div>
  {:else if !authed}
    <!-- ===================== LOGIN ===================== -->
    <div class="grid min-h-screen place-items-center px-4">
      <div class="w-full max-w-sm">
        <div class="mb-8 text-center">
          <div class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <ShieldCheck class="h-7 w-7 text-white" />
          </div>
          <h1 class="text-xl font-semibold tracking-tight text-white">Operator Console</h1>
          <p class="mt-1 text-sm text-slate-400">Versifine administration</p>
        </div>

        <form onsubmit={login} class="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <label class="block text-xs font-medium text-slate-300" for="u">Username</label>
          <input
            id="u"
            bind:value={username}
            autocomplete="username"
            class="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
            placeholder="cyberkunju"
          />
          <label class="mt-4 block text-xs font-medium text-slate-300" for="p">Password</label>
          <input
            id="p"
            type="password"
            bind:value={password}
            autocomplete="current-password"
            class="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
            placeholder="••••••••••••"
          />
          {#if loginError}
            <p class="mt-3 flex items-center gap-1.5 text-sm text-rose-400"><X class="h-4 w-4" />{loginError}</p>
          {/if}
          <button
            type="submit"
            disabled={loggingIn || !username.trim() || !password}
            class="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-400 hover:to-violet-500 disabled:opacity-50"
          >
            {#if loggingIn}<Loader2 class="h-4 w-4 animate-spin" />{/if}
            Sign in
          </button>
        </form>
        <p class="mt-6 text-center text-xs text-slate-500">Authorised personnel only.</p>
      </div>
    </div>
  {:else}
    <!-- ===================== DASHBOARD ===================== -->
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <!-- Top bar -->
      <header class="mb-8 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
            <ShieldCheck class="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 class="text-lg font-semibold tracking-tight text-white">Operator Console</h1>
            <p class="text-xs text-slate-400">Versifine · WhatsApp bot administration</p>
          </div>
        </div>
        <button
          onclick={logout}
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10"
        >
          <LogOut class="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <!-- ===== WhatsApp pairing card ===== -->
        <section class="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl sm:p-6">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Smartphone class="h-4 w-4 text-indigo-400" />
              <h2 class="text-sm font-semibold text-white">WhatsApp pairing</h2>
            </div>
            <button
              onclick={() => loadQr()}
              disabled={qrLoading}
              class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw class={['h-3.5 w-3.5', qrLoading ? 'animate-spin' : ''].join(' ')} /> Refresh
            </button>
          </div>

          <!-- Status pill -->
          <div class="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2">
            <span class={['relative flex h-2.5 w-2.5', qr.ready ? '' : ''].join(' ')}>
              <span class={['absolute inline-flex h-full w-full rounded-full opacity-75', qr.ready ? 'animate-ping bg-emerald-400' : 'bg-amber-400'].join(' ')}></span>
              <span class={['relative inline-flex h-2.5 w-2.5 rounded-full', qr.ready ? 'bg-emerald-500' : 'bg-amber-500'].join(' ')}></span>
            </span>
            <span class="text-sm font-medium text-white">
              {qr.ready ? 'Connected & ready' : qr.hasQr ? 'Waiting for scan' : 'Starting up…'}
            </span>
          </div>

          <!-- QR / connected panel -->
          <div class="grid place-items-center rounded-xl border border-white/10 bg-slate-950/40 p-5">
            {#if qr.ready}
              <div class="py-8 text-center">
                <div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
                  <Check class="h-7 w-7 text-emerald-400" />
                </div>
                <p class="text-sm font-medium text-white">Bot is paired.</p>
                <p class="mt-1 text-xs text-slate-400">Receiving messages from allowlisted numbers.</p>
              </div>
            {:else if qr.dataUri}
              <img
                src={qr.dataUri}
                alt="WhatsApp pairing QR"
                width="240"
                height="240"
                class="h-60 w-60 rounded-lg bg-white p-2"
              />
              <p class="mt-3 text-center text-xs text-slate-400">
                WhatsApp → Settings → Linked Devices → Link a Device
              </p>
            {:else}
              <div class="grid h-60 w-60 place-items-center rounded-lg border border-dashed border-white/15">
                {#if qrLoading}
                  <Loader2 class="h-6 w-6 animate-spin text-slate-500" />
                {:else}
                  <div class="text-center text-slate-500">
                    <QrCode class="mx-auto h-8 w-8" />
                    <p class="mt-2 text-xs">QR not ready yet…</p>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          {#if qrError}
            <p class="mt-3 flex items-center gap-1.5 text-xs text-rose-400"><X class="h-3.5 w-3.5" />{qrError}</p>
          {/if}

          <!-- Unlink -->
          <div class="mt-5 border-t border-white/10 pt-4">
            {#if !confirmUnlink}
              <button
                onclick={() => (confirmUnlink = true)}
                disabled={!qr.ready}
                class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Unlink class="h-4 w-4" /> Unlink this device
              </button>
              <p class="mt-2 text-center text-[11px] text-slate-500">
                Logs the bot out and shows a fresh QR to pair again.
              </p>
            {:else}
              <div class="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5">
                <p class="flex items-start gap-2 text-xs text-rose-200">
                  <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
                  Unlink now? The bot stops replying until you scan a new QR.
                </p>
                <div class="mt-3 flex gap-2">
                  <button
                    onclick={doUnlink}
                    disabled={unlinking}
                    class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
                  >
                    {#if unlinking}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Unlink class="h-3.5 w-3.5" />{/if}
                    Yes, unlink
                  </button>
                  <button
                    onclick={() => (confirmUnlink = false)}
                    disabled={unlinking}
                    class="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </section>

        <!-- ===== Allowlist card ===== -->
        <section class="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl sm:p-6">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ShieldCheck class="h-4 w-4 text-indigo-400" />
              <h2 class="text-sm font-semibold text-white">Demo allowlist</h2>
            </div>
            <button
              onclick={() => loadAllowlist()}
              disabled={listLoading}
              class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw class={['h-3.5 w-3.5', listLoading ? 'animate-spin' : ''].join(' ')} /> Refresh
            </button>
          </div>

          <div class="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
            <span class={['inline-block h-2 w-2 rounded-full', demoMode ? 'bg-emerald-500' : 'bg-amber-500'].join(' ')}></span>
            {demoMode ? 'Demo mode on — only listed numbers get replies.' : 'Demo mode OFF — bot replies to everyone.'}
          </div>

          <!-- Add -->
          <form onsubmit={addPhone} class="flex gap-2">
            <input
              type="tel"
              bind:value={newPhone}
              placeholder="+91 98765 43210"
              class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              type="submit"
              disabled={working || !newPhone.trim()}
              class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {#if working}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Plus class="h-4 w-4" />{/if}
              Add
            </button>
          </form>
          {#if notice}
            <p class="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400"><Check class="h-3.5 w-3.5" />{notice}</p>
          {/if}
          {#if listError}
            <p class="mt-2.5 flex items-center gap-1.5 text-xs text-rose-400"><X class="h-3.5 w-3.5" />{listError}</p>
          {/if}

          <!-- Dynamic -->
          <div class="mt-5">
            <p class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              Dynamic · {dynamic.length}
            </p>
            <div class="overflow-hidden rounded-xl border border-white/10 bg-slate-950/30">
              {#if dynamic.length === 0}
                <p class="px-4 py-6 text-center text-xs text-slate-500">No dynamic numbers yet.</p>
              {:else}
                <ul class="max-h-56 overflow-y-auto">
                  {#each dynamic as phone (phone)}
                    <li class="flex items-center justify-between gap-3 border-b border-white/5 px-3.5 py-2.5 last:border-0">
                      <span class="font-mono text-sm text-slate-200">{fmtPhone(phone)}</span>
                      <button
                        onclick={() => removePhone(phone)}
                        disabled={working}
                        class="inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/15 disabled:opacity-50"
                        aria-label={`Remove ${fmtPhone(phone)}`}
                      >
                        <Trash2 class="h-3 w-3" /> Remove
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>

          <!-- Seed -->
          <div class="mt-4">
            <p class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              Seed · {seed.length} · read-only
            </p>
            <div class="overflow-hidden rounded-xl border border-white/10 bg-slate-950/30">
              {#if seed.length === 0}
                <p class="px-4 py-6 text-center text-xs text-slate-500">No seed numbers configured.</p>
              {:else}
                <ul class="max-h-40 overflow-y-auto">
                  {#each seed as phone (phone)}
                    <li class="flex items-center justify-between gap-3 border-b border-white/5 px-3.5 py-2.5 last:border-0">
                      <span class="font-mono text-sm text-slate-400">{fmtPhone(phone)}</span>
                      <span class="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-500">seed</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        </section>
      </div>

      <p class="mt-8 text-center text-[11px] text-slate-600">
        Versifine operator console · session expires after 12h
      </p>
    </div>
  {/if}
</div>

<style>
  /* Deep slate gradient ground with a soft indigo aurora — distinct from the
     light marketing/app surfaces, unmistakably an internal console. */
  .admin-root {
    background:
      radial-gradient(1200px 600px at 15% -10%, rgba(99, 102, 241, 0.18), transparent 55%),
      radial-gradient(900px 500px at 110% 10%, rgba(139, 92, 246, 0.16), transparent 50%),
      linear-gradient(180deg, #0b1020 0%, #0a0e1a 100%);
    background-attachment: fixed;
  }
</style>
