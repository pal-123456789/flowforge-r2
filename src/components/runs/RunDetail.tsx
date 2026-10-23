"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  RunRecord,
  NodeRunResult,
  PendingApproval,
  Diagnosis,
} from "@/lib/types";
import { NODE_MAP, CATEGORY_HEX } from "@/lib/nodeRegistry";
import { fmtDuration, fmtTime, fmtRelative, cn } from "@/lib/utils";
import { JsonView } from "@/components/ui/JsonView";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";
import { FullscreenLoader } from "@/components/ui/Loader3D";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  Clock,
  Play,
  Pencil,
  Activity,
  AlertTriangle,
  Terminal,
  Gauge,
  Hash,
  Download,
  Check,
  X,
  RefreshCw,
  ShieldCheck,
  FlaskConical,
} from "lucide-react";

const STATUS_META: Record<
  string,
  { color: string; icon: typeof CheckCircle2; label: string }
> = {
  success: { color: "#22c55e", icon: CheckCircle2, label: "Success" },
  error: { color: "#ef4444", icon: XCircle, label: "Error" },
  skipped: { color: "#6b7291", icon: MinusCircle, label: "Skipped" },
  running: { color: "#7c5cff", icon: Loader2, label: "Running" },
  idle: { color: "#6b7291", icon: MinusCircle, label: "Idle" },
  waiting: { color: "#f59e0b", icon: Clock, label: "Waiting" },
  paused: { color: "#f59e0b", icon: Clock, label: "Paused for approval" },
  partial: { color: "#f59e0b", icon: AlertTriangle, label: "Partial" },
};

