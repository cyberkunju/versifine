/**
 * Demo dataset. 90 days of realistic Indian transactions, plus budgets,
 * goals, ledger entries, and FX scenarios — everything a hackathon judge
 * needs to land on a populated dashboard within seconds of clone.
 *
 * Date semantics: anchored to `today` at seed time so the dataset is
 * always "the last 90 days" regardless of when it runs. Recurring items
 * keep stable monthly cadences (rent on the 1st, salary on the 30th,
 * Netflix on the 12th, etc.).
 *
 * The seed builds rows declaratively here; `scripts/seed.ts` loops the
 * arrays through the canonical create services so categorization, FX,
 * and event emission run identically to production traffic.
 */

export interface SeedWalletDef {
  name: string;
  type: 'cash' | 'bank' | 'upi' | 'credit_card' | 'wallet';
  currency: 'INR' | 'USD' | 'GBP';
  openingBalance: number;
}

export interface SeedTransactionDef {
  /** Days back from today (0 = today, 1 = yesterday, ...). */
  daysAgo: number;
  type: 'income' | 'expense' | 'opening_balance';
  walletName: string;
  amount: number;
  currency: 'INR' | 'USD' | 'GBP';
  description: string;
  category?: string;
  notes?: string;
  tags?: string[];
}

export interface SeedBudgetDef {
  name: string;
  recurrence: 'monthly';
  allocations: Record<string, number>;
  warnThreshold?: number;
  exceedThreshold?: number;
}

export interface SeedGoalDef {
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  linkedCategory?: string;
}

export interface SeedLedgerDef {
  direction: 'lent' | 'borrowed';
  counterpartyName: string;
  amount: number;
  currency: 'INR';
  daysAgo: number;
  note?: string;
}

export const DEMO_USER = {
  email: 'demo@versifine.com',
  password: 'Versifine#2026!',
  displayName: 'Demo User',
  primaryLanguage: 'en' as const,
};

export const DEMO_WALLETS: SeedWalletDef[] = [
  { name: 'HDFC Bank', type: 'bank', currency: 'INR', openingBalance: 78_500 },
  { name: 'Cash', type: 'cash', currency: 'INR', openingBalance: 4_200 },
  { name: 'GPay UPI', type: 'upi', currency: 'INR', openingBalance: 12_500 },
  { name: 'ICICI Credit Card', type: 'credit_card', currency: 'INR', openingBalance: 0 },
];

export const DEMO_BUDGETS: SeedBudgetDef[] = [
  {
    name: 'Monthly food',
    recurrence: 'monthly',
    allocations: {
      Groceries: 8000,
      Restaurants: 4000,
      'Food Delivery': 3000,
      'Coffee & Beverages': 1500,
    },
  },
  {
    name: 'Monthly transport',
    recurrence: 'monthly',
    allocations: {
      Transportation: 3000,
      'Gas & Fuel': 5000,
      Travel: 2500,
    },
  },
  {
    name: 'Monthly lifestyle',
    recurrence: 'monthly',
    allocations: {
      Entertainment: 2000,
      Subscriptions: 2500,
      'Shopping & Retail': 5000,
    },
  },
];

export const DEMO_GOALS: SeedGoalDef[] = [
  {
    name: 'Emergency Fund',
    targetAmount: 250_000,
    currentAmount: 137_500,
    deadline: deadlineMonthsFromNow(8),
  },
  {
    name: 'New Macbook',
    targetAmount: 200_000,
    currentAmount: 42_000,
    deadline: deadlineMonthsFromNow(7),
    linkedCategory: 'Shopping & Retail',
  },
  {
    name: 'Goa Trip 2026',
    targetAmount: 60_000,
    currentAmount: 18_500,
    deadline: deadlineMonthsFromNow(4),
    linkedCategory: 'Travel',
  },
];

export const DEMO_LEDGER: SeedLedgerDef[] = [
  {
    direction: 'lent',
    counterpartyName: 'Rohit',
    amount: 2000,
    currency: 'INR',
    daysAgo: 18,
    note: 'Rohit was short for the bike service.',
  },
  {
    direction: 'borrowed',
    counterpartyName: 'Sister',
    amount: 5000,
    currency: 'INR',
    daysAgo: 35,
    note: 'Quick loan, returning next month.',
  },
  {
    direction: 'lent',
    counterpartyName: 'Aman',
    amount: 800,
    currency: 'INR',
    daysAgo: 4,
    note: 'Coffee + lunch.',
  },
];

/**
 * Deterministic PRNG so the seed is reproducible across runs. xorshift32
 * with a fixed seed; same inputs ⇒ same dataset.
 */
function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Pick one element of `pool` deterministically. */
function pick<T>(pool: ReadonlyArray<T>, r: number): T {
  // Pool is non-empty by call-site contract; use 0 as a defensive fallback.
  return pool[Math.floor(r * pool.length)] ?? (pool[0] as T);
}

