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
  void pendingCaptures.load();
  return {};
};

export const ssr = false;
export const prerender = false;
