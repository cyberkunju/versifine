<script lang="ts">
  /**
   * Footer — light editorial. Brand mark over a tagline, four link
   * columns, a hairline rule, and a quiet colophon. Navy ink on paper.
   */
  import { Code2, Mail, MessageCircle } from 'lucide-svelte';
  import Logo from '$lib/components/brand/Logo.svelte';

  const groups: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
    {
      title: 'Product',
      links: [
        { label: 'Capabilities', href: '#capabilities' },
        { label: 'WhatsApp', href: '#whatsapp' },
        { label: 'Copilot', href: '#copilot' },
        { label: 'Languages', href: '#languages' },
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
        { label: 'hello@versifine.com', href: 'mailto:hello@versifine.com', external: true },
      ],
    },
  ];

  const year = new Date().getFullYear();
</script>

<footer class="border-t border-[hsl(var(--border))] bg-[hsl(var(--brand-ivory))]">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8">
    <div class="grid grid-cols-2 gap-10 lg:grid-cols-6">
      <div class="col-span-2 lg:col-span-2">
        <Logo size={30} />
        <p class="mt-4 max-w-xs text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          Frictionless multimodal personal finance, with an AI co-pilot that actually understands your money. Built India-first.
        </p>
        <div class="mt-5 flex items-center gap-2">
          {#each [
            { icon: Code2, href: 'https://github.com/cyberkunju/versifine', label: 'Source on GitHub', external: true },
            { icon: MessageCircle, href: '/wa-qr/', label: 'WhatsApp pairing', external: false },
            { icon: Mail, href: 'mailto:hello@versifine.com', label: 'Email', external: true },
          ] as social (social.label)}
            {@const Icon = social.icon}
            <a
              href={social.href}
              target={social.external ? '_blank' : undefined}
              rel={social.external ? 'noopener' : undefined}
              class="grid h-9 w-9 place-items-center rounded-full border border-[hsl(var(--border))] bg-white text-[hsl(var(--brand-navy))] transition-colors hover:border-[hsl(var(--brand-navy)/0.3)] hover:bg-[hsl(var(--brand-navy))] hover:text-[hsl(var(--brand-paper))]"
              aria-label={social.label}
            >
              <Icon class="h-4 w-4" />
            </a>
          {/each}
        </div>
      </div>

      {#each groups as group (group.title)}
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--brand-navy))]">{group.title}</h3>
          <ul class="mt-4 space-y-2.5 text-sm">
            {#each group.links as link (link.label)}
              <li>
                <a
                  href={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noopener' : undefined}
                  class="text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--brand-navy))]"
                >
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>

    <div class="mt-14 flex flex-col items-start justify-between gap-2 border-t border-[hsl(var(--border))] pt-6 text-xs text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center">
      <p>© {year} Versifine. All rights reserved.</p>
      <p class="font-mono text-[11px]">Bun · Hono · SvelteKit · Drizzle · Postgres+pgvector · OpenAI</p>
    </div>
  </div>
</footer>