function jitter(base: number, pct: number, r: number): number {
  return Math.round(base * (1 + (r - 0.5) * 2 * pct));
}

const random = rng(20260528);

interface Recurring {
  description: string;
  category: string;
  amount: number;
  /** Day-of-month it lands on (1-28 for safety). */
  dayOfMonth: number;
  walletName: string;
  type?: 'income' | 'expense';
  tags?: string[];
}

const RECURRING: Recurring[] = [
  // Salary credit
  {
    description: 'Acme Payroll — May Salary',
    category: 'Income',
    amount: 95000,
    dayOfMonth: 30,
    walletName: 'HDFC Bank',
    type: 'income',
    tags: ['salary'],
  },
  // Rent
  {
    description: 'Rent — June',
    category: 'Housing',
    amount: 22000,
    dayOfMonth: 1,
    walletName: 'HDFC Bank',
  },
  // SIP
  {
    description: 'Zerodha SIP — Equity Fund',
    category: 'Transfers',
    amount: 5000,
    dayOfMonth: 5,
    walletName: 'HDFC Bank',
    tags: ['investment'],
  },
  // Subscriptions
  {
    description: 'Netflix Premium',
    category: 'Subscriptions',
    amount: 649,
    dayOfMonth: 12,
    walletName: 'ICICI Credit Card',
  },
  {
    description: 'Spotify Family',
    category: 'Subscriptions',
    amount: 179,
    dayOfMonth: 8,
    walletName: 'ICICI Credit Card',
  },
  {
    description: 'JioFiber broadband',
    category: 'Bills & Utilities',
    amount: 999,
    dayOfMonth: 14,
    walletName: 'GPay UPI',
  },
  {
    description: 'BESCOM electricity',
    category: 'Bills & Utilities',
    amount: 1450,
    dayOfMonth: 22,
    walletName: 'GPay UPI',
  },
  {
    description: 'Vi Postpaid mobile',
    category: 'Bills & Utilities',
    amount: 449,
    dayOfMonth: 17,
    walletName: 'GPay UPI',
  },
];

const VARIABLE: Array<Omit<Recurring, 'dayOfMonth'> & { weight: number }> = [
  {
    description: 'Swiggy order',
    category: 'Food Delivery',
    amount: 380,
    walletName: 'GPay UPI',
    weight: 6,
  },
  {
    description: 'Zomato dinner',
    category: 'Food Delivery',
    amount: 520,
    walletName: 'GPay UPI',
    weight: 4,
  },
  {
    description: 'BigBasket groceries',
    category: 'Groceries',
    amount: 1850,
    walletName: 'GPay UPI',
    weight: 3,
  },
  {
    description: 'Local kirana store',
    category: 'Groceries',
    amount: 420,
    walletName: 'Cash',
    weight: 4,
  },
  {
    description: 'Zepto express delivery',
    category: 'Convenience',
    amount: 250,
    walletName: 'GPay UPI',
    weight: 3,
  },
  {
    description: 'Auto rickshaw to office',
    category: 'Transportation',
    amount: 95,
    walletName: 'GPay UPI',
    weight: 5,
  },
  {
    description: 'Uber to airport',
    category: 'Transportation',
    amount: 480,
    walletName: 'GPay UPI',
    weight: 1,
  },
  {
    description: 'Rapido bike',
    category: 'Transportation',
    amount: 65,
    walletName: 'GPay UPI',
    weight: 4,
  },
  {
    description: 'Bengaluru Metro card top-up',
    category: 'Transportation',
    amount: 200,
    walletName: 'GPay UPI',
    weight: 1,
  },
  {
    description: 'BPCL fuel',
    category: 'Gas & Fuel',
    amount: 1200,
    walletName: 'ICICI Credit Card',
    weight: 2,
  },
  {
    description: 'Starbucks Indiranagar',
    category: 'Coffee & Beverages',
    amount: 320,
    walletName: 'ICICI Credit Card',
    weight: 3,
  },
  {
    description: 'Third Wave Coffee',
    category: 'Coffee & Beverages',
    amount: 220,
    walletName: 'GPay UPI',
    weight: 3,
  },
  {
    description: 'Cafe Coffee Day',
    category: 'Coffee & Beverages',
    amount: 180,
    walletName: 'GPay UPI',
    weight: 2,
  },
  {
    description: 'Truffles burger',
    category: 'Restaurants',
    amount: 850,
    walletName: 'ICICI Credit Card',
    weight: 2,
  },
  {
    description: 'Meghana Foods biryani',
    category: 'Restaurants',
    amount: 520,
    walletName: 'GPay UPI',
    weight: 2,
  },
  {
    description: 'Empire chicken',
    category: 'Fast Food',
    amount: 290,
    walletName: 'GPay UPI',
    weight: 2,
  },
  {
    description: 'KFC bucket',
    category: 'Fast Food',
    amount: 480,
    walletName: 'GPay UPI',
    weight: 1,
  },
  {
    description: 'Amazon order',
    category: 'Shopping & Retail',
    amount: 1499,
    walletName: 'ICICI Credit Card',
    weight: 2,
  },
  {
    description: 'Flipkart electronics',
    category: 'Shopping & Retail',
    amount: 2299,
    walletName: 'ICICI Credit Card',
    weight: 1,
  },
  {
    description: 'Apollo pharmacy',
    category: 'Healthcare',
    amount: 350,
    walletName: 'GPay UPI',
    weight: 1,
  },
  {
    description: 'BookMyShow movie',
    category: 'Entertainment',
    amount: 600,
    walletName: 'GPay UPI',
    weight: 1,
  },
  {
    description: 'Decathlon gear',
    category: 'Shopping & Retail',
    amount: 1850,
    walletName: 'ICICI Credit Card',
    weight: 1,
  },
];

