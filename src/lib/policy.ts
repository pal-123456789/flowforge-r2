/**
 * FlowForge reliability policies.
 *
 * Wraps every node execution with the guarantees a real automation platform
 * needs: a hard timeout, bounded retries with exponential backoff, and an
 * optional continue-on-error escape hatch. It also owns *Failure Injection* —
 * the deliberate-failure switch used to demonstrate and test failure paths.
 *
 * Nothing here swallows errors: the caller always learns what happened, how
 * many attempts were made, and whether the failure was a timeout.
 */

import type { NodePolicy } from "./types";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_BACKOFF_MS = 300;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 5;
export const MAX_BACKOFF_MS = 5_000;

export interface EffectivePolicy {
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
  retryOn: "error" | "timeout" | "always";
  continueOnError: boolean;
  injectFailure: "none" | "error" | "timeout";
  injectMessage?: string;
}

/** Clamp and default a raw policy into the exact values the engine will use. */
export function normalizePolicy(p?: NodePolicy): EffectivePolicy {
  const timeoutMs = clamp(
    toInt(p?.timeoutMs, DEFAULT_TIMEOUT_MS),
    1,
    MAX_TIMEOUT_MS
  );
  const maxRetries = clamp(toInt(p?.maxRetries, 0), 0, MAX_RETRIES);
  const backoffMs = clamp(toInt(p?.backoffMs, DEFAULT_BACKOFF_MS), 0, MAX_BACKOFF_MS);
  const retryOn = p?.retryOn ?? "always";
  const injectFailure = p?.injectFailure ?? "none";
  return {
    timeoutMs,
    maxRetries,
    backoffMs,
    retryOn,
    continueOnError: p?.continueOnError === true,
    injectFailure,
    injectMessage: p?.injectMessage,
  };
}

/** True when the policy is entirely default and can be hidden in the UI. */
export function isDefaultPolicy(p?: NodePolicy): boolean {
  const e = normalizePolicy(p);
  return (
    e.timeoutMs === DEFAULT_TIMEOUT_MS &&
    e.maxRetries === 0 &&
    e.backoffMs === DEFAULT_BACKOFF_MS &&
    e.retryOn === "always" &&
    !e.continueOnError &&
    e.injectFailure === "none"
  );
}

/** Human summary for tooltips and the inspector header. */
export function describePolicy(p?: NodePolicy): string {
  const e = normalizePolicy(p);
  const bits: string[] = [`timeout ${e.timeoutMs}ms`];
  if (e.maxRetries > 0) bits.push(`${e.maxRetries} retr${e.maxRetries === 1 ? "y" : "ies"} @${e.backoffMs}ms`);
  if (e.continueOnError) bits.push("continue on error");
  if (e.injectFailure !== "none") bits.push(`INJECT ${e.injectFailure.toUpperCase()}`);
  return bits.join(" · ");
}

export interface AttemptRecord {
  attempt: number;
  ms: number;
  kind: "error" | "timeout";
  error: string;
  /** backoff actually waited before the next attempt */
  backoffMs?: number;
}

export interface PolicyOutcome<T> {
  ok: boolean;
  value?: T;
  /** the final error, when ok === false */
  error?: Error;
  /** total attempts made (1 when it succeeded first try) */
  attempts: number;
  /** the last failure kind */
  kind?: "error" | "timeout";
  /** true when the final failure was a timeout */
  timedOut: boolean;
  /** true when the failure was deliberately injected */
  injected: boolean;
  /** every failed attempt, in order — feeds the run console */
  history: AttemptRecord[];
  /** true when retries were exhausted rather than skipped */
  retriesExhausted: boolean;
}

