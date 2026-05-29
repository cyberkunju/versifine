<script lang="ts">
  /**
   * Login page. Email + password form. On success the auth store updates
   * and the layout's redirect effect bounces the user to /.
   */
  import { goto } from '$app/navigation';
  import { Sparkles } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { getMessages } from '$lib/i18n';
  import { ApiError } from '$lib/api/types';
  import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Input, Label } from '$lib/components/ui';

  let email = $state('demo@versifine.com');
  let password = $state('Versifine#2026!');
  let error = $state<string | null>(null);
  const m = $derived(getMessages(settings.language));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    try {
      await auth.login({ email, password });
      void goto('/dashboard');
    } catch (err) {
      error = err instanceof ApiError ? err.message : m.auth.invalidCredentials;
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
      <CardTitle>{m.auth.welcomeBack}</CardTitle>
      <CardDescription>{m.app.tagline}</CardDescription>
    </CardHeader>
    <form onsubmit={submit} novalidate>
      <CardContent>
        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label for="email">{m.auth.email}</Label>
            <Input id="email" type="email" autocomplete="email" required bind:value={email} />
          </div>
          <div class="space-y-1.5">
            <Label for="password">{m.auth.password}</Label>
            <Input id="password" type="password" autocomplete="current-password" required bind:value={password} />
          </div>
          {#if error}
            <p class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>
          {/if}
        </div>
      </CardContent>
      <CardFooter class="flex flex-col items-stretch gap-3">
        <Button type="submit" disabled={auth.loading}>
          {auth.loading ? m.common.loading : m.auth.signIn}
        </Button>
        <p class="text-center text-xs text-[hsl(var(--muted-foreground))]">
          {m.auth.needAccount}
          <a class="text-[hsl(var(--primary))] hover:underline" href="/register">
            {m.auth.signUp}
          </a>
        </p>
      </CardFooter>
    </form>
  </Card>
</div>
