"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  runBenchmarks,
  type BenchmarkReport,
  type BenchmarkResult,
  type NodeTiming,
} from "@/lib/benchmark";
import { CATEGORY_HEX } from "@/lib/nodeRegistry";
import type { NodeCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Gauge,
  Timer,
  Zap,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  ShieldCheck,
} from "lucide-react";

const ITERATION_CHOICES = [10, 20, 50, 100];

export function BenchmarksPage() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [iterations, setIterations] = useState(20);

  const run = useCallback(async (n: number) => {
    setRunning(true);
    setError(null);
    try {
      setReport(await runBenchmarks({ iterations: n }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void run(iterations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxP95 = report
    ? Math.max(...report.results.map((r) => r.stats.p95), 0.001)
    : 1;
  const slowest = report
    ? report.results
        .flatMap((r) => r.perNode)
        .sort((a, b) => b.p95 - a.p95)
        .slice(0, 8)
    : [];
  const worstP95 = report
    ? Math.max(...report.results.map((r) => r.stats.p95))
    : 0;

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
              <Gauge size={15} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Benchmark Lab</h1>
              <p className="font-mono text-[11px] text-ink-dim">
                real latency through the real engine · percentiles, not averages
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              {ITERATION_CHOICES.map((n) => (
                <button
                  key={n}
                  disabled={running}
                  onClick={() => {
                    setIterations(n);
                    void run(n);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50",
                    iterations === n
                      ? "bg-brand/20 text-brand-soft"
                      : "text-ink-dim hover:text-ink-soft"
                  )}
                >
                  {n}×
                </button>
              ))}
            </div>
            <button
              onClick={() => void run(iterations)}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
            >
              {running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Run
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <div className="rounded-xl border border-err/40 bg-err/10 p-4 text-sm text-err">
            The benchmark could not run: {error}
          </div>
        )}

        {running && !report && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Loader2 size={28} className="animate-spin text-brand" />
            <p className="text-sm text-ink-soft">
              Executing workloads through the engine…
            </p>
          </div>
        )}

        {report && (
          <>
            {/* headline */}
            <div className="grid gap-4 md:grid-cols-4">
              <Headline
                icon={Zap}
                value={`${report.results.length}`}
                label="workloads"
                sub={`${report.iterations} iterations each`}
              />
              <Headline
                icon={Timer}
                value={`${fmt(worstP95)} ms`}
                label="worst p95"
                sub="across every workload"
                tone={worstP95 < 5 ? "ok" : "warn"}
              />
              <Headline
                icon={CheckCircle2}
                value={`${report.results.reduce((a, r) => a + r.failures, 0)}`}
                label="failed runs"
                sub="across all samples"
                tone={
                  report.results.reduce((a, r) => a + r.failures, 0) === 0
                    ? "ok"
                    : "err"
                }
              />
              <Headline
                icon={ShieldCheck}
                value={`${report.guarantees.filter((g) => g.passed).length}/${report.guarantees.length}`}
                label="guarantees held"
                sub={`${report.failedGuarantees} violated`}
                tone={report.failedGuarantees === 0 ? "ok" : "err"}
              />
            </div>

            {/* workload percentiles */}
            <section className="mt-8">
              <SectionTitle>Latency percentiles</SectionTitle>
              <div className="mt-3 space-y-3">
                {report.results.map((r) => (
                  <WorkloadCard key={r.id} r={r} maxP95={maxP95} />
                ))}
              </div>
            </section>

            {/* guarantees */}
            <section className="mt-8">
              <SectionTitle>Hard guarantees</SectionTitle>
              <p className="mt-1 text-[12px] text-ink-dim">
                Claims that must hold on every run — the difference between
                &ldquo;usually fast&rdquo; and &ldquo;cannot hang production&rdquo;.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {report.guarantees.map((g) => (
                  <div
                    key={g.id}
                    className={cn(
                      "rounded-xl border p-4",
                      g.passed
                        ? "border-ok/40 bg-ok/[0.06]"
                        : "border-err/50 bg-err/[0.08]"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {g.passed ? (
                        <CheckCircle2
                          size={18}
                          className="mt-0.5 shrink-0 text-ok"
                        />
                      ) : (
                        <XCircle size={18} className="mt-0.5 shrink-0 text-err" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "text-[12.5px] font-semibold leading-snug",
                            g.passed ? "text-ink" : "text-err"
                          )}
                        >
                          {g.claim}
                        </div>
                        <div className="mt-2 space-y-1 font-mono text-[11px]">
                          <div className="text-ink-soft">
                            <span className="text-ink-dim">observed: </span>
                            {g.observed}
                          </div>
                          <div className="text-ink-dim">
                            <span>budget: </span>
                            {g.budget}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              g.passed
                                ? "bg-ok/20 text-ok"
                                : "bg-err/20 text-err"
                            )}
                          >
                            {g.passed ? "held" : "violated"}
                          </span>
                          <span className="font-mono text-[10.5px] text-ink-faint">
                            measured {g.measuredMs} ms
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* slowest nodes */}
            {slowest.length > 0 && (
              <section className="mt-8">
                <SectionTitle>Slowest nodes (aggregated p95)</SectionTitle>
                <div className="mt-3 overflow-hidden rounded-xl border border-line bg-bg-soft/60">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-ink-dim">
                        <th className="px-4 py-2 font-semibold">Node</th>
                        <th className="px-4 py-2 font-semibold">Type</th>
                        <th className="px-4 py-2 text-right font-semibold">Calls</th>
                        <th className="px-4 py-2 text-right font-semibold">p50</th>
                        <th className="px-4 py-2 text-right font-semibold">p95</th>
                        <th className="px-4 py-2 text-right font-semibold">max</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {slowest.map((n, i) => (
                        <NodeTimingRow key={`${n.label}-${i}`} n={n} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p className="mt-8 font-mono text-[11px] text-ink-faint">
              executor {report.environment.executor} · runtime{" "}
              {report.environment.runtime} · {report.environment.nodeTypes} node
              types · generated {report.environment.generatedAt} · total{" "}
              {report.durationMs} ms
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function WorkloadCard({ r, maxP95 }: { r: BenchmarkResult; maxP95: number }) {
  const s = r.stats;
  const bars = [
    { key: "p50", value: s.p50, color: "#22c55e" },
    { key: "p95", value: s.p95, color: "#f59e0b" },
    { key: "p99", value: s.p99, color: "#ec4899" },
    { key: "max", value: s.max, color: "#ef4444" },
  ];
  return (
    <div className="rounded-xl border border-line bg-bg-soft/60 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold text-ink">{r.name}</h3>
        <span className="font-mono text-[10.5px] text-ink-dim">
          {r.nodes} nodes · {r.iterations} runs
        </span>
        {r.failures > 0 ? (
          <span className="rounded-full bg-err/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-err">
            {r.failures} failed
          </span>
        ) : (
          <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ok">
            stable
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-ink-dim">
          {s.throughputPerSec}/s · σ {fmt(s.stdDev)}ms
        </span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-ink-soft">
        {r.description}
      </p>

      <div className="mt-3 space-y-1.5">
        {bars.map((b) => (
          <div key={b.key} className="flex items-center gap-2">
            <span className="w-8 shrink-0 font-mono text-[10.5px] text-ink-dim">
              {b.key}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-panel">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max((b.value / maxP95) * 100, 0.6)}%`,
                  background: b.color,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">
              {fmt(b.value)} ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeTimingRow({ n }: { n: NodeTiming }) {
  const cat = (n.type.split(".")[0] || "action") as NodeCategory;
  const hex = CATEGORY_HEX[cat] ?? "#6b7291";
  return (
    <tr>
      <td className="px-4 py-2 text-ink">{n.label}</td>
      <td className="px-4 py-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} />
          {n.type}
        </span>
      </td>
      <td className="px-4 py-2 text-right font-mono text-ink-dim">{n.calls}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-soft">
        {fmt(n.p50)}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums text-warn">
        {fmt(n.p95)}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums text-err">
        {fmt(n.max)}
      </td>
    </tr>
  );
}

function Headline({
  icon: IconCmp,
  value,
  label,
  sub,
  tone = "ink",
}: {
  icon: typeof Gauge;
  value: string;
  label: string;
  sub: string;
  tone?: "ink" | "ok" | "warn" | "err";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "err"
          ? "text-err"
          : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-bg-soft/60 p-4">
      <div className="flex items-center gap-2 text-ink-dim">
        <IconCmp size={14} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
      <div className="text-[11px] text-ink-dim">{sub}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-soft">
      {children}
    </h2>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
