<script lang="ts">
  /**
   * Landing page.
   *
   * Six sections stacked: hero, feature grid, WhatsApp demo, AI copilot
   * demo, multilingual / privacy, FAQ, final CTA. Routed at `/`. The
   * layout treats this as a public route and skips the app shell.
   */
  import { fade, fly } from 'svelte/transition';
  import {
    ArrowRight,
    CheckCircle2,
    MessageCircle,
    Sparkles,
    ShieldCheck,
    PlayCircle,
    Languages,
  } from 'lucide-svelte';
  import Header from '$lib/components/landing/Header.svelte';
  import Footer from '$lib/components/landing/Footer.svelte';
  import FeatureGrid from '$lib/components/landing/FeatureGrid.svelte';
  import WhatsAppDemo from '$lib/components/landing/WhatsAppDemo.svelte';
  import CopilotDemo from '$lib/components/landing/CopilotDemo.svelte';
  import { Button } from '$lib/components/ui';

  // The public-facing WhatsApp redirect uses wa.me. The bot will reply
  // with a registration nudge for unknown numbers — exactly matches
  // the production behaviour, so this works the moment the bot is paired.
  const WA_NUMBER = '919999900001';
  const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('hi')}`;

  // Six FAQs covering the most asked questions.
  const FAQ: Array<{ q: string; a: string }> = [
    {
      q: 'Is my data private?',
      a: 'Yes. Your transactions live in your own database row and never leave the server unless you explicitly use the AI copilot. Toggle Privacy Mode and even categorisation runs client-side — the raw text never reaches us.',
    },
    {
      q: 'Do I have to use WhatsApp?',
      a: 'Not at all. Versifine works fully from the web dashboard. WhatsApp is a second surface — same data, same AI — for when typing into an app feels heavier than firing off a quick voice note.',
    },
    {
      q: 'Which languages do you support?',
      a: 'Six end-to-end: English, Hindi, Malayalam, Tamil, Telugu, and Kannada. Capture, replies, and voice-note synthesis all respect your chosen primary language. The dashboard UI shell ships in English, Hindi, and Malayalam today; the others fall back to English with translated dynamic content.',
    },
    {
      q: 'How is the forecast computed?',
      a: 'Two layers. Recurring detection groups merchants by normalised name and flags anything that repeats at 7-, 30-, or 90-day intervals with low amount variance — that\'s your "locked-in" base. The variable component is fed through an in-house ARIMA(1,1,1) with a rolling-mean fallback. You see both numbers separately, plus a 95% confidence band.',
    },
    {
      q: 'Where does the AI fabrication risk go?',
      a: 'The copilot can\'t do math in prose — every total, breakdown, forecast, and comparison comes from a tool function the model calls explicitly. The system prompt enforces "if the data doesn\'t answer the question, say so" rather than guessing. You see every tool call inline.',
    },
    {
      q: 'Is this open source?',
      a: 'The code is public on GitHub. The hosted instance, the WhatsApp pairing, and the OpenAI keys are ours to operate. Self-hosting is straightforward — bring your own Postgres, OpenAI key, and a phone number.',
    },
  ];

  let openFaq = $state<number | null>(0);
  function toggleFaq(idx: number) {
    openFaq = openFaq === idx ? null : idx;
  }
</script>

<svelte:head>
  <title>Versifine — Your finances, finely tuned.</title>
  <meta name="description" content="Frictionless multimodal personal finance manager with an AI co-pilot. Capture by text, voice, or photo from the web or WhatsApp. Built India-first, multilingual, privacy-aware." />
  <meta property="og:title" content="Versifine — Your finances, finely tuned." />
  <meta property="og:description" content="Capture every rupee with a sentence, a voice note, or a photo — from the web or WhatsApp. Get honest forecasts, grounded insights, and budgets that learn." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://versifine.com" />
</svelte:head>

<div class="min-h-screen overflow-hidden bg-slate-950 text-slate-100 antialiased" data-theme="dark">
  <Header />

  <!-- ============================================================== HERO -->
  <section class="relative isolate pt-32 pb-20 sm:pt-40 sm:pb-28 lg:pt-48">
    <!-- Background ambient gradient blobs -->
    <div class="absolute inset-0 -z-10 overflow-hidden">
      <div class="absolute -top-32 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-violet-600/30 blur-3xl"></div>
      <div class="absolute right-[-10rem] top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-600/25 blur-3xl"></div>
      <div class="absolute left-[-12rem] top-80 h-[26rem] w-[26rem] rounded-full bg-fuchsia-600/20 blur-3xl"></div>
      <!-- Subtle grid overlay -->
      <svg class="absolute inset-0 h-full w-full opacity-[0.04]" aria-hidden="true">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" stroke-width="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>

    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-3xl text-center">
        <div in:fade={{ duration: 500 }} class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-violet-200 backdrop-blur">
          <span class="grid h-4 w-4 place-items-center rounded-full bg-violet-500/30">
            <span class="h-1.5 w-1.5 rounded-full bg-violet-300"></span>
          </span>
          Built India-first · Multilingual · Privacy-aware
        </div>

        <h1
          in:fly={{ y: 16, duration: 600, delay: 100 }}
          class="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl"
        >
          Your finances,
          <br />
          <span class="bg-gradient-to-br from-violet-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
            finely tuned.
          </span>
        </h1>

        <p
          in:fly={{ y: 16, duration: 600, delay: 200 }}
          class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300 sm:text-xl"
        >
          Capture every rupee with a sentence, a voice note, or a photo — from the web or WhatsApp.
          Get honest forecasts, grounded AI insights, and budgets that actually learn from your corrections.
        </p>

        <div in:fly={{ y: 16, duration: 600, delay: 300 }} class="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button
            href="/register"
            class="bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-xl shadow-violet-500/30 hover:opacity-90"
            size="lg"
          >
            Get started free
            <ArrowRight class="h-4 w-4" />
          </Button>
          <Button href="/login" variant="outline" size="lg" class="border-white/20 bg-white/5 text-white hover:bg-white/10">
            <PlayCircle class="h-4 w-4" />
            Try the demo
          </Button>
        </div>

        <p in:fade={{ delay: 400, duration: 400 }} class="mt-5 text-xs text-slate-400">
          Demo login pre-filled with 90 days of sample data. No card required.
        </p>
      </div>

      <!-- Hero "stat strip" -->
      <div
        in:fly={{ y: 24, duration: 700, delay: 400 }}
        class="mx-auto mt-20 grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur md:grid-cols-4"
      >
        {#each [
          { label: 'Languages', value: '6', sub: 'end-to-end' },
          { label: 'Categories', value: '23', sub: 'fine-tuned MiniLM' },
          { label: 'Forecast horizon', value: '30d', sub: 'ARIMA + rolling MA' },
          { label: 'Capture surfaces', value: '4', sub: 'text · voice · image · WA' },
        ] as stat (stat.label)}
          <div class="bg-slate-950/60 p-6 text-center">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{stat.label}</p>
            <p class="mt-2 text-3xl font-semibold tracking-tight text-white">{stat.value}</p>
            <p class="mt-1 text-xs text-slate-400">{stat.sub}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ========================================================== FEATURES -->
  <section id="features" class="relative scroll-mt-24 py-24 sm:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-2xl text-center">
        <p class="text-xs font-semibold uppercase tracking-widest text-violet-300">Capabilities</p>
        <h2 class="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          A complete finance stack, opinionated where it matters.
        </h2>
        <p class="mt-4 text-base text-slate-300 sm:text-lg">
          Six pillars carry the product: capture, copilot, forecast, privacy, recurring detection, and Indian-market fluency.
        </p>
      </div>

      <div class="mt-14">
        <FeatureGrid />
      </div>
    </div>
  </section>

  <!-- ========================================================== WHATSAPP -->
  <section id="whatsapp" class="relative scroll-mt-24 py-24 sm:py-32">
    <!-- Subtle gradient backdrop -->
    <div class="absolute inset-0 -z-10 overflow-hidden">
      <div class="absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl"></div>
    </div>

    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="grid items-center gap-16 lg:grid-cols-2">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-emerald-300">WhatsApp · live</p>
          <h2 class="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Log expenses without ever opening an app.
          </h2>
          <p class="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
            Send a sentence. A voice note. A photo of a bill. The bot transcribes,
            parses, categorises, and confirms — in your language, in seconds. The
            same intelligence that powers the dashboard, exposed where you already
            spend your day.
          </p>

          <ul class="mt-8 space-y-3">
            {#each [
              'Voice notes in six Indian languages — Whisper transcription with language hints.',
              'Receipt photos parsed by GPT-4o vision with editable confirmation drafts.',
              'Replies in text + a generated voice note when you sent voice in.',
              'WhatsApp Web session persists across deploys; pair once, forget about it.',
            ] as point (point)}
              <li class="flex items-start gap-3 text-sm text-slate-200">
                <CheckCircle2 class="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <span>{point}</span>
              </li>
            {/each}
          </ul>

          <div class="mt-10 flex flex-wrap items-center gap-3">
            <Button
              href={WA_LINK}
              size="lg"
              class="bg-emerald-500 text-white shadow-xl shadow-emerald-500/30 hover:bg-emerald-400"
            >
              <MessageCircle class="h-4 w-4" />
              Open in WhatsApp
            </Button>
            <Button
              href="/wa-qr/"
              variant="outline"
              size="lg"
              class="border-white/20 bg-white/5 text-white hover:bg-white/10"
            >
              See pairing QR
            </Button>
          </div>

          <p class="mt-4 text-xs text-slate-400">
            Heads up — the bot only replies to numbers linked to a Versifine account or on the demo allowlist. Send <code class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-200">LINK</code> after registering.
          </p>
        </div>

        <div class="relative mx-auto w-full max-w-md">
          <WhatsAppDemo />
        </div>
      </div>
    </div>
  </section>

  <!-- =========================================================== COPILOT -->
  <section id="copilot" class="relative scroll-mt-24 py-24 sm:py-32">
    <div class="absolute inset-0 -z-10 overflow-hidden">
      <div class="absolute right-1/4 top-1/2 h-[32rem] w-[32rem] -translate-y-1/2 rounded-full bg-violet-600/15 blur-3xl"></div>
    </div>

    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="grid items-center gap-16 lg:grid-cols-5">
        <div class="lg:col-span-2">
          <p class="text-xs font-semibold uppercase tracking-widest text-violet-300">Vivien · AI co-pilot</p>
          <h2 class="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            An AI that earns your trust by refusing to guess.
          </h2>
          <p class="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
            Ask a question in English, Hindi, Malayalam, anything mixed.
            Vivien runs PgVector RAG on your transactions, calls real
            <span class="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-violet-200">compute_total</span>
            and
            <span class="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-violet-200">compute_forecast</span>
            tools, and shows you the working. Numbers come from your data. Always.
          </p>

          <ul class="mt-8 space-y-3">
            {#each [
              'Streaming SSE responses, token-by-token.',
              'Tool-result cards rendered inline — see exactly which math ran.',
              'PgVector RAG over your last 20 most-relevant transactions.',
              'Refuses to fabricate. If the data does not answer, it says so.',
            ] as point (point)}
              <li class="flex items-start gap-3 text-sm text-slate-200">
                <CheckCircle2 class="mt-0.5 h-5 w-5 shrink-0 text-violet-400" />
                <span>{point}</span>
              </li>
            {/each}
          </ul>
        </div>

        <div class="lg:col-span-3">
          <CopilotDemo />
        </div>
      </div>
    </div>
  </section>

  <!-- =========================================================== PRIVACY + LANGUAGES SPLIT -->
  <section id="privacy" class="relative scroll-mt-24 py-24 sm:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="grid gap-8 lg:grid-cols-2">
        <article class="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/10 via-slate-900/60 to-slate-900 p-10">
          <span class="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30">
            <ShieldCheck class="h-6 w-6 text-white" />
          </span>
          <h3 class="mt-5 text-2xl font-semibold text-white sm:text-3xl">Privacy that actually does something.</h3>
          <p class="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Toggle Privacy Mode and a 30 MB MiniLM categoriser loads into your browser. Transaction text
            is classified locally — only the structured row goes server-side. Your descriptions never
            leave your device.
          </p>
          <dl class="mt-8 grid grid-cols-2 gap-6 text-sm">
            <div>
              <dt class="text-xs uppercase tracking-wider text-emerald-300">Tier 1</dt>
              <dd class="mt-1 text-slate-200">Your overrides win first. Personal merchant rules.</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wider text-emerald-300">Tier 2</dt>
              <dd class="mt-1 text-slate-200">Curated India-first merchant DB (~427 entries).</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wider text-emerald-300">Tier 3</dt>
              <dd class="mt-1 text-slate-200">Fine-tuned MiniLM ONNX for the long tail.</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wider text-emerald-300">Tier 4</dt>
              <dd class="mt-1 text-slate-200">Transparent fallback — never silent guesses.</dd>
            </div>
          </dl>
        </article>

        <article class="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-rose-500/10 via-slate-900/60 to-slate-900 p-10">
          <span class="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-rose-400 to-fuchsia-500 shadow-lg shadow-rose-500/30">
            <Languages class="h-6 w-6 text-white" />
          </span>
          <h3 class="mt-5 text-2xl font-semibold text-white sm:text-3xl">Six languages. No translation theatre.</h3>
          <p class="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Three hand-translated message packs (English, Hindi, Malayalam) plus runtime translation for
            Tamil, Telugu, Kannada — with sibling-script contamination checks so Tamil never leaks into
            Malayalam mid-sentence.
          </p>
          <ul class="mt-6 space-y-2.5 text-sm">
            {#each [
              { native: 'English', english: 'English', sample: 'Logged ₹450 — Transportation.' },
              { native: 'हिन्दी', english: 'Hindi', sample: '₹450 दर्ज किया गया — परिवहन।' },
              { native: 'മലയാളം', english: 'Malayalam', sample: '₹450 രേഖപ്പെടുത്തി — ഗതാഗതം.' },
              { native: 'தமிழ்', english: 'Tamil', sample: '₹450 பதிவு செய்யப்பட்டது — போக்குவரத்து.' },
              { native: 'తెలుగు', english: 'Telugu', sample: '₹450 నమోదు చేయబడింది — రవాణా.' },
              { native: 'ಕನ್ನಡ', english: 'Kannada', sample: '₹450 ದಾಖಲಿಸಲಾಗಿದೆ — ಸಾರಿಗೆ.' },
            ] as lang (lang.english)}
              <li class="flex items-baseline justify-between gap-3 border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
                <span class="flex items-baseline gap-2">
                  <span class="text-base font-medium text-white">{lang.native}</span>
                  <span class="text-xs text-slate-500">{lang.english}</span>
                </span>
                <span class="truncate text-xs text-slate-300">{lang.sample}</span>
              </li>
            {/each}
          </ul>
        </article>
      </div>
    </div>
  </section>

  <!-- ========================================================== FAQ -->
  <section id="faq" class="relative scroll-mt-24 py-24 sm:py-32">
    <div class="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
      <div class="text-center">
        <p class="text-xs font-semibold uppercase tracking-widest text-violet-300">FAQ</p>
        <h2 class="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Questions, answered.</h2>
      </div>

      <ul class="mt-12 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur">
        {#each FAQ as item, i (item.q)}
          <li>
            <button
              type="button"
              onclick={() => toggleFaq(i)}
              class="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/5"
              aria-expanded={openFaq === i}
            >
              <span class="text-base font-medium text-white">{item.q}</span>
              <span
                class="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 text-xs text-slate-300 transition-transform"
                style:transform={openFaq === i ? 'rotate(45deg)' : 'rotate(0deg)'}
              >+</span>
            </button>
            {#if openFaq === i}
              <div in:fly={{ y: -4, duration: 200 }} class="px-6 pb-5 text-sm leading-relaxed text-slate-300">
                {item.a}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <!-- ========================================================== CTA -->
  <section class="relative py-24 sm:py-32">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600 via-indigo-600 to-fuchsia-600 px-8 py-16 text-center shadow-2xl shadow-violet-900/40 sm:px-16">
        <!-- Soft noise / ambient -->
        <div class="absolute inset-0 -z-10 opacity-30">
          <svg class="h-full w-full" aria-hidden="true">
            <defs>
              <pattern id="cta-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" stroke-width="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cta-grid)" />
          </svg>
        </div>
        <div class="absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-fuchsia-400/40 blur-3xl"></div>

        <h2 class="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Capture your first transaction in 30 seconds.
        </h2>
        <p class="mx-auto mt-4 max-w-2xl text-base text-violet-100 sm:text-lg">
          Free to use. Sample data pre-loaded. No card. Toggle to your real data the moment you're ready.
        </p>
        <div class="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button
            href="/register"
            size="lg"
            class="bg-white text-violet-700 shadow-xl shadow-black/20 hover:bg-white/95"
          >
            <Sparkles class="h-4 w-4" />
            Create your account
          </Button>
          <Button
            href="/login"
            size="lg"
            variant="outline"
            class="border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20"
          >
            Use the demo login
            <ArrowRight class="h-4 w-4" />
          </Button>
        </div>

        <div class="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-violet-100">
          <span class="flex items-center gap-1.5"><CheckCircle2 class="h-4 w-4" />Open source</span>
          <span class="flex items-center gap-1.5"><CheckCircle2 class="h-4 w-4" />WhatsApp + web</span>
          <span class="flex items-center gap-1.5"><CheckCircle2 class="h-4 w-4" />6 Indian languages</span>
          <span class="flex items-center gap-1.5"><CheckCircle2 class="h-4 w-4" />Privacy mode</span>
        </div>
      </div>
    </div>
  </section>

  <Footer />
</div>

<style>
  /* Hide horizontal scrollbar caused by ambient blur shadows. */
  :global(html), :global(body) {
    overflow-x: hidden;
  }
</style>
