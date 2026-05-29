<script lang="ts">
  /**
   * Login — editorial split, pixel-matched to the approved design.
   *
   * Left: a deep brand-navy (#001F77) rail carrying the Versifine wordmark,
   * a customer pull-quote, and a quiet legal footer. Right: the sign-in card
   * on paper-white with SSO options, an email/password form, and fine print.
   *
   * On success the auth store updates and we route to the dashboard. The SSO
   * buttons and "forgot password" are presentational entry points today and
   * surface a toast until their backends land.
   */
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { ApiError } from '$lib/api/types';

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    try {
      await auth.login({ email, password });
      void goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'That email and password did not match.';
    }
  }

  function comingSoon(what: string) {
    toast.info(`${what} is coming soon.`);
  }
</script>

<svelte:head><title>Sign in · Versifine</title></svelte:head>

<div class="grid min-h-screen w-full bg-white lg:grid-cols-2">
  <!-- ───────────────────────── Brand rail ───────────────────────── -->
  <aside
    class="relative hidden flex-col justify-between overflow-hidden px-14 py-12 text-white lg:flex"
    style="background:
      radial-gradient(135% 135% at 0% 0%, rgba(255,255,255,0.12), transparent 52%),
      linear-gradient(152deg, #0A2A8E 0%, #001F77 46%, #001451 100%);"
  >
    <!-- faint geometric facet, lower-right -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg class="absolute -bottom-10 right-0 h-[78%] w-auto opacity-[0.07]" viewBox="0 0 520 520" fill="none">
        <path d="M520 60 L520 520 L120 520 Z" fill="white" />
        <path d="M520 220 L520 520 L300 520 Z" fill="white" fill-opacity="0.6" />
      </svg>
    </div>

    <!-- top: wordmark -->
    <a href="/" class="relative z-10 w-fit">
      <img src="/brand/versifine-wordmark-white.svg" alt="Versifine" class="h-[22px] w-auto" />
    </a>

    <!-- middle: testimonial -->
    <figure class="relative z-10 max-w-md">
      <blockquote class="text-[1.75rem] font-normal leading-[1.45] tracking-[-0.01em] text-white/95">
        Versifine has become the quiet backbone of how our team thinks about numbers. It stays out of the
        way, and that is the highest praise we can give a tool.
      </blockquote>
      <figcaption class="mt-6 text-sm">
        <span class="font-semibold text-white">Elena Marchetti</span>
        <span class="text-white/55">&nbsp;·&nbsp; Head of Design, Cinder</span>
      </figcaption>
    </figure>

    <!-- bottom: legal -->
    <div class="relative z-10 flex items-center justify-between text-xs text-white/50">
      <span>© 2026 Versifine, Inc.</span>
      <nav class="flex items-center gap-6">
        <a href="/" class="transition-colors hover:text-white/80">Privacy</a>
        <a href="/" class="transition-colors hover:text-white/80">Terms</a>
      </nav>
    </div>
  </aside>

  <!-- ───────────────────────── Sign-in card ───────────────────────── -->
  <main class="relative flex items-center justify-center px-6 py-12 sm:px-10">
    <!-- top-right: create account -->
    <p class="absolute right-6 top-6 text-sm text-[#6B7280] sm:right-10 sm:top-8">
      New to Versifine?
      <a href="/register" class="font-semibold text-[#001F77] transition-opacity hover:opacity-80">Create an account</a>
    </p>

    <div class="w-full max-w-sm">
      <!-- mobile wordmark -->
      <a href="/" class="mb-10 block w-fit lg:hidden">
        <img src="/brand/versifine-wordmark-navy.svg" alt="Versifine" class="h-6 w-auto" />
      </a>

      <h1 class="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-[#0B1220]">
        Sign in to your account
      </h1>
      <p class="mt-2 text-[0.95rem] text-[#6B7280]">Welcome back. Please enter your details.</p>

      <!-- SSO -->
      <div class="mt-7 space-y-3">
        <button
          type="button"
          onclick={() => comingSoon('Continue with Google')}
          class="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-[#E5E7EB] bg-white text-[0.95rem] font-medium text-[#1F2937] transition-colors hover:bg-[#F9FAFB]"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>

        <button
          type="button"
          onclick={() => comingSoon('Continue with Apple')}
          class="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-[#E5E7EB] bg-white text-[0.95rem] font-medium text-[#1F2937] transition-colors hover:bg-[#F9FAFB]"
        >
          <svg class="h-[18px] w-[18px]" viewBox="0 0 384 512" fill="#000" aria-hidden="true">
            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C71.5 141.5 0 184.7 0 272.4c0 25.8 4.7 52.4 14.1 79.9 12.6 36.3 58 125.3 105.4 123.9 24.8-.6 42.3-17.6 74.5-17.6 31.2 0 47.4 17.6 76.4 17.6 47.8-.7 88.9-81.6 100.9-118 -64-30.2-60.9-88.5-60.9-91.5zM256.5 86.3c30-35.6 27.3-68 26.4-79.7 -26.5 1.5-57.2 18-74.7 38.3 -19.3 21.8-30.6 48.8-28.2 79.1 28.6 2.2 54.8-12.5 76.5-37.7z"/>
          </svg>
          Continue with Apple
        </button>
      </div>

      <!-- divider -->
      <div class="my-6 flex items-center gap-4">
        <span class="h-px flex-1 bg-[#E5E7EB]"></span>
        <span class="text-xs text-[#9CA3AF]">or</span>
        <span class="h-px flex-1 bg-[#E5E7EB]"></span>
      </div>

      <!-- email / password -->
      <form onsubmit={submit} novalidate class="space-y-5">
        <div class="space-y-1.5">
          <label for="email" class="block text-sm font-semibold text-[#374151]">Email</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            required
            placeholder="name@company.com"
            bind:value={email}
            class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[0.95rem] text-[#111827] placeholder:text-[#9CA3AF] outline-none transition-shadow focus:border-[#001F77] focus:ring-2 focus:ring-[#001F77]/15"
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label for="password" class="block text-sm font-semibold text-[#374151]">Password</label>
            <button
              type="button"
              onclick={() => comingSoon('Password reset')}
              class="text-sm text-[#6B7280] transition-colors hover:text-[#001F77]"
            >Forgot password?</button>
          </div>
          <input
            id="password"
            type="password"
            autocomplete="current-password"
            required
            placeholder="Enter your password"
            bind:value={password}
            class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[0.95rem] text-[#111827] placeholder:text-[#9CA3AF] outline-none transition-shadow focus:border-[#001F77] focus:ring-2 focus:ring-[#001F77]/15"
          />
        </div>

        {#if error}
          <p class="rounded-lg border border-[#DC2626]/30 bg-[#DC2626]/[0.06] px-3.5 py-2.5 text-sm text-[#B91C1C]" role="alert">{error}</p>
        {/if}

        <button
          type="submit"
          disabled={auth.loading}
          class="h-12 w-full rounded-lg bg-[#001F77] text-[0.95rem] font-semibold text-white transition-colors hover:bg-[#001451] disabled:opacity-60"
        >
          {auth.loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p class="mt-6 text-center text-[0.8rem] leading-relaxed text-[#9CA3AF]">
        By continuing, you agree to our
        <a href="/" class="font-medium text-[#4B5563] underline-offset-2 hover:underline">Terms</a>
        and
        <a href="/" class="font-medium text-[#4B5563] underline-offset-2 hover:underline">Privacy Policy</a>.
      </p>
    </div>
  </main>
</div>
