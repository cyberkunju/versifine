<script lang="ts">
  /**
   * Topbar: hamburger (mobile), a spacer, and the right-side cluster of
   * command palette + theme toggle + copilot trigger. The capture omnibar
   * now floats in a bottom dock (OmnibarDock), so the top bar stays a quiet,
   * uncluttered control strip.
   */
  import { Menu, Sun, Moon, Monitor, MessageSquare, Command } from 'lucide-svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import Wordmark from '$lib/components/brand/Wordmark.svelte';
  import { Button, DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '$lib/components/ui';

  type Props = {
    onMenu: () => void;
    onOpenCommand: () => void;
    onOpenCopilot: (initial?: string) => void;
  };
  let { onMenu, onOpenCommand, onOpenCopilot }: Props = $props();

  const m = $derived(getMessages(settings.language));
</script>

<header class="flex h-14 shrink-0 items-center gap-3 border-b border-[hsl(var(--border))] px-4 sm:px-6">
  <button
    type="button"
    onclick={onMenu}
    class="grid h-9 w-9 place-items-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] lg:hidden"
    aria-label="Open menu"
  >
    <Menu class="h-5 w-5" />
  </button>

  <a href="/dashboard" class="flex items-center lg:hidden" aria-label="Versifine home">
    <Wordmark class="h-5 w-auto text-[hsl(var(--primary))]" />
  </a>

  <div class="flex-1"></div>

  <button
    type="button"
    onclick={onOpenCommand}
    class="hidden h-9 items-center gap-2 rounded-full border border-[hsl(var(--border))] px-3 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] sm:inline-flex"
    aria-label="Open command menu"
  >
    <Command class="h-3.5 w-3.5" />
    <span>Search</span>
    <kbd class="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1 py-px text-[10px] font-medium">{m.topbar.commandShortcut}</kbd>
  </button>

  <DropdownMenu>
    {#snippet trigger()}
      <Button variant="ghost" size="icon" aria-label={m.topbar.theme}>
        {#if settings.theme === 'light'}
          <Sun class="h-4 w-4" />
        {:else if settings.theme === 'dark'}
          <Moon class="h-4 w-4" />
        {:else}
          <Monitor class="h-4 w-4" />
        {/if}
      </Button>
    {/snippet}
    {#snippet content()}
      <DropdownMenuLabel>{m.topbar.theme}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => settings.setTheme('light')}>
        <Sun class="h-4 w-4" /> {m.topbar.light}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => settings.setTheme('dark')}>
        <Moon class="h-4 w-4" /> {m.topbar.dark}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => settings.setTheme('system')}>
        <Monitor class="h-4 w-4" /> {m.topbar.system}
      </DropdownMenuItem>
    {/snippet}
  </DropdownMenu>

  <Button
    variant="ghost"
    size="icon"
    aria-label={m.nav.askCopilot}
    onclick={() => onOpenCopilot()}
  >
    <MessageSquare class="h-4 w-4" />
  </Button>
</header>