export function RunDetail({ runId }: { runId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const { run } = await res.json();
        setRun(run);
        const firstReal =
          run.results.find((r: NodeRunResult) => r.status !== "skipped") ||
          run.results[0];
        setSelected(firstReal?.nodeId || null);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [runId]);

  const selectedResult = useMemo(
    () => run?.results.find((r) => r.nodeId === selected) || null,
    [run, selected]
  );

  // timeline geometry
  const timeline = useMemo(() => {
    if (!run) return null;
    const start = run.startedAt;
    const end = run.finishedAt || Date.now();
    const span = Math.max(end - start, 1);
    return { start, span };
  }, [run]);

  const rerun = async () => {
    if (!run) return;
    setRerunning(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: run.workflowId, trigger: "rerun" }),
      });
      if (res.ok) {
        const { run: fresh } = await res.json();
        toast("success", "Re-run complete", `${fresh.successCount} nodes ok`);
        router.push(`/runs/${fresh.id}`);
      } else {
        toast("error", "Could not re-run", "Workflow may have been deleted");
        setRerunning(false);
      }
    } catch {
      toast("error", "Could not re-run");
      setRerunning(false);
    }
  };

  const exportRun = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify(run, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.workflowName.replace(/\s+/g, "-").toLowerCase()}.run.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("success", "Run exported", "Saved run record as JSON");
  };

  if (loading) return <FullscreenLoader label="Loading run" />;

  if (notFound || !run) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg text-ink">
        <AlertTriangle size={40} className="text-warn opacity-70" />
        <h1 className="text-xl font-semibold">Run not found</h1>
        <p className="max-w-sm text-center text-sm text-ink-dim">
          This run record may have expired or been cleared. On serverless hosts,
          run history is per-session.
        </p>
        <Link
          href="/runs"
          className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft"
        >
          Back to run history
        </Link>
      </div>
    );
  }

  const sm = STATUS_META[run.status] || STATUS_META.idle;
  const realResults = run.results;

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* top bar */}
      <div className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <Link
            href="/runs"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-dim transition-colors hover:bg-bg-panel hover:text-ink"
          >
            <ArrowLeft size={16} /> Runs
          </Link>
          <div className="h-5 w-px bg-line" />
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: `${sm.color}22`, color: sm.color }}
            >
              <sm.icon size={15} className={run.status === "running" ? "animate-spin" : ""} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {run.workflowName}
              </h1>
              <p className="font-mono text-[11px] text-ink-dim">
                run {run.id} · {fmtRelative(new Date(run.startedAt).toISOString())}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={exportRun}
              title="Export this run as JSON"
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition-colors hover:border-brand/50 hover:text-ink"
            >
              <Download size={14} /> Export
            </button>
            <Link
              href={`/editor/${run.workflowId}`}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition-colors hover:border-brand/50 hover:text-ink"
            >
              <Pencil size={14} /> Open editor
            </Link>
            <button
              onClick={rerun}
              disabled={rerunning}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:opacity-60"
            >
              {rerunning ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Re-run
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* stat strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={Gauge}
            label="Status"
            value={sm.label}
            color={sm.color}
          />
          <StatCard
            icon={Clock}
            label="Duration"
            value={fmtDuration(run.durationMs)}
          />
          <StatCard
            icon={CheckCircle2}
            label="Nodes ok"
            value={`${run.successCount}/${run.nodeCount}`}
          />
          <StatCard
            icon={Activity}
            label="Trigger"
            value={run.trigger}
          />
          <StatCard
            icon={run.anySimulated ? FlaskConical : CheckCircle2}
            label="Delivery"
            value={run.anySimulated ? "Simulated" : "Live"}
            color={run.anySimulated ? "#f59e0b" : "#22c55e"}
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* approval gate */}
          {run.status === "paused" && run.pendingApproval && (
            <div className="lg:col-span-2">
              <ApprovalPanel
                runId={run.id}
                pending={run.pendingApproval}
                onDecided={(newRunId) => {
                  toast("success", "Decision recorded", "Continuing to the resumed run");
                  router.push(`/runs/${newRunId}`);
                }}
              />
            </div>
          )}

          {/* timeline */}
          <section>
            <SectionLabel icon={Activity} title="Execution timeline" />
            <div className="mt-3 space-y-1.5 rounded-xl border border-line bg-bg-soft/60 p-3">
              {realResults.map((r) => (
                <TimelineRow
                  key={r.nodeId}
                  result={r}
                  timeline={timeline!}
                  active={selected === r.nodeId}
                  onClick={() => setSelected(r.nodeId)}
                />
              ))}
            </div>
          </section>

          {/* inspector */}
          <section>
            <SectionLabel icon={Terminal} title="Node inspector" />
            <div className="mt-3 rounded-xl border border-line bg-bg-soft/60 p-4">
              {selectedResult ? (
                <NodeInspector result={selectedResult} />
              ) : (
                <p className="py-8 text-center text-sm text-ink-dim">
                  Select a node from the timeline.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* full log stream */}
        <section className="mt-8">
          <SectionLabel icon={Terminal} title={`Log stream (${run.logs.length})`} />
          <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-line bg-bg-soft/60 p-3 font-mono text-[12px] leading-relaxed scrollbar-thin">
            {run.logs.length === 0 ? (
              <p className="py-6 text-center text-ink-dim">No log entries.</p>
            ) : (
              run.logs.map((l, i) => (
                <div key={i} className="flex gap-2.5 py-0.5">
                  <span className="shrink-0 text-ink-faint">{fmtTime(l.ts)}</span>
                  <span
                    className={cn(
                      "shrink-0 uppercase",
                      l.level === "error" && "text-err",
                      l.level === "warn" && "text-warn",
                      l.level === "info" && "text-ink-soft",
                      l.level === "debug" && "text-ink-dim"
                    )}
                  >
                    {l.level}
                  </span>
                  <span className="whitespace-pre-wrap break-all text-ink">
                    {l.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Human-in-the-loop gate. Appears only on a paused run and posts the decision
 * to /api/runs/<id>/resume, which re-executes from the approval node and
 * returns a new run containing the whole stitched timeline.
 */
function ApprovalPanel({
  runId,
  pending,
  onDecided,
}: {
  runId: string;
  pending: PendingApproval;
  onDecided: (newRunId: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "approved" | "rejected">(null);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(decision);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined, by: "operator" }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "resume failed");
      }
      onDecided(json.run.id);
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-warn/40 bg-warn/[0.07] p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warn/20 text-warn">
          <Clock size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">
              Approval required
            </h3>
            <span className="rounded-full border border-warn/40 bg-warn/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn">
              run paused
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">{pending.request}</p>
          <p className="mt-0.5 font-mono text-[11px] text-ink-dim">
            node {pending.nodeLabel} · requested{" "}
            {fmtRelative(new Date(pending.requestedAt).toISOString())}
          </p>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note recorded with the decision…"
            className="mt-3 w-full rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-warn/60 focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => decide("approved")}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-60"
            >
              {busy === "approved" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Approve & continue
            </button>
            <button
              onClick={() => decide("rejected")}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-err/50 bg-err/10 px-4 py-2 text-sm font-semibold text-err transition-colors hover:bg-err/20 disabled:opacity-60"
            >
              {busy === "rejected" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <X size={14} />
              )}
              Reject
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-dim">
            The workflow stops here — nothing downstream has executed. Approving
            re-runs from this node with your decision recorded on the audit trail.
          </p>
        </div>
      </div>
    </div>
  );
}

const DIAGNOSIS_HEX: Record<string, string> = {
  TIMEOUT: "#f59e0b",
  NETWORK: "#3b82f6",
  HTTP_STATUS: "#f59e0b",
  AUTH: "#ef4444",
  RATE_LIMIT: "#f59e0b",
  INVALID_URL: "#ef4444",
  VALIDATION: "#ef4444",
  CODE_SYNTAX: "#ec4899",
  CODE_RUNTIME: "#ec4899",
  EXPRESSION: "#ec4899",
  FILE_WRITE: "#ef4444",
  MISSING_INPUT: "#3b82f6",
  INJECTED: "#a855f7",
  UNKNOWN: "#6b7291",
};

/** Classified root cause instead of a raw stack trace. */
function DiagnosisCard({ d }: { d: Diagnosis }) {
  const hex = DIAGNOSIS_HEX[d.code] ?? "#6b7291";
  return (
    <div
      className="mt-3 rounded-xl border p-3"
      style={{ borderColor: `${hex}55`, background: `${hex}12` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white"
          style={{ background: hex }}
        >
          {d.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
          {d.title}
        </span>
        {d.retryable && (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-dim">
            retryable
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{d.cause}</p>
      <p className="mt-1.5 flex gap-1.5 text-[12px] leading-relaxed">
        <span className="shrink-0" style={{ color: hex }}>
          →
        </span>
        <span className="text-ink">{d.fix}</span>
      </p>
    </div>
  );
}

function StatCard({
  icon: IconC,
  label,
  value,
  color,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg-soft/60 p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
        <IconC size={13} /> {label}
      </div>
      <div
        className="mt-1.5 truncate text-lg font-semibold capitalize"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function SectionLabel({
  icon: IconC,
  title,
}: {
  icon: typeof Activity;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
      <IconC size={15} className="text-brand-soft" />
      {title}
    </div>
  );
}

function TimelineRow({
  result,
  timeline,
  active,
  onClick,
}: {
  result: NodeRunResult;
  timeline: { start: number; span: number };
  active: boolean;
  onClick: () => void;
}) {
  const def = NODE_MAP[result.nodeType];
  const sm = STATUS_META[result.status] || STATUS_META.idle;
  const offsetPct =
    result.status === "skipped"
      ? 0
      : ((result.startedAt - timeline.start) / timeline.span) * 100;
  const widthPct =
    result.status === "skipped"
      ? 0
      : Math.max(((result.durationMs || 0) / timeline.span) * 100, 1.5);

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
        active ? "bg-bg-panel" : "hover:bg-bg-panel/50"
      )}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{
          background: def ? `${CATEGORY_HEX[def.category]}1f` : "#2a2f45",
          color: def ? CATEGORY_HEX[def.category] : "#6b7291",
        }}
      >
        <Icon name={def?.icon || "Box"} size={12} />
      </span>
      <div className="w-28 shrink-0 truncate text-[12.5px] font-medium">
        {result.label}
      </div>
      <div className="relative h-5 flex-1 overflow-hidden rounded bg-bg-panel/60">
        {result.status === "skipped" ? (
          <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-ink-faint">
            skipped
          </span>
        ) : (
          <div
            className="absolute inset-y-0 rounded"
            style={{
              left: `${Math.min(offsetPct, 98)}%`,
              width: `${widthPct}%`,
              background: sm.color,
              opacity: 0.85,
            }}
          />
        )}
      </div>
      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-dim">
        {result.status === "skipped" ? "—" : fmtDuration(result.durationMs)}
      </span>
      <sm.icon
        size={14}
        className="shrink-0"
        style={{ color: sm.color }}
      />
    </button>
  );
}

function NodeInspector({ result }: { result: NodeRunResult }) {
  const def = NODE_MAP[result.nodeType];
  const sm = STATUS_META[result.status] || STATUS_META.idle;
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line pb-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{
            background: def ? `${CATEGORY_HEX[def.category]}1f` : "#2a2f45",
            color: def ? CATEGORY_HEX[def.category] : "#6b7291",
          }}
        >
          <Icon name={def?.icon || "Box"} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{result.label}</div>
          <div className="font-mono text-[11px] text-ink-dim">
            {result.nodeType}
          </div>
        </div>
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: `${sm.color}22`, color: sm.color }}
        >
          <sm.icon size={11} /> {sm.label}
        </span>
      </div>

      {result.takenBranch && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft">
          <Hash size={12} className="text-logic" />
          Branch taken:{" "}
          <code className="rounded bg-bg-panel px-1.5 py-0.5 text-logic">
            {result.takenBranch}
          </code>
        </div>
      )}

      {result.diagnosis && <DiagnosisCard d={result.diagnosis} />}

      {result.error && !result.diagnosis && (
        <div className="mt-3 rounded-lg border border-err/30 bg-err/10 px-3 py-2 text-xs text-err">
          <div className="mb-0.5 flex items-center gap-1 font-semibold">
            <XCircle size={12} /> Error
          </div>
          {result.error}
        </div>
      )}

      {result.attempts !== undefined && result.attempts > 1 && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <RefreshCw size={12} />
          Retried — {result.attempts} attempts before this outcome
        </div>
      )}

      {result.tolerated && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-xs text-brand-soft">
          <ShieldCheck size={12} />
          Failure tolerated (continue-on-error) — the run proceeded past this node
        </div>
      )}

      {result.simulated && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs font-medium text-warn">
          <FlaskConical size={12} />
          SIMULATED — no real side effect was performed
          {result.deliveryMode && (
            <span className="font-mono text-ink-dim">({result.deliveryMode})</span>
          )}
        </div>
      )}

      {result.status !== "skipped" && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              Input
            </div>
            {result.input === undefined ? (
              <p className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-xs text-ink-faint">
                No input
              </p>
            ) : (
              <JsonView data={result.input} />
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              Output
            </div>
            {result.output === undefined ? (
              <p className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-xs text-ink-faint">
                No output
              </p>
            ) : (
              <JsonView data={result.output} />
            )}
          </div>
        </div>
      )}

      {result.logs.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
            Node logs ({result.logs.length})
          </div>
          <div className="space-y-0.5 rounded-lg border border-line bg-bg-soft p-2 font-mono text-[11px]">
            {result.logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-ink-faint">{fmtTime(l.ts)}</span>
                <span className="whitespace-pre-wrap break-all text-ink-soft">
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