/**
 * Build the full transactions list anchored to today.
 *
 * The generator walks each of the last 90 days, drops in the recurring
 * entries that fall on that calendar day, and adds 0-3 random variable
 * entries weighted by `VARIABLE[].weight`. A handful of intentional
 * anomalies and one FX entry per month land on fixed offsets so the
 * forecast and copilot can surface them.
 */
export function buildSeedTransactions(): SeedTransactionDef[] {
  const out: SeedTransactionDef[] = [];
  const totalWeight = VARIABLE.reduce((acc, v) => acc + v.weight, 0);

  for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
    const day = subtractDays(new Date(), daysAgo);
    const dom = day.getUTCDate();

    // Recurring entries whose day matches.
    for (const r of RECURRING) {
      if (dom === r.dayOfMonth) {
        out.push({
          daysAgo,
          type: r.type ?? 'expense',
          walletName: r.walletName,
          amount: jitter(r.amount, 0.02, random()),
          currency: 'INR',
          description: r.description,
          category: r.category,
          ...(r.tags ? { tags: r.tags } : {}),
        });
      }
    }

    // Variable entries — 1 to 3 per day with weighted picks.
    const dailyCount = Math.floor(random() * 3) + 1;
    for (let i = 0; i < dailyCount; i += 1) {
      let pickWeight = random() * totalWeight;
      let chosen = VARIABLE[0]!;
      for (const v of VARIABLE) {
        pickWeight -= v.weight;
        if (pickWeight <= 0) {
          chosen = v;
          break;
        }
      }
      out.push({
        daysAgo,
        type: 'expense',
        walletName: chosen.walletName,
        amount: jitter(chosen.amount, 0.18, random()),
        currency: 'INR',
        description: chosen.description,
        category: chosen.category,
      });
    }
  }

  // Anomalies — three intentional outliers across the 90-day window.
  out.push({
    daysAgo: 44,
    type: 'expense',
    walletName: 'ICICI Credit Card',
    amount: 9300,
    currency: 'INR',
    description: 'Apollo Hospital — emergency visit',
    category: 'Healthcare',
    tags: ['unexpected'],
  });
  out.push({
    daysAgo: 22,
    type: 'expense',
    walletName: 'ICICI Credit Card',
    amount: 4800,
    currency: 'INR',
    description: 'Toit Bangalore — team dinner',
    category: 'Restaurants',
  });
  out.push({
    daysAgo: 12,
    type: 'expense',
    walletName: 'ICICI Credit Card',
    amount: 6200,
    currency: 'INR',
    description: 'Decathlon — running shoes',
    category: 'Shopping & Retail',
  });

  // FX scenarios — one USD lunch on a work trip, one GBP hotel.
  out.push({
    daysAgo: 31,
    type: 'expense',
    walletName: 'ICICI Credit Card',
    amount: 18,
    currency: 'USD',
    description: 'Lunch in San Francisco',
    category: 'Restaurants',
    tags: ['travel'],
  });
  out.push({
    daysAgo: 67,
    type: 'expense',
    walletName: 'ICICI Credit Card',
    amount: 90,
    currency: 'GBP',
    description: 'Hotel — London 1 night',
    category: 'Travel',
    tags: ['travel'],
  });

  // Split-bill scenario surfaced as a single entry; the user's share lives
  // here, the lend ledger entry is in DEMO_LEDGER.
  out.push({
    daysAgo: 10,
    type: 'expense',
    walletName: 'ICICI Credit Card',
    amount: 800,
    currency: 'INR',
    description: 'Dinner with team — split 4 ways',
    category: 'Restaurants',
    notes: 'Total ₹3200, my share ₹800.',
    tags: ['split'],
  });

  return out;
}

function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function deadlineMonthsFromNow(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function isoDate(daysAgo: number): string {
  const d = subtractDays(new Date(), daysAgo);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
