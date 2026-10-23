import { NextRequest, NextResponse } from "next/server";
import { executeWorkflow } from "@/lib/engine";
import { analyzeGraph } from "@/lib/graph";
import { saveRun, getRun, getWorkflow } from "@/lib/server/store";
import { loadSecrets } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * Resume a run that paused at an Approval node.
 *
 *   POST /api/runs/<runId>/resume
 *   { "decision": "approved" | "rejected", "note"?: string, "by"?: string }
 *
 * The paused run is left intact as an audit record (with the decision stamped
 * on it) and a NEW run is created that re-executes from the approval node with
 * the decision injected, then merges the earlier results back in so the
 * timeline reads as one continuous run.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision;
  const note = typeof body?.note === "string" ? body.note : undefined;
  const by = typeof body?.by === "string" ? body.by : undefined;

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const oldRun = await getRun(params.id);
  if (!oldRun) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (!oldRun.pendingApproval) {
    return NextResponse.json(
      { error: "this run is not paused at an approval gate" },
      { status: 409 }
    );
  }
  if (oldRun.pendingApproval.decision) {
    return NextResponse.json(
      {
        error: "this approval was already decided",
        decision: oldRun.pendingApproval.decision,
        resumedByRunId: oldRun.resumedByRunId ?? null,
      },
      { status: 409 }
    );
  }

  const wf = await getWorkflow(oldRun.workflowId);
  if (!wf) {
    return NextResponse.json(
      { error: "the workflow for this run no longer exists" },
      { status: 404 }
    );
  }

  const approvalNodeId = oldRun.pendingApproval.nodeId;
  const decidedAt = Date.now();

  /* ------------------------- execute the remainder ------------------------ */
  const record = await executeWorkflow(
    wf.nodes,
    wf.edges,
    { workflowId: wf.id, workflowName: wf.name },
    {
      trigger: `approval:${decision}`,
      fromNodeId: approvalNodeId,
      initialInput: {
        ...(oldRun.pendingApproval.payload ?? {}),
        _approval: { decision, note, by, decidedAt: new Date(decidedAt).toISOString() },
      },
      secrets: loadSecrets(),
      executor: "server",
    }
  );

  /* ------- stitch the earlier results back in for one coherent timeline ---- */
  // The resumed run reports upstream nodes as "skipped outside the subtree",
  // but they really did execute in the original run — so a prior real result
  // wins over a fresh placeholder, while a fresh real result always wins.
  const merged = new Map<string, typeof record.results[number]>();
  for (const prior of oldRun.results || []) {
    if (prior.nodeId !== approvalNodeId) merged.set(prior.nodeId, prior);
  }
  for (const fresh of record.results) {
    const prior = merged.get(fresh.nodeId);
    if (!prior || fresh.status !== "skipped" || prior.status === "skipped") {
      merged.set(fresh.nodeId, fresh);
    }
  }
  record.results = [...merged.values()];
  // present the stitched timeline in true execution order
  const { order } = analyzeGraph(wf.nodes, wf.edges);
  const rank = new Map(order.map((nodeId, i) => [nodeId, i]));
  record.results.sort(
    (a, b) => (rank.get(a.nodeId) ?? order.length) - (rank.get(b.nodeId) ?? order.length)
  );
  record.logs = [...(oldRun.logs || []), ...record.logs];
  record.startedAt = oldRun.startedAt;
  record.finishedAt = Date.now();
  record.durationMs = record.finishedAt - record.startedAt;
  record.resumedFromRunId = oldRun.id;

  // recompute counters from the merged timeline
  record.successCount = record.results.filter((r) => r.status === "success").length;
  record.errorCount = record.results.filter((r) => r.status === "error").length;
  record.toleratedCount = record.results.filter((r) => r.tolerated).length;
  record.skippedCount = record.results.filter((r) => r.status === "skipped").length;
  record.anySimulated =
    (oldRun.anySimulated ?? false) ||
    record.results.some((r) => r.simulated === true);

  const hadHardError = record.errorCount - (record.toleratedCount ?? 0) > 0;
  record.status = hadHardError ? "error" : record.status === "paused" ? "paused" : "success";

  /* --------------- stamp the decision onto the paused record -------------- */
  oldRun.pendingApproval = {
    ...oldRun.pendingApproval,
    decision,
    decidedAt,
    decidedBy: by,
    note,
  };
  oldRun.resumedByRunId = record.id;
  await Promise.all([saveRun(oldRun), saveRun(record)]).catch(() => {});

  return NextResponse.json({
    run: record,
    decidedAt,
    decision,
  });
}
