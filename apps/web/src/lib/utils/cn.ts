import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tiny class merger used by every component. `clsx` builds the conditional
 * list and `twMerge` resolves Tailwind conflicts ("p-2 p-4" → "p-4") so
 * variant overrides win without a fight.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
