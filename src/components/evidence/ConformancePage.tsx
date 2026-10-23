"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { runConformance, type ConformanceReport, type NodeReport } from "@/lib/conformance";
import type { NodeCategory } from "@/lib/types";
import { CATEGORY_HEX } from "@/lib/nodeRegistry";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import {
  ArrowLeft,
  Activity,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronRight,
  RefreshCw,
  Loader2,
} from "lucide-react";

const CATEGORIES: NodeCategory[] = ["trigger", "action", "logic", "data", "ai"];

export function ConformancePage() {
  const [report, setReport] = useState<ConformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await runConformance());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const toggle = (type: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const allOk = report?.ok ?? false;

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* top bar */}
      <div className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-dim transition-colors hover:bg-bg-panel hover:text-ink"
          >
            <ArrowLeft size={16} /> Home
          </Link>
          <div className="h-5 w-px bg-line" />
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-brand-soft">
              <ShieldCheck size={15} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                Node Conformance Suite
              </h1>
              <p className="font-mono text-[11px] text-ink-dim">
                the platform testing itself · offline & deterministic
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {report && (
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
                  allOk
                    ? "bg-ok/15 text-ok ring-1 ring-ok/40"
                    : "bg-err/15 text-err ring-1 ring-err/40"
                )}
              >
                {allOk ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {allOk ? "All checks passed" : `${report.failed} failing`}
              </span>
            )}
            <button
              onClick={run}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
            >
              {running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Re-run suite
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <div className="rounded-xl border border-err/40 bg-err/10 p-4 text-sm text-err">
            The suite could not run: {error}
          </div>
        )}

        {running && !report && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Loader2 size={28} className="animate-spin text-brand" />
            <p className="text-sm text-ink-soft">
              Executing the conformance suite across every node type…
            </p>
          </div>
        )}

        {report && (
          <>
            {/* score hero */}
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl border p-6",
                  allOk
                    ? "border-ok/40 bg-ok/[0.07]"
                    : "border-err/40 bg-err/[0.07]"
                )}
              >
                <div
                  className={cn(
                    "text-5xl font-bold tabular-nums",
                    allOk ? "text-ok" : "text-err"
                  )}
                >
                  {report.score.toFixed(1)}
                  <span className="text-2xl">%</span>
                </div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
                  conformance score
                </div>
                <div className="mt-3 font-mono text-[11px] text-ink-dim">
                  {report.durationMs} ms
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Node types" value={report.total} />
                <Metric label="Checks passed" value={report.passed} tone="ok" />
                <Metric label="Failed" value={report.failed} tone={report.failed ? "err" : "dim"} />
                <Metric
                  label="Skipped"
                  value={report.skipped}
                  tone={report.skipped ? "warn" : "dim"}
                  hint={report.skipped ? "by design" : undefined}
                />
              </div>
            </div>

            {/* per-category strip */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {CATEGORIES.map((cat) => {
                const rows = report.nodes.filter((n) => n.category === cat);
                const bad = rows.filter((n) => !n.ok).length;
                const hex = CATEGORY_HEX[cat];
                return (
                  <div
                    key={cat}
                    className="rounded-xl border border-line bg-bg-soft/60 p-3"
                    style={{ borderColor: `${hex}33` }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: hex }}
                      />
                      <span
                        className="text-[11px] font-bold uppercase tracking-wider"
                        style={{ color: hex }}
                      >
                        {cat}
                      </span>
                    </div>
                    <div className="mt-1.5 text-xl font-semibold tabular-nums">
                      {rows.length - bad}
                      <span className="text-sm text-ink-dim">/{rows.length}</span>
                    </div>
                    <div className="text-[10.5px] text-ink-dim">
                      {bad === 0 ? "all types pass" : `${bad} type(s) failing`}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* platform-wide checks */}
            <section className="mt-8">
              <SectionLabel icon={Activity} title="Platform-wide checks" />
              <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-bg-soft/60">
                {report.platform.map((c) => (
                  <div key={c.name} className="flex items-start gap-3 px-4 py-2.5">
                    <StatusIcon ok={c.ok} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-ink">
                        {c.name}
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] text-ink-dim">
                        {c.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* per-node reports */}
            <section className="mt-8">
              <div className="flex items-center justify-between">
                <SectionLabel icon={ShieldCheck} title="Node type reports" />
                <button
                  onClick={() =>
                    setExpanded(
                      expanded.size === report.nodes.length
                        ? new Set()
                        : new Set(report.nodes.map((n) => n.type))
                    )
                  }
                  className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
                >
                  {expanded.size === report.nodes.length
                    ? "Collapse all"
                    : "Expand all"}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {CATEGORIES.map((cat) => {
                  const rows = report.nodes.filter((n) => n.category === cat);
                  if (!rows.length) return null;
                  return (
                    <div key={cat}>
                      <div
                        className="mb-1.5 flex items-center gap-1.5 px-1 text-[10.5px] font-bold uppercase tracking-wider"
                        style={{ color: CATEGORY_HEX[cat] }}
                      >
                        {cat} · {rows.length} type(s)
                      </div>
                      {rows.map((n) => (
                        <NodeRow
                          key={n.type}
                          node={n}
                          open={expanded.has(n.type)}
                          onToggle={() => toggle(n.type)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function NodeRow({
  node,
  open,
  onToggle,
}: {
  node: NodeReport;
  open: boolean;
  onToggle: () => void;
}) {
  const hex = CATEGORY_HEX[node.category];
  return (
    <div
      className={cn(
        "rounded-xl border bg-bg-soft/60 transition-colors",
        node.ok ? "border-line" : "border-err/50"
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${hex}1f`, color: hex }}
        >
          <Icon name={node.type === "action.approval" ? "UserCheck" : "Box"} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink">
            {node.label}
          </div>
          <div className="font-mono text-[10.5px] text-ink-dim">{node.type}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
          <span className="text-ok">{node.passed}✓</span>
          {node.failed > 0 && <span className="text-err">{node.failed}✗</span>}
          {node.skipped > 0 && <span className="text-warn">{node.skipped}−</span>}
          <span className="text-ink-faint">{node.durationMs}ms</span>
        </div>
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-ink-dim transition-transform",
            open && "rotate-90"
          )}
        />
      </button>

      {open && (
        <div className="divide-y divide-line border-t border-line">
          {node.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2">
              <span className="mt-0.5 shrink-0">
                {c.skipped ? (
                  <MinusCircle size={13} className="text-warn" />
                ) : c.ok ? (
                  <CheckCircle2 size={13} className="text-ok" />
                ) : (
                  <XCircle size={13} className="text-err" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-[12px]",
                    c.ok ? "text-ink-soft" : "font-medium text-err"
                  )}
                >
                  {c.name}
                </div>
                <div className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-ink-dim">
                  {c.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "ink",
  hint,
}: {
  label: string;
  value: number;
  tone?: "ink" | "ok" | "err" | "warn" | "dim";
  hint?: string;
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "err"
        ? "text-err"
        : tone === "warn"
          ? "text-warn"
          : tone === "dim"
            ? "text-ink-dim"
            : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-bg-soft/60 p-4">
      <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
      <div className="text-[11px] text-ink-dim">{label}</div>
      {hint && <div className="text-[10px] text-warn">{hint}</div>}
    </div>
  );
}

function SectionLabel({
  icon: IconCmp,
  title,
}: {
  icon: typeof Activity;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <IconCmp size={14} className="text-ink-dim" />
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-soft">
        {title}
      </h2>
    </div>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
  ) : (
    <XCircle size={14} className="mt-0.5 shrink-0 text-err" />
  );
}
