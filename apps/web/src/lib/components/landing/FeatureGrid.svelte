<script lang="ts">
  /**
   * Six-tile feature grid. Each tile follows the same shape — icon,
   * title, description, accent gradient at the top — so the section
   * scans cleanly even at a glance.
   *
   * Hover lifts the tile and brightens the accent line. Pure CSS;
   * no JS gymnastics.
   */
  import {
    Mic,
    Brain,
    LineChart,
    ShieldCheck,
    Repeat,
    Languages,
  } from 'lucide-svelte';

  type Tile = {
    title: string;
    blurb: string;
    icon: typeof Mic;
    accent: string;
  };

  const TILES: Tile[] = [
    {
      title: 'Multimodal capture',
      blurb:
        'Type, speak, or drop a photo of a receipt. Voice notes transcribe via Whisper; receipts parse via vision; everything routes to the same intent classifier and lands as a categorised transaction.',
      icon: Mic,
      accent: 'from-violet-400 to-indigo-500',
    },
    {
      title: 'AI co-pilot, grounded',
      blurb:
        'Ask "where did my money go?" — Vivien runs PgVector RAG on your transactions, calls real compute_total / breakdown / forecast tools, and streams an answer that never fabricates a number.',
      icon: Brain,
      accent: 'from-fuchsia-400 to-violet-500',
    },
    {
      title: 'ARIMA forecasting',
      blurb:
        'Locked-in recurring charges meet an in-house ARIMA(1,1,1) on the variable component. Get a 30-day forecast with confidence bands, plus z-score anomaly detection on the way in.',
      icon: LineChart,
      accent: 'from-indigo-400 to-sky-500',
    },
    {
      title: 'Privacy mode',
      blurb:
        'Toggle on, and a 30 MB MiniLM categoriser loads into your browser. Transaction text never leaves the device — categorisation happens client-side; only the structured row goes server-side.',
      icon: ShieldCheck,
      accent: 'from-emerald-400 to-teal-500',
    },
    {
      title: 'Recurring detection',
      blurb:
        'Every night, we group merchants by normalised name and flag anything that recurs at 7-, 30-, or 90-day rhythms with low amount variance. Subscriptions, EMIs, rent — all surfaced automatically.',
      icon: Repeat,
      accent: 'from-amber-400 to-orange-500',
    },
    {
      title: 'Built India-first, multilingual',
      blurb:
        'INR is base. UPI, Swiggy, Zerodha SIP and ₹/lakh/crore vocab are all native. Six Indian languages — English, Hindi, Malayalam, Tamil, Telugu, Kannada — handled in capture, copy, and voice replies.',
      icon: Languages,
      accent: 'from-rose-400 to-fuchsia-500',
    },
  ];
</script>

<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
  {#each TILES as tile (tile.title)}
    {@const Icon = tile.icon}
    <article
      class="group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-slate-900/60"
    >
      <span
        class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r {tile.accent} opacity-60 transition-opacity group-hover:opacity-100"
      ></span>
      <span
        class="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br {tile.accent} shadow-lg shadow-black/30"
      >
        <Icon class="h-5 w-5 text-white" />
      </span>
      <h3 class="mt-4 text-lg font-semibold text-white">{tile.title}</h3>
      <p class="mt-2 text-sm leading-relaxed text-slate-300">{tile.blurb}</p>
    </article>
  {/each}
</div>
