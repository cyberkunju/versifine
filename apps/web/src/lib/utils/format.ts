import { settings } from '$lib/stores/settings.svelte';
import { type Currency, resolveCurrencySymbol } from '@versifine/shared';

/**
 * Currency formatting helpers — the omnibar, transaction list, and
 * dashboard all share these so a single change ripples everywhere.
 */

export function formatCurrency(amount: number, currency?: Currency): string {
  const c = currency ?? settings.baseCurrency;
  const symbol = resolveCurrencySymbol(c);
  const separator = symbol === c ? ' ' : '';

  if (c === 'INR') {
    return `${symbol}${separator}${formatINRGroups(amount)}`;
  }
  return `${symbol}${separator}${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatINRGroups(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const fixed = abs.toFixed(abs % 1 === 0 ? 0 : 2);
  const [whole, fraction] = fixed.split('.');
  if (!whole) return `${sign}${fixed}`;
  // Indian numbering: last 3 digits, then groups of 2 from the right.
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function relativeDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) return rtf(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf(-days, 'day');
  return formatDate(iso);
}

function rtf(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
}
