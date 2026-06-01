import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import { auth } from '$lib/stores/auth.svelte';
import { pendingCaptures } from '$lib/stores/pendingCaptures.svelte';

/**
 * Initial app boot.
 *
 * Auth is rune-state, so the load function returns nothing in particular —
 * it just kicks off the profile fetch and the offline-queue hydration so
 * the rest of the tree can render without a flash of unauthenticated UI.
 */
export const load: LayoutLoad = async () => {
  if (!browser) return {};
  if (!auth.ready) await auth.loadProfile();
  // Local dev convenience: if no real session resolved, seed a preview user
  // so the authenticated shell renders without logging in. Dev-only — this
  // branch is dead code in production builds (import.meta.env.DEV === false).
  if (import.meta.env.DEV && !auth.isAuthenticated) {
    auth.enableDevPreview();
  }
  void pendingCaptures.load();
  return {};
};

export const ssr = false;
export const prerender = false;
