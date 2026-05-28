<script lang="ts">
  /**
   * Register page. Bare-minimum fields: email, password, optional display
   * name, primary language. Server validates the password policy; we surface
   * the resulting error verbatim if it fires.
   */
  import { goto } from '$app/navigation';
  import { Sparkles } from 'lucide-svelte';
  import { LANGUAGE_META, LANGUAGES, type Language } from '@finehance/shared';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { ApiError } from '$lib/api/types';
  import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Input, Label } from '$lib/components/ui';

  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let primaryLanguage = $state<Language>('en');
  let error = $state<string | null>(null);
  const m = $derived(getMessages(settings.language));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    try {
      await auth.register({
        email,
        password,
        ...(displayName ? { displayName } : {}),
        primaryLanguage,
      });
      void goto('/');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Registration failed';
    }
  }
</script>

<div class="grid min-h-screen place-items-center px-4 py-10">
  <Card class="w-full max-w-md">
    <CardHeader>
      <div class="flex items-center gap-2 pb-2">
        <span class="grid h-8 w-8 place-items-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
          <Sparkles class="h-4 w-4" />
        </span>
        <span class="text-lg font-semibold">{m.app.title}</span>
      </div>
      <CardTitle>{m.auth.welcomeNew}</CardTitle>
      <CardDescription>{m.app.tagline}</CardDescription>
    </CardHeader>
    <form onsubmit={submit} novalidate>
      <CardContent>
        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label for="display">{m.auth.displayName}</Label>
            <Input id="display" autocomplete="nickname" bind:value={displayName} />
          </div>
          <div class="space-y-1.5">
            <Label for="email">{m.auth.email}</Label>
            <Input id="email" type="email" autocomplete="email" required bind:value={email} />
          </div>
          <div class="space-y-1.5">
            <Label for="password">{m.auth.password}</Label>
            <Input id="password" type="password" autocomplete="new-password" required bind:value={password} />
            <p class="text-xs text-[hsl(var(--muted-foreground))]">
              12+ chars, mixed case, a number, and a symbol.
            </p>
          </div>
          <div class="space-y-1.5">
            <Label for="lang">{m.auth.primaryLanguage}</Label>
            <select
              id="lang"
              bind:value={primaryLanguage}
              class="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            >
              {#each LANGUAGES as code (code)}
                <option value={code}>{LANGUAGE_META[code].nativeName} — {LANGUAGE_META[code].englishName}</option>
              {/each}
            </select>
          </div>
          {#if error}
            <p class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>
          {/if}
        </div>
      </CardContent>
      <CardFooter class="flex flex-col items-stretch gap-3">
        <Button type="submit" disabled={auth.loading}>
          {auth.loading ? m.common.loading : m.auth.signUp}
        </Button>
        <p class="text-center text-xs text-[hsl(var(--muted-foreground))]">
          {m.auth.haveAccount}
          <a class="text-[hsl(var(--primary))] hover:underline" href="/login">
            {m.auth.signIn}
          </a>
        </p>
      </CardFooter>
    </form>
  </Card>
</div>
