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
  import { cubicOut, cubicInOut } from 'svelte/easing';
  import { auth } from '$lib/stores/auth.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { ApiError } from '$lib/api/types';
  import GoogleSignInButton from '$lib/components/auth/GoogleSignInButton.svelte';
  import VMark from '$lib/components/brand/VMark.svelte';
  import Wordmark from '$lib/components/brand/Wordmark.svelte';

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

  /**
   * The brand-rail story. Every line here is true and specific — drawn from
   * the project docs: real features, real engineering calls, real fixes. No
   * marketing filler. Each slide stays on screen for its own reading time,
   * then hands off with a soft reveal.
   */
  type SlideKind = 'feature' | 'tip' | 'craft' | 'honest' | 'voice';
  interface Slide {
    id: number;
    kind: SlideKind;
    text: string;
    by?: string;
  }

  const KIND_LABEL: Record<SlideKind, string> = {
    feature: 'What it does',
    tip: 'Tip',
    craft: 'Under the hood',
    honest: 'Straight talk',
    voice: 'In their words',
  };

  const SLIDES: Slide[] = [
    { id: 1, kind: 'feature', text: 'Capture a spend the way you’d say it — type it, speak it, or snap the receipt. Web, WhatsApp, and CSV all flow through one pipeline.' },
    { id: 2, kind: 'tip', text: '“spent 450 on auto” is all the bar needs. Write it the way you’d say it out loud.' },
    { id: 3, kind: 'feature', text: 'Ask the co-pilot where your money went. It reads your own transactions, in plain language — never the open internet.' },
    { id: 4, kind: 'craft', text: 'The co-pilot can only quote a number that came back from a real query. That’s how we structurally stop it from inventing figures.' },
    { id: 5, kind: 'feature', text: 'Privacy Mode runs categorization inside your browser. Your transaction text never leaves the device.' },
    { id: 6, kind: 'feature', text: 'Built INR-first: UPI handles, rupee shorthand, and six languages — the way money actually moves in India.' },
    { id: 7, kind: 'craft', text: 'A fine-tuned model sorts roughly 6,600 expenses a second at about 96% accuracy — and it runs on a plain CPU.' },
    { id: 8, kind: 'feature', text: 'Correct a category once. The next time that merchant appears it’s labelled instantly — free, and for good.' },
    { id: 9, kind: 'craft', text: 'Categorization is a four-tier waterfall: your own corrections first, then a 300-merchant India catalogue, then the model, then a safe default.' },
    { id: 10, kind: 'feature', text: 'Recurring detection finds your subscriptions, rent, and EMIs on its own — and tells you when each one is due next.' },
    { id: 11, kind: 'feature', text: 'The 30-day forecast separates what’s locked in, like rent and Netflix, from what’s only estimated, like groceries and transport.' },
    { id: 12, kind: 'craft', text: 'We wrote the ARIMA forecaster by hand — about 120 lines — because honest math you can explain beats a black box you can’t.' },
    { id: 13, kind: 'feature', text: 'Anomaly detection flags the day your spend jumped, and shows how far past normal it ran.' },
    { id: 14, kind: 'tip', text: 'Press ⌘K to jump anywhere. ⌘L opens the capture bar from any screen.' },
    { id: 15, kind: 'feature', text: 'Voice notes work in English, Hindi, Malayalam, Tamil, Telugu, and Kannada — and come back spoken in the same language.' },
    { id: 16, kind: 'craft', text: 'Tamil and Malayalam share no Unicode block, so we check every translation’s script and retry rather than ship confident nonsense.' },
    { id: 17, kind: 'tip', text: 'Snap a receipt. If the photo isn’t clear, you get one quick confirmation instead of a wrong guess saved silently.' },
    { id: 18, kind: 'honest', text: 'Single-user today — but every record already carries a space, so shared household and business books arrive without a migration.' },
    { id: 19, kind: 'craft', text: 'Three apps, one database: a Hono API, this SvelteKit dashboard, and a WhatsApp bot. One source of truth behind all of it.' },
    { id: 20, kind: 'craft', text: 'Embeddings run in a background queue, so saving a transaction never waits on a network call.' },
    { id: 21, kind: 'honest', text: 'We log how long every AI call takes, and never log what you spent it on. Observability without surveillance.' },
    { id: 22, kind: 'craft', text: 'Every AI service has a fallback. No single upstream failure can lock you out of your own money.' },
    { id: 23, kind: 'tip', text: 'Link WhatsApp once and capture spends by message — text, voice, or a photo of the bill — without opening the app.' },
    { id: 24, kind: 'craft', text: '“Day before yesterday” used to match “yesterday.” We reordered the parser so the longer phrase wins. Small bug, real fix.' },
    { id: 25, kind: 'feature', text: 'Set a goal and the co-pilot tracks whether you’re on pace — and flags it early when you’re drifting off.' },
    { id: 26, kind: 'feature', text: 'Budgets warn before you breach them, not after. The alert lands while you can still do something about it.' },
    { id: 27, kind: 'craft', text: 'The merchant key strips UPI prefixes, handles, reference codes, and city tags down to just “swiggy.” Lossy on purpose, stable forever.' },
    { id: 28, kind: 'feature', text: 'Real-time by default: a spend captured on WhatsApp shows up on this dashboard a moment later, no refresh needed.' },
    { id: 29, kind: 'tip', text: 'Numbers render with tabular figures, so columns line up and your eye can scan a ledger fast.' },
    { id: 30, kind: 'honest', text: 'This is an MVP, and the docs say so out loud — every shipped feature, every open issue, every fix, kept in one place.' },
    { id: 31, kind: 'craft', text: 'Receipts vary wildly — faded thermal prints, angled photos — so vision runs on the larger model and asks when it isn’t sure.' },
    { id: 32, kind: 'feature', text: 'One pipeline, three doors in: the web omnibar, a WhatsApp message, or a CSV import. Parse, categorize, save, broadcast.' },
    { id: 33, kind: 'voice', text: 'Versifine has become the quiet backbone of how our team thinks about numbers. It stays out of the way, and that is the highest praise we can give a tool.', by: 'Elena Marchetti · Head of Design, Cinder' },
  ];

  // Randomized order, fresh per visit. A Fisher-Yates shuffle produces a
  // "deck" so two people landing on the login see different lines, and no
  // slide repeats until the whole set has been shown. When the deck runs
  // out we reshuffle (avoiding an immediate back-to-back repeat at the seam).
  function shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  let order = $state<Slide[]>(shuffle(SLIDES));
  let slideIdx = $state(0);
  const slide = $derived(order[slideIdx]!);

  // Fixed cadence: every slide stays exactly 4 seconds, regardless of
  // length. Predictable, calm rhythm.
  function readingMs(_text: string): number {
    return 4000;
  }

  // Advance every 4s. Walks the shuffled deck; at the end it reshuffles for
  // a fresh random pass (keeping the seam from repeating the same slide).
  // Pauses while the tab is hidden — nothing should scroll past unseen.
  $effect(() => {
    const current = order[slideIdx]!;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(advance, 1500);
        return;
      }
      if (slideIdx + 1 >= order.length) {
        const last = order[slideIdx];
        let next = shuffle(SLIDES);
        if (next[0]?.id === last?.id && next.length > 1) {
          [next[0], next[1]] = [next[1]!, next[0]!];
        }
        order = next;
        slideIdx = 0;
      } else {
        slideIdx = slideIdx + 1;
      }
    };
    timer = setTimeout(advance, readingMs(current.text));
    return () => clearTimeout(timer);
  });

  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Incoming: a quiet fade with a small settle from below. No blur, no
  // wipe — just a calm cross-fade that lets the words arrive cleanly.
  function revealIn(_node: Element, { duration = 620 } = {}) {
    if (prefersReduced) return { duration: 160, css: (t: number) => `opacity:${t}` };
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `opacity:${t}; transform:translateY(${(1 - t) * 8}px);`,
    };
  }

  // Outgoing: fade out with a hair of upward lift. Shorter than the
  // entrance so the two overlap into a soft cross-fade.
  function concealOut(_node: Element, { duration = 380 } = {}) {
    if (prefersReduced) return { duration: 120, css: (t: number) => `opacity:${t}` };
    return {
      duration,
      easing: cubicInOut,
      css: (t: number) => `opacity:${t}; transform:translateY(${-(1 - t) * 6}px);`,
    };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      error = 'Enter a valid email address.';
      return;
    }
    if (!password) {
      error = 'Enter your password.';
      return;
    }
    try {
      await auth.login({ email: cleanEmail, password });
      void goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'That email and password did not match.';
    }
  }

  async function handleGoogleCredential(credential: string) {
    error = null;
    try {
      await auth.loginWithGoogle({ credential, primaryLanguage: 'en' });
      void goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Google sign-in failed. Please try again.';
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

    <!-- Background mark — large faded V (drifts slowly). Source's blue
         gradient glyph at 7% — pixel-matches the icon on the navy gradient. -->
    <div
      aria-hidden="true"
      class="animate-drift pointer-events-none absolute -bottom-32 -right-32 w-[640px] select-none opacity-[0.07]"
    >
      <VMark class="w-full" />
    </div>

    <!-- Brand -->
    <a href="/" class="rise-1 relative z-10 inline-flex items-center self-start" aria-label="Versifine home">
      <Wordmark class="h-[22px] w-auto text-white" />
    </a>

    <!-- Rotating story — features, tips, craft notes, honest takes. Each
         line is true and specific (sourced from the project docs). One
         stays for its reading time, then hands off with a soft reveal.
         Fills the space between brand and footer and centers vertically. -->
    <div class="rise-2 relative z-10 flex flex-1 items-center">
      <div class="relative min-h-[280px] w-full max-w-md">
        {#key slide.id}
          <figure class="absolute inset-0 flex flex-col justify-center" in:revealIn out:concealOut>
            <figcaption class="mb-5 flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
              <span aria-hidden="true" class="h-px w-7 bg-gradient-to-r from-white/50 to-transparent"></span>
              {KIND_LABEL[slide.kind]}
            </figcaption>
            <p class="font-light tracking-[-0.01em] text-white/95 {slide.kind === 'voice' ? 'text-[24px] leading-[1.5]' : 'text-[22px] leading-[1.55]'}">
              {slide.text}
            </p>
            {#if slide.by}
              <footer class="mt-6 flex items-center gap-2 text-[13px] text-white/55">
                <span aria-hidden="true" class="animate-livedot inline-block h-1.5 w-1.5 rounded-full bg-green-400"></span>
                <span>{slide.by}</span>
              </footer>
            {/if}
          </figure>
        {/key}
      </div>
    </div>

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
    <!-- Huge V bleeding off the top-right edge — static watermark.
         Same source gradient glyph, at 5% on the white panel. -->
    <VMark
      class="pointer-events-none absolute -right-40 -top-32 w-[460px] select-none"
      style="opacity: 0.05;"
    />

    <header class="rise-1 relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
      <a href="/" class="flex items-center lg:hidden" aria-label="Versifine home">
        <Wordmark class="h-6 w-auto text-[var(--brand)]" />
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
          <GoogleSignInButton
            text="continue_with"
            disabled={auth.loading}
            onCredential={handleGoogleCredential}
          />
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
