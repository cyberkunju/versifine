<script lang="ts">
  /**
   * Versifine operator console — /admin.
   *
   * Editorial-fintech to match the product: white/ivory ground, indigo ink
   * (#121a8c), a restrained periwinkle accent, the Outfit typeface, the V
   * watermark, and the login page's gradient sign-in button + rise-in motion.
   *
   * Single page, credential-gated (httpOnly cookie session minted by
   * /admin/api/login). Houses every operator task:
   *   - WhatsApp pairing: live QR with auto-refresh + connection status, and
   *     an Unlink action that logs the device out and re-shows a QR.
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
    Smartphone,
    Trash2,
    TriangleAlert,
    Unlink,
    X,
  } from 'lucide-svelte';
  import VMark from '$lib/components/brand/VMark.svelte';
  import Wordmark from '$lib/components/brand/Wordmark.svelte';

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
    // Poll every 4s: QR rotates ~every 20s; keeps status fresh and flips to
    // "connected" promptly once scanned, and shows a new QR fast after unlink.
    qrTimer = setInterval(() => {
      if (authed) void loadQr();
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
      qr = { ready: false, hasQr: false, dataUri: null, svg: null };
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
  <link
    href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="admin-root relative min-h-screen overflow-x-hidden bg-[hsl(var(--brand-paper))] bg-grain text-[hsl(var(--foreground))]">
  <!-- Faint dot grid + a single periwinkle aurora, matching the login surface -->
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-0 opacity-60"
    style="
      background-image: radial-gradient(hsl(var(--foreground) / 0.05) 1px, transparent 1px);
      background-size: 24px 24px;
      -webkit-mask-image: radial-gradient(ellipse at 50% 0%, black 0%, transparent 72%);
      mask-image: radial-gradient(ellipse at 50% 0%, black 0%, transparent 72%);
    "
  ></div>
  <VMark
    class="pointer-events-none absolute -right-44 -top-40 w-[520px] select-none"
    style="opacity:0.04"
  />

  {#if booting}
    <div class="relative grid min-h-screen place-items-center">
      <Loader2 class="h-6 w-6 animate-spin text-[hsl(var(--muted-foreground))]" />
    </div>
  {:else if !authed}
    <!-- ===================== LOGIN ===================== -->
    <div class="relative grid min-h-screen place-items-center px-4">
      <div class="w-full max-w-[380px]">
        <div class="rise-1 mb-8 text-center">
          <a href="/" class="inline-flex" aria-label="Versifine home">
            <Wordmark class="mx-auto h-7 w-auto text-[hsl(var(--brand-navy))]" />
          </a>
          <h1 class="mt-7 font-display text-[26px] font-semibold tracking-[-0.02em] text-[hsl(var(--brand-navy))]">
            Operator Console
          </h1>
          <p class="mt-1.5 text-sm text-[hsl(var(--muted-foreground))]">
            Sign in to manage the WhatsApp bot.
          </p>
        </div>

        <form onsubmit={login} class="rise-2 rounded-2xl border border-[hsl(var(--border))] bg-white/80 p-6 shadow-[0_24px_60px_-30px_rgba(18,26,140,0.35)] backdrop-blur-sm sm:p-7">
          <label class="block">
            <span class="mb-1.5 block text-[13px] font-medium text-[hsl(var(--foreground))]">Username</span>
            <input
              bind:value={username}
              autocomplete="username"
              placeholder="Username"
              class="vf-field"
            />
          </label>
          <label class="mt-4 block">
            <span class="mb-1.5 block text-[13px] font-medium text-[hsl(var(--foreground))]">Password</span>
            <input
              type="password"
              bind:value={password}
              autocomplete="current-password"
              placeholder="Enter your password"
              class="vf-field"
            />
          </label>

          {#if loginError}
            <p class="mt-3 flex items-center gap-1.5 text-[13px] text-[hsl(var(--destructive))]" role="alert">
              <X class="h-4 w-4" />{loginError}
            </p>
          {/if}

          <button
            type="submit"
            disabled={loggingIn || !username.trim() || !password}
            class="vf-cta group mt-5 w-full disabled:opacity-60"
          >
            <span class="relative z-10 inline-flex items-center justify-center gap-2">
              {#if loggingIn}<Loader2 class="h-4 w-4 animate-spin" />{/if}
              {loggingIn ? 'Signing in…' : 'Sign in'}
              {#if !loggingIn}<span aria-hidden="true" class="text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5">→</span>{/if}
            </span>
            <span aria-hidden="true" class="vf-cta-shimmer"></span>
          </button>

          <div class="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Authorised personnel only</span>
          </div>
        </form>
      </div>
    </div>
  {:else}
    <!-- ===================== DASHBOARD ===================== -->
    <div class="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <!-- Top bar -->
      <header class="rise-1 mb-8 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--brand-ivory))] ring-1 ring-[hsl(var(--border))]">
            <VMark class="h-5 w-5" tight />
          </span>
          <div>
            <h1 class="font-display text-lg font-semibold tracking-[-0.01em] text-[hsl(var(--brand-navy))]">
              Operator Console
            </h1>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">WhatsApp bot administration</p>
          </div>
        </div>
        <button onclick={logout} class="vf-ghost">
          <LogOut class="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <!-- ===== WhatsApp pairing card ===== -->
        <section class="rise-2 vf-card">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-navy))]">
              <Smartphone class="h-4 w-4 text-[hsl(var(--brand-navy))]" /> WhatsApp pairing
            </h2>
            <button onclick={() => loadQr()} disabled={qrLoading} class="vf-ghost">
              <RefreshCw class={['h-3.5 w-3.5', qrLoading ? 'animate-spin' : ''].join(' ')} /> Refresh
            </button>
          </div>

          <!-- Status -->
          <div class="mb-4 flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory))] px-3.5 py-2.5">
            <span class="relative flex h-2.5 w-2.5">
              <span class={['absolute inline-flex h-full w-full rounded-full opacity-70', qr.ready ? 'animate-ping bg-emerald-500' : 'bg-[hsl(var(--brand-gold))]'].join(' ')}></span>
              <span class={['relative inline-flex h-2.5 w-2.5 rounded-full', qr.ready ? 'bg-emerald-600' : 'bg-[hsl(var(--brand-navy))]'].join(' ')}></span>
            </span>
            <span class="text-sm font-medium text-[hsl(var(--foreground))]">
              {qr.ready ? 'Connected & ready' : qr.hasQr ? 'Waiting for scan' : 'Starting up…'}
            </span>
          </div>

          <!-- QR / connected panel -->
          <div class="grid place-items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.5)] p-5">
            {#if qr.ready}
              <div class="py-10 text-center">
                <span class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-500/12 ring-1 ring-emerald-500/20">
                  <Check class="h-7 w-7 text-emerald-600" />
                </span>
                <p class="font-display text-base font-medium text-[hsl(var(--brand-navy))]">Bot is paired.</p>
                <p class="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Receiving messages from allowlisted numbers.</p>
              </div>
            {:else if qr.dataUri}
              <img
                src={qr.dataUri}
                alt="WhatsApp pairing QR"
                width="232"
                height="232"
                class="h-58 w-58 rounded-lg bg-white p-2 ring-1 ring-[hsl(var(--border))]"
              />
              <p class="mt-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
                WhatsApp → Settings → Linked Devices → Link a Device
              </p>
            {:else}
              <div class="grid h-58 w-58 place-items-center rounded-lg border border-dashed border-[hsl(var(--border))]">
                {#if qrLoading}
                  <Loader2 class="h-6 w-6 animate-spin text-[hsl(var(--muted-foreground))]" />
                {:else}
                  <div class="text-center text-[hsl(var(--muted-foreground))]">
                    <QrCode class="mx-auto h-8 w-8 opacity-60" />
                    <p class="mt-2 text-xs">Preparing a QR…</p>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          {#if qrError}
            <p class="mt-3 flex items-center gap-1.5 text-xs text-[hsl(var(--destructive))]"><X class="h-3.5 w-3.5" />{qrError}</p>
          {/if}

          <!-- Unlink -->
          <div class="mt-5 border-t border-[hsl(var(--border))] pt-4">
            {#if !confirmUnlink}
              <button
                onclick={() => (confirmUnlink = true)}
                disabled={!qr.ready}
                class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-4 py-2.5 text-sm font-medium text-[hsl(var(--destructive))] transition-colors hover:bg-[hsl(var(--destructive)/0.1)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Unlink class="h-4 w-4" /> Unlink this device
              </button>
              <p class="mt-2 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                Logs the bot out and shows a fresh QR to pair again.
              </p>
            {:else}
              <div class="rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] p-3.5">
                <p class="flex items-start gap-2 text-xs text-[hsl(var(--destructive))]">
                  <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
                  Unlink now? The bot stops replying until you scan a new QR.
                </p>
                <div class="mt-3 flex gap-2">
                  <button
                    onclick={doUnlink}
                    disabled={unlinking}
                    class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--destructive))] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {#if unlinking}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Unlink class="h-3.5 w-3.5" />{/if}
                    Yes, unlink
                  </button>
                  <button
                    onclick={() => (confirmUnlink = false)}
                    disabled={unlinking}
                    class="flex-1 rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </section>

        <!-- ===== Allowlist card ===== -->
        <section class="rise-3 vf-card">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand-navy))]">
              <span class="rule-gold"></span> Demo allowlist
            </h2>
            <button onclick={() => loadAllowlist()} disabled={listLoading} class="vf-ghost">
              <RefreshCw class={['h-3.5 w-3.5', listLoading ? 'animate-spin' : ''].join(' ')} /> Refresh
            </button>
          </div>

          <div class="mb-4 flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory))] px-3.5 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">
            <span class={['inline-block h-2 w-2 rounded-full', demoMode ? 'bg-emerald-600' : 'bg-amber-500'].join(' ')}></span>
            {demoMode ? 'Demo mode on — only listed numbers get replies.' : 'Demo mode OFF — bot replies to everyone.'}
          </div>

          <!-- Add -->
          <form onsubmit={addPhone} class="flex gap-2">
            <input
              type="tel"
              bind:value={newPhone}
              placeholder="+91 98765 43210"
              class="vf-field min-w-0 flex-1"
            />
            <button type="submit" disabled={working || !newPhone.trim()} class="vf-solid shrink-0 disabled:opacity-50">
              {#if working}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Plus class="h-4 w-4" />{/if}
              Add
            </button>
          </form>
          {#if notice}
            <p class="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-700"><Check class="h-3.5 w-3.5" />{notice}</p>
          {/if}
          {#if listError}
            <p class="mt-2.5 flex items-center gap-1.5 text-xs text-[hsl(var(--destructive))]"><X class="h-3.5 w-3.5" />{listError}</p>
          {/if}

          <!-- Dynamic -->
          <div class="mt-5">
            <p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              Dynamic · {dynamic.length}
            </p>
            <div class="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-white">
              {#if dynamic.length === 0}
                <p class="px-4 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">No dynamic numbers yet.</p>
              {:else}
                <ul class="max-h-56 overflow-y-auto">
                  {#each dynamic as phone (phone)}
                    <li class="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-3.5 py-2.5 last:border-0">
                      <span class="font-mono text-sm tabular-nums text-[hsl(var(--foreground))]">{fmtPhone(phone)}</span>
                      <button
                        onclick={() => removePhone(phone)}
                        disabled={working}
                        class="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--destructive)/0.25)] px-2 py-1 text-[11px] font-medium text-[hsl(var(--destructive))] transition-colors hover:bg-[hsl(var(--destructive)/0.08)] disabled:opacity-50"
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
            <p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              Seed · {seed.length} · read-only
            </p>
            <div class="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.6)]">
              {#if seed.length === 0}
                <p class="px-4 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">No seed numbers configured.</p>
              {:else}
                <ul class="max-h-40 overflow-y-auto">
                  {#each seed as phone (phone)}
                    <li class="flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-3.5 py-2.5 last:border-0">
                      <span class="font-mono text-sm tabular-nums text-[hsl(var(--muted-foreground))]">{fmtPhone(phone)}</span>
                      <span class="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">seed</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        </section>
      </div>

      <p class="rise-3 mt-8 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
        Versifine operator console · session expires after 12h
      </p>
    </div>
  {/if}
</div>

<style>
  .admin-root {
    font-family: 'Outfit', ui-sans-serif, system-ui, sans-serif;
  }

  /* Card surface — white, hairline border, soft indigo-tinted shadow. */
  :global(.admin-root) .vf-card {
    border-radius: 1rem;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--brand-paper));
    padding: 1.25rem;
    box-shadow: 0 24px 60px -38px rgba(18, 26, 140, 0.3);
  }
  @media (min-width: 640px) {
    :global(.admin-root) .vf-card {
      padding: 1.5rem;
    }
  }

  /* Inputs — exactly the login field treatment. */
  :global(.admin-root) .vf-field {
    width: 100%;
    background: hsl(var(--brand-paper));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 0.625rem 0.75rem;
    font-size: 14px;
    color: hsl(var(--foreground));
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  :global(.admin-root) .vf-field::placeholder {
    color: hsl(var(--muted-foreground) / 0.7);
  }
  :global(.admin-root) .vf-field:focus {
    outline: none;
    border-color: hsl(var(--brand-navy));
    box-shadow: 0 0 0 3px hsl(var(--brand-navy) / 0.16);
  }

  /* Primary CTA — the login's gradient + shimmer. */
  :global(.admin-root) .vf-cta {
    position: relative;
    overflow: hidden;
    border-radius: 0.5rem;
    padding: 0.7rem 1rem;
    font-size: 14px;
    font-weight: 500;
    color: hsl(var(--brand-paper));
    background: linear-gradient(
      120deg,
      hsl(var(--brand-navy-deep)),
      hsl(var(--brand-navy)) 50%,
      hsl(var(--brand-navy-deep))
    );
    background-size: 200% 100%;
    box-shadow: 0 8px 24px -10px hsl(var(--brand-navy) / 0.55);
    transition: transform 0.1s ease;
  }
  :global(.admin-root) .vf-cta:active {
    transform: scale(0.99);
  }
  :global(.admin-root) .vf-cta-shimmer {
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    transition: transform 1100ms ease-out;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.18), transparent);
  }
  :global(.admin-root) .vf-cta:hover .vf-cta-shimmer {
    transform: translateX(100%);
  }

  /* Solid secondary button (Add). */
  :global(.admin-root) .vf-solid {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border-radius: 0.5rem;
    padding: 0.625rem 1rem;
    font-size: 14px;
    font-weight: 500;
    color: hsl(var(--brand-paper));
    background: hsl(var(--brand-navy));
    transition: background-color 0.15s ease;
  }
  :global(.admin-root) .vf-solid:hover {
    background: hsl(var(--brand-navy-deep));
  }

  /* Ghost button (Refresh / Sign out). */
  :global(.admin-root) .vf-ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border-radius: 0.5rem;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--brand-paper));
    padding: 0.4rem 0.65rem;
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    transition: background-color 0.15s ease, color 0.15s ease;
  }
  :global(.admin-root) .vf-ghost:hover {
    background: hsl(var(--accent));
    color: hsl(var(--brand-navy));
  }
  :global(.admin-root) .vf-ghost:disabled {
    opacity: 0.5;
  }

  /* Square QR sizing helper (Tailwind has no h-58/w-58 by default). */
  :global(.admin-root) .h-58 {
    height: 14.5rem;
  }
  :global(.admin-root) .w-58 {
    width: 14.5rem;
  }

  /* Staggered rise-in, matching the login motion. */
  @keyframes vf-rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .rise-1 {
    opacity: 0;
    animation: vf-rise 0.6s ease-out 0.05s forwards;
  }
  .rise-2 {
    opacity: 0;
    animation: vf-rise 0.6s ease-out 0.16s forwards;
  }
  .rise-3 {
    opacity: 0;
    animation: vf-rise 0.6s ease-out 0.28s forwards;
  }
  @media (prefers-reduced-motion: reduce) {
    .rise-1,
    .rise-2,
    .rise-3 {
      animation: none;
      opacity: 1;
    }
  }
</style>
