<script lang="ts">
  /**
   * Register — editorial split, mirrors the login page. Email, password,
   * optional display name, primary language. Server enforces the password
   * policy; we surface its error verbatim.
   */
  import { goto } from '$app/navigation';
  import { ArrowRight } from 'lucide-svelte';
  import { LANGUAGE_META, LANGUAGES, type Language } from '@versifine/shared';
  import Logo from '$lib/components/brand/Logo.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { ApiError } from '$lib/api/types';

  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let primaryLanguage = $state<Language>('en');
  let error = $state<string | null>(null);
  const m = $derived(getMessages(settings.language));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    try {
      await auth.register({
        email,
        password,
        ...(displayName ? { displayName } : {}),
        primaryLanguage,
      });
      void goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Registration failed';
    }
  }
</script>

<svelte:head><title>Create account · Versifine</title></svelte:head>

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
        “The whole point of a finance app is to disappear into a sentence. Ours does.”
      </p>
      <p class="mt-6 text-sm text-[hsl(var(--brand-paper)/0.6)]">Versifine — your finances, finely tuned.</p>
    </div>
    <div class="relative z-10 text-xs text-[hsl(var(--brand-paper)/0.5)]">Free · No card · 90 days of demo data</div>
  </aside>

  <!-- Form -->
  <main class="flex items-center justify-center px-5 py-12 sm:px-10">
    <div class="w-full max-w-sm">
      <div class="mb-8 lg:hidden"><a href="/"><Logo size={30} /></a></div>

      <h1 class="font-display text-3xl font-medium tracking-tight text-[hsl(var(--brand-navy))]">{m.auth.welcomeNew}</h1>
      <p class="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{m.app.tagline}</p>

      <form onsubmit={submit} novalidate class="mt-8 space-y-5">
        <div class="space-y-1.5">
          <label for="display" class="text-sm font-medium text-[hsl(var(--foreground))]">{m.auth.displayName}</label>
          <input
            id="display"
            autocomplete="nickname"
            bind:value={displayName}
            class="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-4 text-sm text-[hsl(var(--foreground))] outline-none transition-colors focus:border-[hsl(var(--brand-navy))] focus:ring-2 focus:ring-[hsl(var(--brand-navy)/0.12)]"
          />
        </div>
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
            autocomplete="new-password"
            required
            bind:value={password}
            class="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-4 text-sm text-[hsl(var(--foreground))] outline-none transition-colors focus:border-[hsl(var(--brand-navy))] focus:ring-2 focus:ring-[hsl(var(--brand-navy)/0.12)]"
          />
          <p class="text-xs text-[hsl(var(--muted-foreground))]">12+ chars, mixed case, a number, and a symbol.</p>
        </div>
        <div class="space-y-1.5">
          <label for="lang" class="text-sm font-medium text-[hsl(var(--foreground))]">{m.auth.primaryLanguage}</label>
          <select
            id="lang"
            bind:value={primaryLanguage}
            class="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-white px-4 text-sm text-[hsl(var(--foreground))] outline-none transition-colors focus:border-[hsl(var(--brand-navy))] focus:ring-2 focus:ring-[hsl(var(--brand-navy)/0.12)]"
          >
            {#each LANGUAGES as code (code)}
              <option value={code}>{LANGUAGE_META[code].nativeName} — {LANGUAGE_META[code].englishName}</option>
            {/each}
          </select>
        </div>

        {#if error}
          <p class="rounded-xl border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-4 py-3 text-sm text-[hsl(var(--destructive))]" role="alert">{error}</p>
        {/if}

        <button
          type="submit"
          disabled={auth.loading}
          class="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--brand-navy))] text-sm font-medium text-[hsl(var(--brand-paper))] transition-all hover:bg-[hsl(var(--brand-navy-deep))] disabled:opacity-60"
        >
          {auth.loading ? m.common.loading : m.auth.signUp}
          {#if !auth.loading}<ArrowRight class="h-4 w-4 text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5" />{/if}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
        {m.auth.haveAccount}
        <a class="font-medium text-[hsl(var(--brand-navy))] underline decoration-[hsl(var(--brand-gold))] underline-offset-4 hover:opacity-80" href="/login">{m.auth.signIn}</a>
      </p>
    </div>
  </main>
</div>
