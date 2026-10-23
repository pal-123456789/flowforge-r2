"use client";

import { useState } from "react";
import type { NodePolicy } from "@/lib/types";
import {
  normalizePolicy,
  describePolicy,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BACKOFF_MS,
  MAX_RETRIES,
} from "@/lib/policy";
import { TextInput, Select, Toggle } from "./fields";
import { FlaskConical, RotateCcw, ShieldCheck, ChevronDown } from "lucide-react";

/**
 * Per-node reliability policy editor.
 *
 * This is where "it usually works" becomes "it cannot hang production": a hard
 * timeout, bounded retries with exponential backoff, an opt-in
 * continue-on-error escape hatch, and Failure Injection for deliberately
 * exercising the failure path.
 */
export function PolicyEditor({
  policy,
  onChange,
}: {
  policy?: NodePolicy;
  onChange: (p: NodePolicy | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const eff = normalizePolicy(policy);
  const injecting = eff.injectFailure !== "none";
  const customized =
    eff.timeoutMs !== DEFAULT_TIMEOUT_MS ||
    eff.maxRetries > 0 ||
    eff.continueOnError ||
    injecting;

  const set = (patch: Partial<NodePolicy>) =>
    onChange({ ...(policy || {}), ...patch });

  return (
    <div
      className={`rounded-xl border ${
        injecting ? "border-warn/50 bg-warn/5" : "border-line bg-bg-panel/50"
      }`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        {injecting ? (
          <FlaskConical size={14} className="text-warn shrink-0" />
        ) : (
          <ShieldCheck size={14} className="text-ink-dim shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-ink-soft flex items-center gap-1.5">
            Reliability
            {customized && !injecting && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded bg-brand/15 text-brand-soft border border-brand/30">
                tuned
              </span>
            )}
            {injecting && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded bg-warn/20 text-warn border border-warn/40">
                injecting
              </span>
            )}
          </div>
          <div className="text-[10px] text-ink-dim truncate mt-0.5">
            {describePolicy(policy)}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`text-ink-dim shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-line/60 pt-3">
          {/* timeout */}
          <div>
            <label className="block text-[11px] font-medium text-ink-soft mb-1.5">
              Timeout (ms)
            </label>
            <TextInput
              value={String(eff.timeoutMs)}
              onChange={(v) => set({ timeoutMs: v === "" ? undefined : Number(v) })}
              placeholder={String(DEFAULT_TIMEOUT_MS)}
            />
            <div className="flex gap-1 mt-1.5">
              {[1_000, 5_000, 15_000, 30_000].map((ms) => (
                <button
                  key={ms}
                  onClick={() => set({ timeoutMs: ms })}
                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                    eff.timeoutMs === ms
                      ? "border-brand/50 bg-brand/15 text-brand-soft"
                      : "border-line bg-bg-soft text-ink-dim hover:text-ink-soft"
                  }`}
                >
                  {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-ink-dim mt-1 leading-snug">
              The run aborts this node when the budget is exceeded and attaches a TIMEOUT
              diagnosis. Max {120_000} ms.
            </div>
          </div>

          {/* retries */}
          <div>
            <label className="block text-[11px] font-medium text-ink-soft mb-1.5">
              Retries on failure ({eff.maxRetries}/{MAX_RETRIES})
            </label>
            <input
              type="range"
              min={0}
              max={MAX_RETRIES}
              value={eff.maxRetries}
              onChange={(e) => set({ maxRetries: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          </div>

          {eff.maxRetries > 0 && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-ink-soft mb-1.5">
                  Backoff base (ms)
                </label>
                <TextInput
                  value={String(eff.backoffMs)}
                  onChange={(v) =>
                    set({ backoffMs: v === "" ? undefined : Number(v) })
                  }
                  placeholder={String(DEFAULT_BACKOFF_MS)}
                />
                <div className="text-[10px] text-ink-dim mt-1">
                  Waits {eff.backoffMs}ms, then doubles each attempt (capped at 5s).
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-ink-soft mb-1.5">
                  Retry when
                </label>
                <Select
                  value={eff.retryOn}
                  onChange={(v) => set({ retryOn: v as NodePolicy["retryOn"] })}
                  options={[
                    { label: "Any failure", value: "always" },
                    { label: "Errors only", value: "error" },
                    { label: "Timeouts only", value: "timeout" },
                  ]}
                />
              </div>
            </>
          )}

          {/* continue on error */}
          <div className="flex items-start gap-2 pt-1">
            <Toggle
              value={eff.continueOnError}
              onChange={(v) => set({ continueOnError: v })}
            />
            <div className="flex-1">
              <div className="text-[11px] font-medium text-ink-soft">
                Continue on error
              </div>
              <div className="text-[10px] text-ink-dim leading-snug">
                Let the run proceed past this node&apos;s failure. The run is marked{" "}
                <span className="text-warn">partial</span> and downstream nodes receive
                the error in <code className="font-mono">_error</code>.
              </div>
            </div>
          </div>

          {/* failure injection */}
          <div className="pt-2 border-t border-line/60">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FlaskConical size={12} className="text-warn" />
              <span className="text-[11px] font-medium text-warn">
                Failure Injection
              </span>
            </div>
            <Select
              value={eff.injectFailure}
              onChange={(v) =>
                set({ injectFailure: v as NodePolicy["injectFailure"] })
              }
              options={[
                { label: "Off — run normally", value: "none" },
                { label: "Force an error", value: "error" },
                { label: "Force a timeout", value: "timeout" },
              ]}
            />
            {injecting && (
              <>
                <textarea
                  value={eff.injectMessage || ""}
                  onChange={(e) => set({ injectMessage: e.target.value })}
                  rows={2}
                  placeholder="Optional message shown in the run log"
                  className="mt-2 w-full bg-bg-soft border border-warn/40 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-warn resize-y"
                />
                <div className="text-[10px] text-warn/90 mt-1 leading-snug">
                  This node will fail by design so the failure path can be demonstrated
                  and tested. Turn it off before a real run.
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => onChange(undefined)}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-bg-soft border border-line text-[11px] text-ink-dim hover:text-ink-soft transition-colors"
          >
            <RotateCcw size={12} /> Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
