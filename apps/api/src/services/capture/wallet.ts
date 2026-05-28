/**
 * Wallet selection helpers for the capture pipeline.
 *
 * The parser may return a hint like "hdfc" or "cash" in `walletHint`. We
 * resolve that to an actual wallet id in the user's space:
 *   - exact (case-insensitive) name match wins
 *   - then a substring/word match against the wallet name
 *   - then a type alias (e.g. "card" → credit_card, "upi" → upi)
 *   - if nothing matches, fall back to the first non-archived wallet
 *
 * This is a best-effort step: when the user really needs to pick we set
 * `wallet` in the draft's `needs[]` so the omnibar asks once.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { wallets, type Wallet } from '../../db/schema/wallets.ts';

export interface WalletPick {
  wallet: Wallet | null;
  matched: 'name' | 'word' | 'type' | 'fallback' | 'none';
}

const TYPE_ALIASES: Record<string, Wallet['type']> = {
  cash: 'cash',
  bank: 'bank',
  upi: 'upi',
  card: 'credit_card',
  cc: 'credit_card',
  credit: 'credit_card',
  'credit card': 'credit_card',
  wallet: 'wallet',
  paytm: 'wallet',
  gpay: 'upi',
  phonepe: 'upi',
};

function normalizeHint(hint: string): string {
  return hint.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function listLiveWallets(spaceId: string): Promise<Wallet[]> {
  return db
    .select()
    .from(wallets)
    .where(and(eq(wallets.spaceId, spaceId), isNull(wallets.archivedAt)));
}

export function pickWallet(
  available: Wallet[],
  hint: string | null | undefined,
): WalletPick {
  if (available.length === 0) return { wallet: null, matched: 'none' };

  if (hint && hint.trim()) {
    const cleaned = normalizeHint(hint);

    // Exact name match.
    const exact = available.find((w) => w.name.toLowerCase() === cleaned);
    if (exact) return { wallet: exact, matched: 'name' };

    // Word-substring match (handles "hdfc" against "HDFC Bank").
    const wordMatches = available.filter((w) => {
      const n = w.name.toLowerCase();
      return n.includes(cleaned) || cleaned.split(' ').some((tok) => tok && n.includes(tok));
    });
    if (wordMatches[0]) return { wallet: wordMatches[0], matched: 'word' };

    // Type alias.
    const aliasType = TYPE_ALIASES[cleaned];
    if (aliasType) {
      const byType = available.find((w) => w.type === aliasType);
      if (byType) return { wallet: byType, matched: 'type' };
    }
  }

  return { wallet: available[0]!, matched: 'fallback' };
}
