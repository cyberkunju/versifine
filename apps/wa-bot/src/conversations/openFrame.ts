/**
 * Open-frame state machine — generalised "the bot just asked a question and
 * is waiting for the answer".
 *
 * Why this exists.
 * ----------------
 * The session state column is too coarse to express "I asked which riyal —
 * the next reply, in any shape, should resolve THAT question". Without this
 * abstraction the user's answer races through the engine's general dispatch
 * (universal commands, settings detection, copilot fallback, capture)
 * and gets re-classified as a fresh utterance — which is how `Omr` ended up
 * routed to the onboarding language menu in production.
 *
 * The frame.
 * ----------
 *   • `kind`    — what we're waiting for (currency / wallet / category / ...)
 *   • `prompt`  — the literal text we asked (logs + retry-prompt rendering)
 *   • `options` — when the answer is a numbered pick, the list of valid choices
 *   • `context` — arbitrary data the resolver needs (draftId, locale, etc.).
 *                 Opaque to the engine.
 *   • `ts/ttlMs` — frames expire so a forgotten prompt can't lurk forever.
 *   • `retries` — count of consecutive `unknown` re-prompts. Auto-cleared
 *                 after MAX_RETRIES so the user is never trapped.
 *   • `v`       — schema version. Old shapes (v missing or != current) are
 *                 ignored so a deploy mid-flow can't crash a stale session.
 *
 * The contract.
 * -------------
 * A flow that wants to ask the user a question (and have the next inbound
 * resolve as that answer) calls `openFrame()` to stash the frame. On the
 * next turn, the engine calls `tryResolveFrame()` BEFORE EVERY OTHER
 * DISPATCH BRANCH (universal commands, state handlers, settings, copilot,
 * capture). This is essential — a frame that is reachable only AFTER state
 * branches reproduces the original "Omr → wrong route" production bug.
 *
 * Universal cancel terms ("cancel" / "stop" / "nevermind" / "skip") are
 * recognised by `tryResolveFrame` itself — they always clear the frame
 * regardless of the per-kind resolver, so the user can ALWAYS escape.
 *
 * The per-kind resolver decides the rest:
 *   • `consumed`  → the body answered the frame; reply is sent, frame cleared.
 *   • `unknown`   → looks like an attempted answer, didn't resolve. Frame
 *                   stays open with a re-prompt; retry counter ticks. After
 *                   MAX_RETRIES the frame self-clears.
 *   • `unrelated` → clearly not an answer (a fresh expense, a new question).
 *                   Frame is cleared; engine falls through with the body
 *                   intact. The user's fresh utterance is processed normally.
 */
import type { Session } from '../types.ts';
import { log } from '../utils/logger.ts';
import { effectiveLanguage } from '../utils/langDetect.ts';
import { getMessages } from './messages/index.ts';
import { updateSession } from './state.ts';

/** All known frame kinds. Adding a new frame requires a new resolver. */
export type FrameKind =
  | 'currency_choice'
  | 'wallet_choice'
  | 'category_choice'
  | 'amount_clarify'
  | 'reference_pick';

export interface FrameOption {
  /** Stable id the resolver matches against — usually an ISO code or uuid. */
  id: string;
  /** What we showed the user (used for log + retry-prompt rendering). */
  label: string;
  /** Frame-specific payload the resolver acts on. */
  payload?: unknown;
}

export interface OpenFrame {
  /** Schema version. Bumped when the shape changes incompatibly. */
  v: 1;
  kind: FrameKind;
  /** Verbatim prompt the bot sent, for log + re-render on retry. */
  prompt: string;
  /** Numbered options when the answer is a pick; absent for free-form frames. */
  options?: FrameOption[];
  /** Arbitrary context the resolver needs (draftId, originalText, locale, ...). */
  context: Record<string, unknown>;
  /** Frame creation time (ms epoch). */
  ts: number;
  /** Custom TTL in ms. Defaults to DEFAULT_TTL_MS when omitted. */
  ttlMs?: number;
  /** Consecutive `unknown` re-prompts without a clean resolve. */
  retries: number;
}

/** Current schema version. Read code rejects frames with mismatched `v`. */
const FRAME_VERSION = 1 as const;

