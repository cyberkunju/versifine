<script lang="ts">
  /**
   * Login — "Login Redefined", ported 1:1 from the approved React/Lovable
   * design into our SvelteKit + Svelte 5 stack. Same editorial split, same
   * motion: aurora glow blobs, a slowly drifting background "V", staggered
   * rise-in reveals, a rotating headline word, the live status dot, and the
   * gradient Sign-in button with a sweeping shimmer.
   *
   * The email/password form is wired to our auth store; SSO + "forgot
   * password" are presentational entry points that surface a toast until
   * their backends land.
   */
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { ApiError } from '$lib/api/types';

  const ROTATING_WORDS = ['workspace', 'dashboard', 'account', 'studio'];

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let wordIdx = $state(0);

  // Rotate the headline word every 2.6s, retriggering the rise animation.
  $effect(() => {
    const id = setInterval(() => {
      wordIdx = (wordIdx + 1) % ROTATING_WORDS.length;
    }, 2600);
    return () => clearInterval(id);
  });

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

<svelte:head>
  <title>Log in · Versifine</title>
  <meta name="description" content="Sign in to your Versifine account." />
  <link
    href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div
  class="login grid min-h-screen w-full lg:grid-cols-2"
  style="
    --background: oklch(1 0 0);
    --foreground: oklch(0.18 0.005 260);
    --muted-foreground: oklch(0.55 0.008 260);
    --border: oklch(0.92 0.004 260);
    --secondary: oklch(0.975 0.002 260);
    --brand: oklch(0.32 0.18 268);
    --brand-deep: oklch(0.24 0.16 268);
    background: var(--background);
    color: var(--foreground);
    font-family: 'Outfit', ui-sans-serif, system-ui, sans-serif;
  "
