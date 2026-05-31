<script lang="ts">
  /**
   * Landing page — editorial fintech. White ground, indigo ink, the Outfit
   * typeface, a restrained periwinkle accent. Numbered sections read like a
   * well-set prospectus rather than a SaaS template.
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { ArrowRight, ArrowUpRight, Check } from 'lucide-svelte';
  import Header from '$lib/components/landing/Header.svelte';
  import Footer from '$lib/components/landing/Footer.svelte';
  import FeatureGrid from '$lib/components/landing/FeatureGrid.svelte';
  import WhatsAppDemo from '$lib/components/landing/WhatsAppDemo.svelte';
  import CopilotDemo from '$lib/components/landing/CopilotDemo.svelte';

  const WA_NUMBER = '919999900001';
  const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('hi')}`;

  const LANGS = [
    { native: 'English', english: 'English', sample: 'Logged ₹450 — Transportation.' },
    { native: 'हिन्दी', english: 'Hindi', sample: '₹450 दर्ज किया गया — परिवहन।' },
    { native: 'മലയാളം', english: 'Malayalam', sample: '₹450 രേഖപ്പെടുത്തി — ഗതാഗതം.' },
    { native: 'தமிழ்', english: 'Tamil', sample: '₹450 பதிவு செய்யப்பட்டது — போக்குவரத்து.' },
    { native: 'తెలుగు', english: 'Telugu', sample: '₹450 నమోదు చేయబడింది — రవాణా.' },
    { native: 'ಕನ್ನಡ', english: 'Kannada', sample: '₹450 ದಾಖಲಿಸಲಾಗಿದೆ — ಸಾರಿಗೆ.' },
  ];

  const FAQ: Array<{ q: string; a: string }> = [
    { q: 'Is my data private?', a: 'Your transactions live in your own database row and never leave the server unless you explicitly ask the copilot. Toggle Privacy Mode and even categorisation runs in your browser — the raw text never reaches us.' },
    { q: 'Do I have to use WhatsApp?', a: 'Not at all. Versifine is fully usable from the web dashboard. WhatsApp is a second surface — same data, same intelligence — for when a quick voice note beats opening an app.' },
    { q: 'Which languages are supported?', a: 'Six, end-to-end: English, Hindi, Malayalam, Tamil, Telugu, and Kannada. Capture, replies, and voice synthesis all respect your primary language. The dashboard shell ships in English, Hindi, and Malayalam today.' },
    { q: 'How is the forecast computed?', a: 'Two layers. Recurring detection finds charges that repeat on 7-, 30-, or 90-day rhythms with low variance — your locked-in base. The variable component runs through an in-house ARIMA(1,1,1) with a rolling-mean fallback. You see both, plus a 95% band.' },
    { q: 'Can the AI make numbers up?', a: 'No. The copilot can\u2019t do arithmetic in prose — every total, breakdown, forecast and comparison comes from a tool function it calls explicitly, and you see each call inline. If the data doesn\u2019t answer, it says so.' },
    { q: 'Is it open source?', a: 'The code is public on GitHub. The hosted instance, WhatsApp pairing, and API keys are ours to run. Self-hosting is straightforward: bring your own Postgres, an OpenAI key, and a phone number.' },
  ];

  let openFaq = $state<number | null>(0);
  function toggleFaq(i: number) {
    openFaq = openFaq === i ? null : i;
  }

  // Lightweight scroll-reveal: add `is-visible` when sections enter view.
  let revealEls: HTMLElement[] = [];
  onMount(() => {
    if (!browser || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    for (const el of document.querySelectorAll('[data-reveal]')) io.observe(el);
    return () => io.disconnect();
  });
</script>

<svelte:head>
  <title>Versifine — Your finances, finely tuned.</title>
  <meta name="description" content="Frictionless multimodal personal finance with an AI co-pilot. Capture by text, voice, or photo from the web or WhatsApp. Built India-first, multilingual, privacy-aware." />
  <meta property="og:title" content="Versifine — Your finances, finely tuned." />
  <meta property="og:description" content="Capture every rupee with a sentence, a voice note, or a photo — from the web or WhatsApp. Honest forecasts, grounded insights, budgets that learn." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://versifine.com" />
</svelte:head>

<div class="min-h-screen overflow-x-hidden bg-[hsl(var(--brand-paper))] bg-grain text-[hsl(var(--foreground))]">
  <Header />

  <!-- ============================================================ HERO -->
  <section class="relative flex min-h-[100svh] items-center overflow-hidden pt-24 pb-12 sm:pt-32 sm:pb-16 lg:pt-36">
    <!-- Faint engraved arc behind the hero -->
    <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center opacity-[0.5]">
      <svg width="1200" height="600" viewBox="0 0 1200 600" fill="none" aria-hidden="true" class="max-w-none">
        {#each [0, 1, 2, 3, 4] as i (i)}
          <ellipse cx="600" cy={620 + i * 4} rx={520 - i * 90} ry={300 - i * 52} stroke="hsl(236 77% 31%)" stroke-opacity="0.06" stroke-width="1" />
        {/each}
      </svg>
    </div>

    <div class="vf-container-wide vf-page-gutter">
      <div class="mx-auto max-w-[76rem] text-center">
        <p data-reveal class="reveal inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
          <span class="h-px w-6 bg-[hsl(var(--brand-gold))]"></span>
          Personal finance, reimagined
          <span class="h-px w-6 bg-[hsl(var(--brand-gold))]"></span>
        </p>

        <h1 data-reveal class="reveal mt-7 font-display text-[clamp(2.8rem,5.8vw,8.25rem)] font-medium leading-[0.98] tracking-normal text-[hsl(var(--brand-navy))]">
          Your finances,
          <span class="relative whitespace-nowrap italic">
            finely&nbsp;tuned
            <svg class="absolute -bottom-2 left-0 w-full" height="10" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true">
              <path d="M2 7 C 80 2, 220 2, 298 6" stroke="hsl(242 87% 74%)" stroke-width="2.5" fill="none" stroke-linecap="round" />
            </svg>
          </span>.
        </h1>

        <p data-reveal class="reveal mx-auto mt-7 max-w-[48rem] text-[clamp(1.05rem,1.25vw,1.45rem)] leading-relaxed text-[hsl(var(--muted-foreground))] sm:mt-8">
          Capture every rupee with a sentence, a voice note, or a photo — from the web or
          WhatsApp. Get honest forecasts, grounded AI insight, and budgets that learn from
          your corrections.
        </p>

        <div data-reveal class="reveal mt-9 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-center">
          <a
            href="/register"
            class="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--brand-navy))] px-7 py-3.5 text-sm font-medium text-[hsl(var(--brand-paper))] shadow-[0_8px_24px_-10px_rgba(18,26,140,0.55)] transition-all hover:bg-[hsl(var(--brand-navy-deep))]"
          >
            Get started free
            <ArrowRight class="h-4 w-4 text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="/login"
            class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[hsl(var(--brand-navy)/0.2)] bg-white px-7 py-3.5 text-sm font-medium text-[hsl(var(--brand-navy))] transition-all hover:border-[hsl(var(--brand-navy)/0.4)]"
          >
            Try the live demo
          </a>
        </div>
        <p data-reveal class="reveal mt-5 text-xs text-[hsl(var(--muted-foreground))]">
          Demo pre-loaded with 90 days of sample data. No card required.
        </p>
      </div>

      <!-- Stat ledger -->
      <div data-reveal class="reveal mx-auto mt-14 grid max-w-[82rem] grid-cols-2 overflow-hidden border-y border-[hsl(var(--border))] sm:mt-20 md:grid-cols-4">
        {#each [
          { value: '6', label: 'Languages', sub: 'end-to-end' },
          { value: '23', label: 'Categories', sub: 'fine-tuned MiniLM' },
          { value: '30d', label: 'Forecast', sub: 'ARIMA + fallback' },
          { value: '4', label: 'Capture surfaces', sub: 'text · voice · photo · WA' },
        ] as stat, i (stat.label)}
          <div
            class={[
              'px-4 py-6 text-center sm:px-5 sm:py-7',
              i % 2 === 1 ? 'border-l border-[hsl(var(--border))]' : '',
              i >= 2 ? 'border-t border-[hsl(var(--border))] md:border-t-0' : '',
              i > 0 ? 'md:border-l md:border-[hsl(var(--border))]' : '',
            ].join(' ')}
          >
            <p class="font-display text-[clamp(2rem,3vw,3.25rem)] font-medium tracking-normal text-[hsl(var(--brand-navy))]">{stat.value}</p>
            <p class="mt-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground))]">{stat.label}</p>
            <p class="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{stat.sub}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ===================================================== CAPABILITIES -->
  <section id="capabilities" class="scroll-mt-28 py-20 sm:py-28 lg:py-32">
    <div class="vf-container vf-page-gutter">
      <div data-reveal class="reveal max-w-[56rem]">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">№ 01 — Capabilities</p>
        <h2 class="mt-4 font-display text-[clamp(2.35rem,3.5vw,4.7rem)] font-medium leading-[1.02] tracking-normal text-[hsl(var(--brand-navy))]">
          A complete finance stack, opinionated where it counts.
        </h2>
        <p class="mt-4 max-w-[45rem] text-[clamp(1rem,1.1vw,1.25rem)] leading-relaxed text-[hsl(var(--muted-foreground))]">
          Six pillars carry the product — capture, copilot, forecast, privacy, recurring
          detection, and genuine Indian-market fluency.
        </p>
      </div>
      <div data-reveal class="reveal mt-14">
        <FeatureGrid />
      </div>
    </div>
  </section>

  <!-- ========================================================= WHATSAPP -->
  <section id="whatsapp" class="scroll-mt-28 border-y border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.55)] py-20 sm:py-28 lg:py-32">
    <div class="vf-container vf-page-gutter">
      <div class="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.82fr)] xl:gap-20">
        <div data-reveal class="reveal">
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">№ 02 — WhatsApp</p>
          <h2 class="mt-4 max-w-[48rem] font-display text-[clamp(2.35rem,3.3vw,4.6rem)] font-medium leading-[1.02] tracking-normal text-[hsl(var(--brand-navy))]">
            Log an expense without opening an app.
          </h2>
          <p class="mt-5 max-w-[48rem] text-[clamp(1rem,1.1vw,1.25rem)] leading-relaxed text-[hsl(var(--muted-foreground))]">
            Send a sentence. A voice note. A photo of a bill. The bot transcribes, parses,
            categorises, and confirms — in your language, in seconds. The same intelligence
            behind the dashboard, where you already spend your day.
          </p>

          <ul class="mt-8 space-y-3.5">
            {#each [
              'Voice notes in six Indian languages, transcribed with a language hint.',
              'Receipt photos parsed by GPT-4o vision, confirmed before they persist.',
              'Replies come back as text plus a generated voice note when you send voice.',
              'The WhatsApp session survives deploys — pair once, forget about it.',
            ] as point (point)}
              <li class="flex items-start gap-3 text-[15px] text-[hsl(var(--foreground))]">
                <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--brand-navy))] text-[hsl(var(--brand-paper))]"><Check class="h-3 w-3" /></span>
                <span>{point}</span>
              </li>
            {/each}
          </ul>

          <div class="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <a href={WA_LINK} class="group inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[hsl(var(--brand-navy))] px-6 py-3 text-sm font-medium text-[hsl(var(--brand-paper))] transition-all hover:bg-[hsl(var(--brand-navy-deep))]">
              Open in WhatsApp
              <ArrowUpRight class="h-4 w-4 text-[hsl(var(--brand-gold))]" />
            </a>
            <a href="/wa-qr/" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[hsl(var(--brand-navy)/0.2)] bg-white px-6 py-3 text-sm font-medium text-[hsl(var(--brand-navy))] transition-all hover:border-[hsl(var(--brand-navy)/0.4)]">
              See pairing QR
            </a>
          </div>
          <p class="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
            The bot only replies to numbers linked to a Versifine account or on the demo allowlist. Send <code class="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-[10px]">LINK</code> after you register.
          </p>
        </div>

        <div data-reveal class="reveal min-w-0">
          <WhatsAppDemo />
        </div>
      </div>
    </div>
  </section>

  <!-- ========================================================== COPILOT -->
  <section id="copilot" class="scroll-mt-28 py-20 sm:py-28 lg:py-32">
    <div class="vf-container vf-page-gutter">
      <div class="grid items-start gap-12 lg:grid-cols-5 xl:gap-20">
        <div data-reveal class="reveal lg:col-span-2">
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">№ 03 — The Copilot</p>
          <h2 class="mt-4 font-display text-[clamp(2.35rem,3.3vw,4.6rem)] font-medium leading-[1.02] tracking-normal text-[hsl(var(--brand-navy))]">
            An AI that earns trust by refusing to guess.
          </h2>
          <p class="mt-5 text-[clamp(1rem,1.1vw,1.25rem)] leading-relaxed text-[hsl(var(--muted-foreground))]">
            Ask in English, Hindi, Malayalam — anything mixed. Vivien runs PgVector RAG over
            your transactions, calls real
            <span class="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-xs text-[hsl(var(--brand-navy))]">compute_total</span>
            and
            <span class="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-xs text-[hsl(var(--brand-navy))]">compute_forecast</span>
            tools, and shows the working. The numbers are yours. Always.
          </p>
          <ul class="mt-8 space-y-3.5">
            {#each [
              'Streaming responses, token by token.',
              'Tool-result cards render inline — see exactly which math ran.',
              'RAG over your twenty most relevant transactions.',
              'If the data doesn\u2019t answer, it says so. No fabrication.',
            ] as point (point)}
              <li class="flex items-start gap-3 text-[15px] text-[hsl(var(--foreground))]">
                <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--brand-navy))] text-[hsl(var(--brand-paper))]"><Check class="h-3 w-3" /></span>
                <span>{point}</span>
              </li>
            {/each}
          </ul>
        </div>
        <div data-reveal class="reveal min-w-0 lg:col-span-3">
          <CopilotDemo />
        </div>
      </div>
    </div>
  </section>

  <!-- ================================================ PRIVACY + LANGUAGES -->
  <section id="languages" class="scroll-mt-28 border-y border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory)/0.55)] py-20 sm:py-28 lg:py-32">
    <div class="vf-container vf-page-gutter">
      <div data-reveal class="reveal mb-10 max-w-[56rem] sm:mb-14">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">№ 04 — Privacy & Language</p>
        <h2 class="mt-4 font-display text-[clamp(2.35rem,3.3vw,4.6rem)] font-medium leading-[1.02] tracking-normal text-[hsl(var(--brand-navy))]">
          Built to respect your data and your tongue.
        </h2>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <article data-reveal class="reveal rounded-2xl border border-[hsl(var(--border))] bg-white p-5 shadow-sm sm:p-9">
          <h3 class="font-display text-2xl font-medium text-[hsl(var(--brand-navy))]">Privacy that does something.</h3>
          <p class="mt-3 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            Toggle Privacy Mode and a 30 MB MiniLM categoriser loads into your browser.
            Transaction text is classified locally — only the structured row goes to the
            server. Your descriptions never leave the device.
          </p>
          <ol class="mt-7 space-y-3">
            {#each [
              { t: 'Tier 1', d: 'Your own overrides win first — personal merchant rules.' },
              { t: 'Tier 2', d: 'A curated India-first merchant database, ~427 entries.' },
              { t: 'Tier 3', d: 'A fine-tuned MiniLM ONNX model for the long tail.' },
              { t: 'Tier 4', d: 'Transparent fallback — never a silent guess.' },
            ] as tier (tier.t)}
              <li class="flex items-baseline gap-4 border-t border-[hsl(var(--border))] pt-3 first:border-0 first:pt-0">
                <span class="w-12 shrink-0 font-mono text-xs font-semibold text-[hsl(var(--brand-gold))]">{tier.t}</span>
                <span class="text-sm text-[hsl(var(--foreground))]">{tier.d}</span>
              </li>
            {/each}
          </ol>
        </article>

        <article data-reveal class="reveal rounded-2xl border border-[hsl(var(--border))] bg-white p-5 shadow-sm sm:p-9">
          <h3 class="font-display text-2xl font-medium text-[hsl(var(--brand-navy))]">Six languages. No theatre.</h3>
          <p class="mt-3 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            Three hand-translated packs plus runtime translation for the rest — with
            sibling-script checks so Tamil never leaks into Malayalam mid-sentence. The same
            confirmation, in every supported language:
          </p>
          <ul class="mt-7 space-y-px">
            {#each LANGS as lang (lang.english)}
              <li class="flex flex-col gap-1 border-t border-[hsl(var(--border))] py-2.5 first:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span class="flex items-baseline gap-2">
                  <span class="text-base font-medium text-[hsl(var(--brand-navy))]">{lang.native}</span>
                  <span class="text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{lang.english}</span>
                </span>
                <span class="text-xs text-[hsl(var(--muted-foreground))] sm:max-w-[55%] sm:truncate sm:text-right">{lang.sample}</span>
              </li>
            {/each}
          </ul>
        </article>
      </div>
    </div>
  </section>

  <!-- ============================================================== FAQ -->
  <section id="faq" class="scroll-mt-28 py-20 sm:py-28 lg:py-32">
    <div class="vf-container vf-page-gutter grid gap-10 lg:grid-cols-3 lg:gap-16">
      <div data-reveal class="reveal lg:col-span-1">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">№ 05 — Questions</p>
        <h2 class="mt-4 font-display text-[clamp(2.35rem,3.3vw,4.6rem)] font-medium leading-[1.02] tracking-normal text-[hsl(var(--brand-navy))]">
          Answered, plainly.
        </h2>
        <p class="mt-4 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          Still curious? The whole thing is on
          <a href="https://github.com/cyberkunju/versifine" target="_blank" rel="noopener" class="text-[hsl(var(--brand-navy))] underline decoration-[hsl(var(--brand-gold))] underline-offset-4">GitHub</a>.
        </p>
      </div>

      <ul data-reveal class="reveal lg:col-span-2">
        {#each FAQ as item, i (item.q)}
          <li class="border-t border-[hsl(var(--border))] last:border-b">
            <button
              type="button"
              onclick={() => toggleFaq(i)}
              class="flex w-full items-center justify-between gap-6 py-5 text-left"
              aria-expanded={openFaq === i}
            >
              <span class="font-display text-lg font-medium text-[hsl(var(--brand-navy))]">{item.q}</span>
              <span
                class="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[hsl(var(--border))] text-[hsl(var(--brand-navy))] transition-transform duration-300"
                style:transform={openFaq === i ? 'rotate(45deg)' : 'rotate(0deg)'}
              >+</span>
            </button>
            {#if openFaq === i}
              <p class="pb-6 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))] sm:pr-12">{item.a}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <!-- ============================================================== CTA -->
  <section class="vf-page-gutter pb-20 sm:pb-28 lg:pb-36">
    <div data-reveal class="reveal vf-container overflow-hidden rounded-2xl bg-[hsl(var(--brand-navy))] px-6 py-16 text-center sm:px-16 sm:py-20">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--brand-gold))]">Begin</p>
      <h2 class="mx-auto mt-5 max-w-[52rem] font-display text-[clamp(2.25rem,3.3vw,4.5rem)] font-medium leading-[1.05] tracking-normal text-[hsl(var(--brand-paper))]">
        Capture your first transaction in thirty seconds.
      </h2>
      <p class="mx-auto mt-5 max-w-xl text-lg text-[hsl(var(--brand-paper)/0.75)]">
        Free to use. Sample data pre-loaded. No card. Flip to your real numbers whenever you’re ready.
      </p>
      <div class="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <a href="/register" class="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--brand-paper))] px-7 py-3.5 text-sm font-medium text-[hsl(var(--brand-navy))] transition-all hover:bg-white">
          Create your account
          <ArrowRight class="h-4 w-4 text-[hsl(var(--brand-gold))] transition-transform group-hover:translate-x-0.5" />
        </a>
        <a href="/login" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[hsl(var(--brand-paper)/0.25)] px-7 py-3.5 text-sm font-medium text-[hsl(var(--brand-paper))] transition-all hover:border-[hsl(var(--brand-paper)/0.5)]">
          Use the demo login
        </a>
      </div>
      <div class="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs text-[hsl(var(--brand-paper)/0.7)]">
        {#each ['Open source', 'WhatsApp + web', '6 Indian languages', 'Privacy mode'] as tag (tag)}
          <span class="flex items-center gap-1.5"><span class="h-1 w-1 rounded-full bg-[hsl(var(--brand-gold))]"></span>{tag}</span>
        {/each}
      </div>
    </div>
  </section>

  <Footer />
</div>

<style>
  /* Scroll-reveal: elements start slightly lowered + transparent, then
     ease up when `is-visible` is toggled by the IntersectionObserver.
     Falls back to fully visible if JS/IO is unavailable (no class added
     means default, so we invert: hidden only when JS marks them). */
  :global([data-reveal].reveal) {
    opacity: 0;
    transform: translateY(14px);
    transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
  }
  :global([data-reveal].reveal.is-visible) {
    opacity: 1;
    transform: none;
  }
  /* If the observer never runs (no JS), reveal everything after load. */
  @media (prefers-reduced-motion: reduce) {
    :global([data-reveal].reveal) {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