/** 5 minutes — long enough for a thoughtful reply, hygienic enough not to lurk. */
const DEFAULT_TTL_MS = 5 * 60_000;

/** After this many consecutive `unknown` re-prompts, the frame self-clears so
 *  the user is never trapped in a loop with the picker. */
const MAX_RETRIES = 3;

/**
 * Universal cancel keywords — stripping punctuation/whitespace, exact match
 * (case-insensitive) clears any frame regardless of kind. Multilingual: the
 * canonical English token always works (every user knows "cancel"); native
 * verbs are a quality-of-life add. Single tokens only — anything longer
 * goes through the resolver as a normal answer attempt.
 */
const CANCEL_TOKENS = new Set([
  // English
  'cancel',
  'stop',
  'nevermind',
  'never mind',
  'skip',
  'forget it',
  'forget that',
  'no',
  // Hindi / Hinglish
  'rehne do',
  'chhodo',
  'bas',
  'kuch nahi',
  // Malayalam / Manglish
  'venda',
  'venam illa',
  'mathiyakk',
  'mathi',
  'illa',
  // Tamil
  'venam',
  'pottum',
  // Generic stop
  'exit',
  'quit',
]);

/** Normalise a user reply for cancel detection: lowercase + trim outer punct. */
function normalizeForCancel(body: string): string {
  return body
    .toLowerCase()
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Read the active frame, honouring TTL + version. Pure: no side-effects. */
export function getOpenFrame(session: Session): OpenFrame | null {
  const raw = session.pending?.openFrame as OpenFrame | undefined;
  if (!raw || raw.v !== FRAME_VERSION || typeof raw.kind !== 'string' || typeof raw.ts !== 'number') {
    return null;
  }
  const ttl = raw.ttlMs ?? DEFAULT_TTL_MS;
  if (Date.now() - raw.ts > ttl) return null;
  return raw;
}

/** True when there is an active (unexpired, current-version) frame. */
export function hasOpenFrame(session: Session): boolean {
  return getOpenFrame(session) != null;
}

/** Stash a frame on the session. Replaces any existing frame. */
export function openFrame(
  session: Session,
  frame: Omit<OpenFrame, 'ts' | 'retries' | 'v'>,
): void {
  const pending = { ...(session.pending ?? {}) };
  const stored: OpenFrame = {
    v: FRAME_VERSION,
    ...frame,
    ts: Date.now(),
    retries: 0,
  };
  pending.openFrame = stored;
  log.info('FRAME_OPEN', {
    phone: session.phone,
    kind: stored.kind,
    options: stored.options?.length ?? 0,
    ttlMs: stored.ttlMs ?? DEFAULT_TTL_MS,
  });
  updateSession(session.phone, { pending });
}

/** Clear any active frame. Safe to call when none is set. */
export function clearOpenFrame(session: Session, reason: string = 'manual'): void {
  if (!session.pending?.openFrame) return;
  const existing = session.pending.openFrame as Partial<OpenFrame>;
  const pending = { ...(session.pending ?? {}) };
  delete pending.openFrame;
  log.info('FRAME_CLEAR', { phone: session.phone, kind: existing.kind, reason });
  updateSession(session.phone, { pending });
}

/** Bump the retry counter on the current frame. Called on `unknown` verdicts. */
function bumpRetries(session: Session): number {
  const existing = (session.pending?.openFrame as OpenFrame | undefined) ?? null;
  if (!existing) return 0;
  const updated: OpenFrame = { ...existing, retries: existing.retries + 1 };
  const pending = { ...(session.pending ?? {}), openFrame: updated };
  updateSession(session.phone, { pending });
  return updated.retries;
}

/**
 * Resolver verdict.
 *   • `consumed`  — the body answered the frame; reply is in `text`.
 *   • `unknown`   — looks like an answer attempt, didn't resolve. Frame
 *                   stays open; resolver provides a re-prompt.
 *   • `unrelated` — clearly NOT an answer (a fresh expense, a new question).
 *                   Frame is cleared; engine continues with the body intact.
 */
export type ResolverVerdict =
  | { kind: 'consumed'; text: string; speakable?: boolean }
  | { kind: 'unknown'; text: string; speakable?: boolean }
  | { kind: 'unrelated' };

/** A frame resolver — one per FrameKind. Registered via `registerResolver`. */
export type FrameResolver = (
  session: Session,
  body: string,
  frame: OpenFrame,
) => Promise<ResolverVerdict>;

const resolvers: Partial<Record<FrameKind, FrameResolver>> = {};

/** Register a resolver for a frame kind. Idempotent: re-registering replaces. */
export function registerResolver(kind: FrameKind, resolver: FrameResolver): void {
  resolvers[kind] = resolver;
}

/**
 * One-shot bootstrap that imports every flow file with a resolver. Called by
 * `engine.ts` at startup. Explicit beats side-effect imports because:
 *   • tree-shaking can't accidentally drop a side-effect-only import,
 *   • test mocks can replace this whole function to bypass real resolvers,
 *   • a developer reading engine.ts immediately sees what's wired.
 */
export async function bootstrapResolvers(): Promise<void> {
  // Each import has a top-level `registerResolver(...)` call.
  await import('./flows/currencyPick.ts');
}

/**
 * Engine entry-point. MUST run BEFORE any other dispatch branch (universal
 * commands, state-based handlers, settings, copilot, capture) — the whole
 * point of this primitive is that frame answers don't get re-classified as
 * fresh utterances. Returns a reply when a frame consumed the message; null
 * when the engine should continue normal dispatch.
 *
 * Universal cancel handling: a single-token "cancel"/"stop"/"venda"/etc.
 * always clears the frame, regardless of the per-kind resolver — the user
 * MUST always be able to escape any picker.
 */
export async function tryResolveFrame(
  session: Session,
  body: string,
): Promise<{ text: string; speakable?: boolean; consumed: boolean } | null> {
  const frame = getOpenFrame(session);
  if (!frame) return null;

  // Universal cancel — always wins, regardless of kind.
  const cancelToken = normalizeForCancel(body);
  if (cancelToken && CANCEL_TOKENS.has(cancelToken)) {
    clearOpenFrame(session, 'user_cancel');
    const m = getMessages(effectiveLanguage(session));
    return {
      text: m.frameCancelled,
      speakable: false,
      consumed: true,
    };
  }

  const resolver = resolvers[frame.kind];
  if (!resolver) {
    // Defensive: unknown frame kind (e.g. resolver didn't bootstrap). Clear
    // so the user isn't trapped on a frame nobody can answer.
    clearOpenFrame(session, 'no_resolver');
    log.warn('FRAME_NO_RESOLVER', { phone: session.phone, kind: frame.kind });
    return null;
  }

  let verdict: ResolverVerdict;
  try {
    verdict = await resolver(session, body, frame);
  } catch (err) {
    // Resolver crashed. Keep the frame open so the user can retry — clearing
    // would lose state for a transient error. Log loudly.
    log.error('FRAME_RESOLVER_ERROR', {
      phone: session.phone,
      kind: frame.kind,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    const m = getMessages(effectiveLanguage(session));
    return {
      text: m.frameError,
      speakable: false,
      consumed: true,
    };
  }

  if (verdict.kind === 'consumed') {
    log.info('FRAME_RESOLVE', { phone: session.phone, kind: frame.kind });
    clearOpenFrame(session, 'consumed');
    return { text: verdict.text, speakable: verdict.speakable, consumed: true };
  }

  if (verdict.kind === 'unknown') {
    const retries = bumpRetries(session);
    log.info('FRAME_RETRY', { phone: session.phone, kind: frame.kind, retries });
    if (retries >= MAX_RETRIES) {
      clearOpenFrame(session, 'max_retries');
      const m = getMessages(effectiveLanguage(session));
      return {
        text: verdict.text + m.frameMaxRetriesSuffix,
        speakable: false,
        consumed: true,
      };
    }
    return { text: verdict.text, speakable: verdict.speakable ?? false, consumed: true };
  }

  // unrelated — release the frame; the engine processes the body fresh.
  log.info('FRAME_RELEASE', { phone: session.phone, kind: frame.kind });
  clearOpenFrame(session, 'unrelated');
  return null;
}
