<script lang="ts">
  /**
   * Topbar: hamburger (mobile), the omnibar, and the right-side cluster
   * of theme toggle + copilot trigger + ⌘K hint.
   */
  import { Menu, Sun, Moon, Monitor, MessageSquare, Command } from 'lucide-svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import Omnibar from '$lib/components/omnibar/Omnibar.svelte';
  import { Button, DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '$lib/components/ui';

  type Props = {
    onMenu: () => void;
    onOpenCommand: () => void;
    onOpenCopilot: (initial?: string) => void;
  };
  let { onMenu, onOpenCommand, onOpenCopilot }: Props = $props();

  const m = $derived(getMessages(settings.language));
</script>

<header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 px-4 backdrop-blur">
  <button
    type="button"
    onclick={onMenu}
    class="grid h-9 w-9 place-items-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] lg:hidden"
    aria-label="Open menu"
  >
    <Menu class="h-5 w-5" />
  </button>

  <div class="flex-1">
    <Omnibar onOpenCopilot={(text) => onOpenCopilot(text)} />
  </div>

  <button
    type="button"
    onclick={onOpenCommand}
    class="hidden h-9 items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] sm:inline-flex"
    aria-label="Open command menu"
  >
    <Command class="h-3.5 w-3.5" />
    <span>{m.topbar.commandShortcut}</span>
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