>
  <!-- ───────── Left brand panel ───────── -->
  <aside
    class="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14"
    style="background: linear-gradient(160deg, oklch(0.32 0.18 268) 0%, oklch(0.22 0.16 268) 60%, oklch(0.16 0.12 268) 100%);"
  >
    <!-- Aurora glow blobs -->
    <div
      aria-hidden="true"
      class="animate-aurora pointer-events-none absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full"
      style="background: radial-gradient(closest-side, oklch(0.55 0.22 290 / 0.55), transparent 70%); filter: blur(40px);"
    ></div>
    <div
      aria-hidden="true"
      class="animate-aurora pointer-events-none absolute -right-24 top-1/3 h-[420px] w-[420px] rounded-full"
      style="background: radial-gradient(closest-side, oklch(0.6 0.2 230 / 0.45), transparent 70%); filter: blur(50px); animation-delay: -7s;"
    ></div>

    <!-- Background mark — large faded V (drifts slowly) -->
    <img
      src="/brand/versifine-icon.png"
      alt=""
      aria-hidden="true"
      class="animate-drift pointer-events-none absolute -bottom-32 -right-32 w-[640px] select-none opacity-[0.07]"
    />

    <!-- Brand -->
    <a href="/" class="rise-1 relative z-10 inline-flex items-center self-start" aria-label="Versifine home">
      <img src="/brand/versifine-logo.svg" alt="Versifine" class="h-[22px] w-auto" style="filter: brightness(0) invert(1);" />
    </a>

    <!-- Quote -->
    <blockquote class="rise-2 relative z-10 max-w-md">
      <p class="text-[22px] font-light leading-[1.5] tracking-[-0.01em] text-white/95">
        Versifine has become the quiet backbone of how our team thinks about numbers. It stays out of the
        way, and that is the highest praise we can give a tool.
      </p>
      <footer class="mt-6 flex items-center gap-2 text-[13px] text-white/55">
        <span aria-hidden="true" class="animate-livedot inline-block h-1.5 w-1.5 rounded-full bg-green-400"></span>
        <span class="font-medium text-white/85">Elena Marchetti</span>
        <span class="opacity-50">·</span>
        <span>Head of Design, Cinder</span>
      </footer>
    </blockquote>

    <!-- Footer -->
    <div class="rise-3 relative z-10 flex items-center justify-between text-[12px] text-white/45">
      <span>© {new Date().getFullYear()} Versifine, Inc.</span>
      <div class="flex gap-5">
        <a href="/" class="transition-colors hover:text-white/80">Privacy</a>
        <a href="/" class="transition-colors hover:text-white/80">Terms</a>
      </div>
    </div>
  </aside>

  <!-- ───────── Right form panel ───────── -->
  <main class="relative flex flex-col overflow-hidden">
    <!-- Faint dot grid background -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 opacity-60"
      style="
        background-image: radial-gradient(oklch(0.18 0.005 260 / 0.06) 1px, transparent 1px);
        background-size: 22px 22px;
        -webkit-mask-image: radial-gradient(ellipse at 70% 40%, black 0%, transparent 75%);
        mask-image: radial-gradient(ellipse at 70% 40%, black 0%, transparent 75%);
      "
    ></div>
    <!-- Huge V bleeding off the top-right edge — static watermark -->
    <img
      src="/brand/versifine-icon.png"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute -right-40 -top-32 w-[460px] select-none"
      style="opacity: 0.05; transform: rotate(8deg);"
    />

    <header class="rise-1 relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
      <a href="/" class="flex items-center gap-2 lg:hidden" aria-label="Versifine home">
        <img src="/brand/versifine-icon.png" alt="" class="h-7 w-7" />
        <span class="text-[16px] font-semibold tracking-[-0.02em]">Versifine</span>
      </a>

      <div class="ml-auto text-[13px] text-[var(--muted-foreground)]">
        New to Versifine?
        <a href="/register" class="font-medium underline-offset-4 hover:underline" style="color: var(--brand);">
          Create an account
        </a>
      </div>
    </header>

    <div class="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
      <div class="w-full max-w-[380px]">
        <div class="rise-2">
          <h1 class="flex flex-wrap items-baseline gap-x-1.5 text-[24px] font-semibold tracking-[-0.02em]">
            <span>Sign in to your</span>
            {#key wordIdx}
              <span class="word-rise inline-block" style="color: var(--brand);">{ROTATING_WORDS[wordIdx]}</span>
            {/key}
          </h1>
          <p class="mt-1.5 text-[14px] text-[var(--muted-foreground)]">Welcome back. Please enter your details.</p>
        </div>

        <div class="rise-3 mt-8 space-y-2.5">
          <button type="button" onclick={() => comingSoon('Continue with Google')} class="social-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>

        <div class="relative my-6">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-[var(--border)]"></div>
          </div>
          <div class="relative flex justify-center">
            <span class="bg-[var(--background)] px-3 text-[12px] text-[var(--muted-foreground)]">or</span>
          </div>
        </div>

        <form onsubmit={submit} novalidate class="rise-4 space-y-4">
          <label class="block">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[13px] font-medium">Email</span>
            </div>
            <input
              type="email"
              bind:value={email}
              placeholder="name@company.com"
              autocomplete="email"
              required
              class="field-input"
            />
          </label>

          <label class="block">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[13px] font-medium">Password</span>
              <button
                type="button"
                onclick={() => comingSoon('Password reset')}
                class="text-[12px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >Forgot password?</button>
            </div>
            <input
              type="password"
              bind:value={password}
              placeholder="Enter your password"
              autocomplete="current-password"
              required
              class="field-input"
            />
          </label>

          {#if error}
            <p class="text-[13px] text-[oklch(0.55_0.18_28)]" role="alert">{error}</p>
          {/if}

          <button
            type="submit"
            disabled={auth.loading}
            class="group relative mt-1 w-full overflow-hidden rounded-md py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.99] disabled:opacity-70"
            style="
              background: linear-gradient(120deg, var(--brand-deep), var(--brand) 50%, var(--brand-deep));
              background-size: 200% 100%;
              box-shadow: 0 8px 24px -10px color-mix(in oklab, var(--brand) 60%, transparent);
            "
          >
            <span class="relative z-10 inline-flex items-center justify-center gap-2">
              {auth.loading ? 'Signing in…' : 'Sign in'}
              {#if !auth.loading}
                <span aria-hidden="true" class="transition-transform group-hover:translate-x-0.5">→</span>
              {/if}
            </span>
            <span
              aria-hidden="true"
              class="absolute inset-0 -translate-x-full transition-transform duration-[1100ms] ease-out group-hover:translate-x-full"
              style="background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);"
            ></span>
          </button>

          <div class="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-[var(--muted-foreground)]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Protected by end-to-end encryption</span>
          </div>
        </form>

        <p class="mt-8 text-center text-[12px] text-[var(--muted-foreground)]">
          By continuing, you agree to our
          <a href="/" class="underline-offset-4 hover:underline" style="color: color-mix(in oklab, var(--foreground) 80%, transparent);">Terms</a>
          and
          <a href="/" class="underline-offset-4 hover:underline" style="color: color-mix(in oklab, var(--foreground) 80%, transparent);">Privacy Policy</a>.
        </p>
      </div>
    </div>
  </main>
</div>

<style>
  /* ───── Inputs (matches the design's themed Field exactly) ───── */
  .field-input {
    width: 100%;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    padding: 0.625rem 0.75rem;
    font-size: 14px;
    transition: all 0.15s ease;
  }
  .field-input::placeholder {
    color: color-mix(in oklab, var(--muted-foreground) 70%, transparent);
  }
  .field-input:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 18%, transparent);
  }

  /* ───── Social buttons ───── */
  .social-btn {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    border: 1px solid var(--border);
    background: var(--background);
    border-radius: 0.375rem;
    padding: 0.625rem 0;
    font-size: 14px;
    font-weight: 500;
    transition: background-color 0.15s ease;
  }
  .social-btn:hover {
    background: var(--secondary);
  }

  /* ───── Custom keyframes (ported from styles.css) ───── */
  @keyframes drift {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    50% { transform: translate(-18px, -22px) rotate(-3deg); }
  }
  @keyframes aurora {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
    50% { transform: translate(40px, -30px) scale(1.15); opacity: 0.8; }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes livedot {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 color-mix(in oklab, #4ade80 60%, transparent); }
    50% { opacity: 0.7; box-shadow: 0 0 0 6px transparent; }
  }

  .animate-drift { animation: drift 18s ease-in-out infinite; }
  .animate-aurora { animation: aurora 14s ease-in-out infinite; }
  .animate-livedot { animation: livedot 2.2s ease-in-out infinite; }
  .word-rise { animation: rise 0.5s ease-out; }

  .rise-1 { opacity: 0; animation: rise 0.7s ease-out 0.05s forwards; }
  .rise-2 { opacity: 0; animation: rise 0.7s ease-out 0.18s forwards; }
  .rise-3 { opacity: 0; animation: rise 0.7s ease-out 0.32s forwards; }
  .rise-4 { opacity: 0; animation: rise 0.7s ease-out 0.46s forwards; }

  @media (prefers-reduced-motion: reduce) {
    .animate-drift, .animate-aurora, .animate-livedot, .word-rise,
    .rise-1, .rise-2, .rise-3, .rise-4 {
      animation: none;
      opacity: 1;
    }
  }
</style>
