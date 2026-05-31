<script lang="ts">
  /**
   * Capabilities — presented as an editorial index. Each entry is a
   * numbered row with a hairline rule, a serif title, and a measured
   * description. Hovering lifts the navy index number and draws a gold
   * tick. No glassy cards, no glow.
   */
  import { Mic, Brain, LineChart, ShieldCheck, Repeat, Languages } from 'lucide-svelte';

  type Item = { n: string; title: string; blurb: string; icon: typeof Mic };

  const ITEMS: Item[] = [
    {
      n: '01',
      title: 'Multimodal capture',
      blurb: 'Type, speak, or photograph a receipt. Voice transcribes via Whisper; receipts parse via vision; everything funnels through one intent classifier and lands as a categorised transaction.',
      icon: Mic,
    },
    {
      n: '02',
      title: 'A copilot that won\u2019t guess',
      blurb: 'Ask anything. Vivien runs PgVector RAG over your transactions, calls real compute_total and forecast tools, and shows the working. Numbers come from your data — never invented.',
      icon: Brain,
    },
    {
      n: '03',
      title: 'Honest forecasting',
      blurb: 'Locked-in recurring charges meet an in-house ARIMA(1,1,1) on the variable spend. A 30-day forecast with confidence bands, plus z-score anomaly detection at the point of entry.',
      icon: LineChart,
    },
    {
      n: '04',
      title: 'Privacy that does something',
      blurb: 'Toggle Privacy Mode and a 30 MB MiniLM categoriser loads into your browser. Transaction text never leaves the device — only the structured row is stored server-side.',
      icon: ShieldCheck,
    },
    {
      n: '05',
      title: 'Recurring, detected',
      blurb: 'Each night we group merchants by normalised name and flag anything repeating on a 7-, 30-, or 90-day rhythm with low variance. Subscriptions, EMIs, rent — surfaced automatically.',
      icon: Repeat,
    },
    {
      n: '06',
      title: 'Built India-first',
      blurb: 'INR is base. UPI, Swiggy, Zerodha SIP and \u20b9/lakh/crore vocabulary are native. Six Indian languages handled across capture, copy, and voice replies.',
      icon: Languages,
    },
  ];
</script>

<div class="grid grid-cols-1 gap-x-10 gap-y-px sm:grid-cols-2 xl:grid-cols-3 2xl:gap-x-14">
  {#each ITEMS as item (item.n)}
    {@const Icon = item.icon}
    <article class="group flex gap-4 border-t border-[hsl(var(--border))] py-7 sm:gap-5 sm:py-8">
      <div class="flex flex-col items-start gap-3">
        <span class="font-display text-sm font-medium tabular-nums text-[hsl(var(--brand-gold))]">{item.n}</span>
        <span class="grid h-10 w-10 place-items-center rounded-lg border border-[hsl(var(--border))] bg-white text-[hsl(var(--brand-navy))] transition-colors group-hover:border-[hsl(var(--brand-navy)/0.3)] group-hover:bg-[hsl(var(--brand-navy))] group-hover:text-[hsl(var(--brand-paper))]">
          <Icon class="h-5 w-5" />
        </span>
      </div>
      <div class="min-w-0 pt-0.5">
        <h3 class="font-display text-xl font-medium tracking-normal text-[hsl(var(--brand-navy))]">{item.title}</h3>
        <p class="mt-2 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">{item.blurb}</p>
      </div>
    </article>
  {/each}
</div>
