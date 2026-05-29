<script lang="ts">
  /**
   * Login — editorial split. Left: a navy "marketing" rail with the
   * wordmark and a quiet pull-quote. Right: the form on paper. On
   * success the auth store updates and we route to the dashboard.
   */
  import { goto } from '$app/navigation';
  import { ArrowRight } from 'lucide-svelte';
  import Logo from '$lib/components/brand/Logo.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { ApiError } from '$lib/api/types';

  let email = $state('demo@versifine.com');
  let password = $state('Versifine#2026!');
  let error = $state<string | null>(null);
  const m = $derived(getMessages(settings.language));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    try {
      await auth.login({ email, password });
      void goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : m.auth.invalidCredentials;
    }
  }
</script>

<svelte:head><title>Log in · Versifine</title></svelte:head>

<div class="grid min-h-screen bg-[hsl(var(--brand-paper))] lg:grid-cols-2">
  <!-- Brand rail -->
  <aside class="relative hidden flex-col justify-between overflow-hidden bg-[hsl(var(--brand-navy))] p-12 text-[hsl(var(--brand-paper))] lg:flex">
    <div class="pointer-events-none absolute inset-0 opacity-[0.5]">
      <svg width="700" height="700" viewBox="0 0 700 700" fill="none" class="absolute -bottom-40 -left-40" aria-hidden="true">
        {#each [0, 1, 2, 3] as i (i)}
          <circle cx="350" cy="350" r={140 + i * 80} stroke="hsl(var(--brand-paper))" stroke-opacity="0.06" />
        {/each}
      </svg>
    </div>
    <a href="/" class="relative z-10 w-fit"><Logo size={32} tone="paper" /></a>
    <div class="relative z-10 max-w-md">
      <p class="font-display text-3xl font-medium leading-snug tracking-tight">
        “Every rupee, captured in a sentence — and an AI that actually understands where it went.”
      </p>
      <p class="mt-6 text-sm text-[hsl(var(--brand-paper)/0.6)]">Versifine — your finances, finely tuned.</p>
    </div>
    <div class="relative z-10 text-xs text-[hsl(var(--brand-paper)/0.5)]">Built India-first · Multilingual · Privacy-aware</div>
  </aside>

  <!-- Form -->
  <main class="flex items-center justify-center px-5 py-12 sm:px-10">
    <div class="w-full max-w-sm">
      <div class="mb-8 lg:hidden"><a href="/"><Logo size={30} /></a></div>

      <h1 class="font-display text-3xl font-medium tracking-tight text-[hsl(var(--brand-navy))]">{m.auth.welcomeBack}</h1>
      <p class="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{m.app.tagline}</p>

      <form onsubmit={submit} novalidate class="mt-8 space-y-5">
        <div class="space-y-1.5">
          <label for="email" class="text-sm font-medium text-[hsl(var(--foreground))]">{m.auth.email}</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            required
            bind:value={email}
            class="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-4 text-sm text-[hsl(var(--foreground))] outline-none transition-colors focus:border-[hsl(var(--brand-navy))] focus:ring-2 focus:ring-[hsl(var(--brand-navy)/0.12)]"
          />
        </div>
        <div class="space-y-1.5">
          <label for="password" class="text-sm font-medium text-[hsl(var(--foreground))]">{m.auth.password}</label>
          <input
            id="password"
            type="password"
            autocomplete="current-password"
            required
            bind:value={password}
            class="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-4 text-sm text-[hsl(var(--foreground))] outline-none transition-colors focus:border-[hsl(var(--brand-navy))] focus:ring-2 focus:ring-[hsl(var(--brand-navy)/0.12)]"
          />
        </div>

        {#if error}
          <p class="rounded-xl border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-4 py-3 text-sm text-[hsl(var(--destructive))]" role="alert">{error}</p>
        {/if}

        <button
          type="submit"
          disabled={auth.loading}
          class="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--brand-navy))] text-sm font-medium text-[hsl(var(--brand-paper))] transition-all hover:bg-[hsl(var(--brand-navy-deep))] disabled:opacity-60"
        >
          {auth.loading ? m.common.loading : m.auth.signIn}
          {#if !auth.loading}<ArrowRight class="h-4 w-4 text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5" />{/if}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
        {m.auth.needAccount}
        <a class="font-medium text-[hsl(var(--brand-navy))] underline decoration-[hsl(var(--brand-gold))] underline-offset-4 hover:opacity-80" href="/register">{m.auth.signUp}</a>
      </p>

      <div class="mt-8 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.6)] px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
        <span class="font-medium text-[hsl(var(--brand-navy))]">Demo</span> · pre-filled above. 90 days of sample data, ready to explore.
      </div>
    </div>
  </main>
</div>
