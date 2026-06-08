/**
 * Natural-language → savings goal.
 *
 * "save 50000 for a trip", "set a goal to save 1 lakh by december",
 * "goal 20k emergency fund" — the classifier tags these `set_goal`; this
 * module pulls the target amount (deterministic, scale-word aware), a short
 * goal name (the "for <X>" purpose), and an optional deadline, then creates
 * the goal via the existing goals service. It NEVER logs a spend.
 */
import { createGoal } from '../goals/index.ts';
import { extractAmount } from '../ai/parserRegex.ts';
import { log } from '../../utils/logger.ts';

export interface GoalView {
  name: string;
  targetAmount: number;
  deadline: string | null;
}

export type GoalResult =
  | { kind: 'goal'; goal: GoalView }
  | { kind: 'needs'; message: string };

// "for a trip", "for my wedding", "to buy a bike", "emergency fund".
const PURPOSE_RE =
  /\b(?:for|towards?|to\s+buy|to\s+get)\s+(?:a\s+|an\s+|my\s+|the\s+)?([\p{L}][\p{L}\s&'-]{1,38}?)(?:\s+by\b|\s+before\b|\s+in\s+\d|[.,!?]|$)/iu;
const FUND_RE = /\b([\p{L}][\p{L}\s'-]{2,30}?\s+fund)\b/iu;

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Best-effort deadline: "by december", "by 2027", "in 6 months". */
function extractGoalDeadline(text: string, now = new Date()): string | null {
  const lower = text.toLowerCase();
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const byMonth = /\bby\s+(?:end\s+of\s+)?([a-z]+)\b/.exec(lower);
  if (byMonth && MONTHS[byMonth[1]!]) {
    const m = MONTHS[byMonth[1]!]!;
    let y = now.getFullYear();
    // If that month already passed this year, target next year.
    if (m < now.getMonth() + 1) y += 1;
    return iso(y, m, lastDayOfMonth(y, m));
  }
  const byYear = /\bby\s+(20\d{2})\b/.exec(lower);
  if (byYear) {
    const y = Number(byYear[1]);
    return iso(y, 12, 31);
  }
  const inMonths = /\bin\s+(\d{1,2})\s+months?\b/.exec(lower);
  if (inMonths) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + Number(inMonths[1]));
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  const inYears = /\bin\s+(\d{1,2})\s+years?\b/.exec(lower);
  if (inYears) {
    return iso(now.getFullYear() + Number(inYears[1]), now.getMonth() + 1, now.getDate());
  }
  return null;
}

function extractGoalName(text: string): string {
  const purpose = PURPOSE_RE.exec(text);
  if (purpose?.[1]) {
    const n = purpose[1].trim();
    // Skip pure filler ("it", "this") that the loose regex might grab.
    if (n.length >= 2 && !/^(it|this|that|now|later)$/i.test(n)) return titleCase(n).slice(0, 80);
  }
  const fund = FUND_RE.exec(text);
  if (fund?.[1] && !/^(set|a|an|the|my|save|create)\b/i.test(fund[1].trim()))
    return titleCase(fund[1]).slice(0, 80);
  return 'Savings goal';
}

export async function handleGoal(spaceId: string, text: string): Promise<GoalResult> {
  const amt = extractAmount(text);
  if (amt.amount === null) {
    return { kind: 'needs', message: 'How much do you want to save?' };
  }
  const name = extractGoalName(text);
  const deadline = extractGoalDeadline(text);
  try {
    const row = await createGoal(spaceId, {
      name,
      targetAmount: amt.amount,
      currentAmount: 0,
      ...(deadline ? { deadline } : {}),
    });
    return {
      kind: 'goal',
      goal: {
        name: row.name,
        targetAmount: Number(row.targetAmount),
        deadline: row.deadline ?? null,
      },
    };
  } catch (err) {
    log.warn('GOAL_CREATE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return { kind: 'needs', message: "I couldn't set that goal — try again." };
  }
}
