<script lang="ts">
  /**
   * Minimal footer. Brand mark, four link columns, copyright.
   * Stays consistent with the dark landing aesthetic.
   */
  import { Sparkles, Code2, Mail, MessageCircle } from 'lucide-svelte';

  const groups: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
    {
      title: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'WhatsApp', href: '#whatsapp' },
        { label: 'AI Copilot', href: '#copilot' },
        { label: 'Privacy', href: '#privacy' },
      ],
    },
    {
      title: 'Account',
      links: [
        { label: 'Log in', href: '/login' },
        { label: 'Create account', href: '/register' },
        { label: 'Try the demo', href: '/login' },
      ],
    },
    {
      title: 'Resources',
      links: [
        { label: 'Documentation', href: 'https://github.com/cyberkunju/versifine#readme', external: true },
        { label: 'GitHub', href: 'https://github.com/cyberkunju/versifine', external: true },
        { label: 'Status', href: '/healthz' },
      ],
    },
    {
      title: 'Contact',
      links: [
        { label: 'WhatsApp the bot', href: '/wa-qr/' },
        { label: 'Email', href: 'mailto:hello@versifine.com', external: true },
      ],
    },
  ];

  const year = new Date().getFullYear();
</script>

<footer class="border-t border-white/10 bg-slate-950 text-slate-400">
  <div class="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
    <div class="grid grid-cols-2 gap-8 lg:grid-cols-5">
      <div class="col-span-2 lg:col-span-2">
        <a href="/" class="flex items-center gap-2 text-base font-semibold tracking-tight text-white">
          <span class="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600">
            <Sparkles class="h-4 w-4 text-white" />
          </span>
          <span>Versifine</span>
        </a>
        <p class="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
          Frictionless multimodal personal finance with an AI co-pilot that actually understands your money. Built India-first.
        </p>
        <div class="mt-4 flex items-center gap-2">
          <a
            href="https://github.com/cyberkunju/versifine"
            target="_blank"
            rel="noopener"
            class="grid h-9 w-9 place-items-center rounded-md border border-white/10 transition-colors hover:border-white/20 hover:text-white"
            aria-label="Source on GitHub"
          >
            <Code2 class="h-4 w-4" />
          </a>
          <a
            href="/wa-qr/"
            class="grid h-9 w-9 place-items-center rounded-md border border-white/10 transition-colors hover:border-white/20 hover:text-white"
            aria-label="WhatsApp pairing"
          >
            <MessageCircle class="h-4 w-4" />
          </a>
          <a
            href="mailto:hello@versifine.com"
            class="grid h-9 w-9 place-items-center rounded-md border border-white/10 transition-colors hover:border-white/20 hover:text-white"
            aria-label="Email"
          >
            <Mail class="h-4 w-4" />
          </a>
        </div>
      </div>

      {#each groups as group (group.title)}
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500">{group.title}</h3>
          <ul class="mt-4 space-y-2.5 text-sm">
            {#each group.links as link (link.label)}
              <li>
                <a
                  href={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noopener' : undefined}
                  class="transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>

    <div class="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
      <p>© {year} Versifine. All rights reserved.</p>
      <p>Built with Bun, Hono, SvelteKit, Drizzle, Postgres + pgvector, OpenAI.</p>
    </div>
  </div>
</footer>
