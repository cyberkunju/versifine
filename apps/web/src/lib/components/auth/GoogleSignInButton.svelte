<script lang="ts">
  /**
   * Production Google Identity Services button.
   *
   * We render Google's official button instead of hand-rolling the OAuth UI.
   * GIS returns an ID token in the callback; the API verifies that token and
   * exchanges it for Versifine's normal access/refresh pair.
   */
  import { onMount } from 'svelte';
  import { PUBLIC_GOOGLE_CLIENT_ID } from '$lib/config';

  type ButtonText = 'signin_with' | 'signup_with' | 'continue_with';

  type Props = {
    text?: ButtonText;
    disabled?: boolean;
    onCredential: (credential: string) => void | Promise<void>;
  };

  let { text = 'continue_with', disabled = false, onCredential }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let status = $state<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');

  let scriptPromise: Promise<void> | null = null;

  function loadScript(): Promise<void> {
    if (typeof window === 'undefined') return Promise.reject(new Error('browser-only'));
    if (window.google?.accounts?.id) return Promise.resolve();
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]',
      );
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Google script failed')), {
          once: true,
        });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google script failed'));
      document.head.appendChild(script);
    });

    return scriptPromise;
  }

  function handleCredential(response: GoogleCredentialResponse): void {
    const credential = response.credential;
    if (!credential) {
      status = 'error';
      return;
    }
    void onCredential(credential);
  }

  onMount(() => {
    let alive = true;

    void (async () => {
      if (!PUBLIC_GOOGLE_CLIENT_ID) {
        status = 'unconfigured';
        return;
      }
      try {
        await loadScript();
        if (!alive || !host || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: PUBLIC_GOOGLE_CLIENT_ID,
          callback: handleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });
        const width = Math.max(240, Math.min(400, Math.floor(host.clientWidth || 360)));
        window.google.accounts.id.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        });
        status = 'ready';
      } catch {
        if (alive) status = 'error';
      }
    })();

    return () => {
      alive = false;
    };
  });
</script>

<div
  class:pointer-events-none={disabled || status !== 'ready'}
  class:opacity-70={disabled}
  class="google-button-shell"
>
  {#if status === 'loading'}
    <div class="google-fallback" aria-busy="true">
      <span class="google-spinner"></span>
      <span>Loading Google...</span>
    </div>
  {:else if status === 'unconfigured'}
    <button type="button" class="google-fallback" disabled>
      Google sign-in is not configured
    </button>
  {:else if status === 'error'}
    <button type="button" class="google-fallback" disabled>
      Google sign-in is unavailable
    </button>
  {/if}
  <div bind:this={host} class:hidden={status !== 'ready'}></div>
</div>

<style>
  .google-button-shell {
    min-height: 42px;
    width: 100%;
  }

  .google-button-shell :global(iframe),
  .google-button-shell :global(div[role='button']) {
    width: 100% !important;
  }

  .google-fallback {
    display: flex;
    min-height: 42px;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    border: 1px solid var(--border, hsl(var(--border)));
    border-radius: 0.375rem;
    background: var(--background, hsl(var(--background)));
    color: var(--muted-foreground, hsl(var(--muted-foreground)));
    font-size: 14px;
    font-weight: 500;
  }

  .google-spinner {
    height: 14px;
    width: 14px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 999px;
    animation: google-spin 0.7s linear infinite;
  }

  @keyframes google-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .google-spinner {
      animation: none;
    }
  }
</style>