export interface PolicyHooks {
  log: (level: "info" | "warn" | "error" | "debug", message: string) => void;
  /** abort the whole run */
  signal?: AbortSignal;
  /** injectable for tests */
  now?: () => number;
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Reject in `ms` unless the promise settles first, aborting the work. */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outer?: AbortSignal
): Promise<T> {
  const ac = new AbortController();
  const onOuterAbort = () => ac.abort();
  outer?.addEventListener("abort", onOuterAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(
        new Error(
          `[timeout] Node exceeded its ${timeoutMs}ms time limit and was aborted`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(ac.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

function isTimeoutError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /\[timeout\]|timed? ?out|AbortError|aborted/i.test(m);
}

/**
 * Execute `run` under a policy. Never throws — returns a PolicyOutcome so the
 * engine can decide whether to tolerate the failure.
 */
export async function withPolicy<T>(
  policy: NodePolicy | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  hooks: PolicyHooks
): Promise<PolicyOutcome<T>> {
  const eff = normalizePolicy(policy);
  const sleep = hooks.sleepImpl ?? defaultSleep;
  const history: AttemptRecord[] = [];

  /* ------------------------------ failure injection ----------------------------- */
  if (eff.injectFailure !== "none") {
    const msg =
      eff.injectMessage ||
      `[injected] Failure Injection forced a simulated ${eff.injectFailure} on this node`;
    hooks.log(
      "warn",
      `🧪 Failure Injection: forcing a simulated ${eff.injectFailure} failure`
    );
    if (eff.injectFailure === "timeout") {
      // Consume real wall-clock so the timeline shows a genuine stall.
      const stall = Math.min(eff.timeoutMs, 1200);
      await sleep(stall, hooks.signal).catch(() => {});
      const err = new Error(
        `[timeout] ${msg} (stalled ${stall}ms, then aborted)`
      );
      history.push({ attempt: 1, ms: stall, kind: "timeout", error: err.message });
      return {
        ok: false,
        error: err,
        attempts: 1,
        kind: "timeout",
        timedOut: true,
        injected: true,
        history,
        retriesExhausted: false,
      };
    }
    const err = new Error(msg);
    history.push({ attempt: 1, ms: 0, kind: "error", error: err.message });
    return {
      ok: false,
      error: err,
      attempts: 1,
      kind: "error",
      timedOut: false,
      injected: true,
      history,
      retriesExhausted: false,
    };
  }

  /* --------------------------------- attempts ---------------------------------- */
  const maxAttempts = eff.maxRetries + 1;
  let lastError: Error | undefined;
  let lastKind: "error" | "timeout" = "error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = hooks.now ? hooks.now() : Date.now();
    try {
      if (attempt > 1) {
        hooks.log(
          "info",
          `↻ Retry ${attempt - 1}/${eff.maxRetries} for this node…`
        );
      }
      const value = await withTimeout(run, eff.timeoutMs, hooks.signal);
      return {
        ok: true,
        value,
        attempts: attempt,
        timedOut: false,
        injected: false,
        history,
        retriesExhausted: false,
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const kind: "error" | "timeout" = isTimeoutError(e) ? "timeout" : "error";
      const ended = hooks.now ? hooks.now() : Date.now();
      lastError = e;
      lastKind = kind;

      const shouldRetry =
        attempt < maxAttempts &&
        (eff.retryOn === "always" ||
          (eff.retryOn === "timeout" && kind === "timeout") ||
          (eff.retryOn === "error" && kind === "error"));

      if (!shouldRetry) {
        history.push({ attempt, ms: ended - started, kind, error: e.message });
        break;
      }

      // exponential backoff, capped
      const backoff = Math.min(
        eff.backoffMs * Math.pow(2, attempt - 1),
        MAX_BACKOFF_MS
      );
      history.push({
        attempt,
        ms: ended - started,
        kind,
        error: e.message,
        backoffMs: backoff,
      });
      hooks.log(
        "warn",
        `Attempt ${attempt} failed (${kind}): ${e.message} — retrying in ${backoff}ms`
      );
      try {
        await sleep(backoff, hooks.signal);
      } catch {
        break;
      }
    }
  }

  return {
    ok: false,
    error: lastError,
    attempts: history.length || 1,
    kind: lastKind,
    timedOut: lastKind === "timeout",
    injected: false,
    history,
    retriesExhausted: history.length >= maxAttempts && maxAttempts > 1,
  };
}

/* ---------------------------------- utils ---------------------------------- */

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function toInt(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : dflt;
}
