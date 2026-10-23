import type {
  FlowNode,
  FlowEdge,
  NodeRunResult,
  RunRecord,
  LogEntry,
  PendingApproval,
} from "./types";
import { analyzeGraph } from "./graph";
import { runNode, type ExecResult } from "./executors";
import { getNodeDef } from "./nodeRegistry";
import { withPolicy, normalizePolicy } from "./policy";
import { diagnose } from "./diagnostics";
import { resolveSecretsDeep, redact, type SecretMap } from "./secrets";
import { nanoid } from "nanoid";

export interface EngineEvents {
  onNodeStart?: (nodeId: string) => void;
  onNodeFinish?: (result: NodeRunResult) => void;
  onLog?: (entry: LogEntry) => void;
  onDone?: (record: RunRecord) => void;
  /** fired when the run pauses at a human-in-the-loop gate */
  onPaused?: (pending: PendingApproval) => void;
}

export interface RunOptions {
  trigger?: string;
  initialInput?: unknown;
  /** only run from this trigger id (if multiple triggers exist) */
  startNodeId?: string;
  /**
   * Partial execution ("Run from here"): ignore triggers and begin at this
   * node, seeding it with `initialInput`, then propagate downstream normally.
   * Every node upstream of this one is reported as skipped.
   */
  fromNodeId?: string;
  signal?: AbortSignal;
  /** resolved secret values, injected into a *copy* of each node's config */
  secrets?: SecretMap;
  /** environment facts recorded on the run for the observability story */
  environment?: Record<string, string | boolean>;
  /** where this run is executing */
  executor?: "browser" | "server";
  /**
   * Injectable fetch for network nodes. Used by the conformance suite and the
   * benchmark lab so they run hermetically, with no real network traffic.
   */
  fetchImpl?: typeof fetch;
}

/** Build the data a downstream node sees when an upstream node is tolerated. */
function errorCarrier(input: unknown, message: string, code: string): unknown {
  const base: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { value: input };
  base._error = { message, code };
  return base;
}

/**
 * The FlowForge execution engine.
 *
 * Strategy: topologically process nodes. Each node receives the merged output
 * of its *active* incoming edges. Branch nodes (if/switch) mark only one output
 * handle active; filters can deactivate their output; loop nodes fan out items.
 * Nodes whose inputs are all inactive are skipped.
 *
 * Every node execution is wrapped in a reliability policy (timeout, bounded
 * retries with exponential backoff, optional continue-on-error) and every
 * failure is classified into a structured root-cause diagnosis.
 */
export async function executeWorkflow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  meta: { workflowId: string; workflowName: string },
  opts: RunOptions = {},
  events: EngineEvents = {}
): Promise<RunRecord> {
  const analysis = analyzeGraph(nodes, edges);
  const startedAt = Date.now();
  const results: NodeRunResult[] = [];
  const globalLogs: LogEntry[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const secrets: SecretMap = opts.secrets ?? {};

  const pushLog = (entry: LogEntry) => {
    globalLogs.push(entry);
    events.onLog?.(entry);
  };

  const record: RunRecord = {
    id: nanoid(10),
    workflowId: meta.workflowId,
    workflowName: meta.workflowName,
    status: "running",
    startedAt,
    trigger: opts.trigger || "manual",
    results,
    logs: globalLogs,
    nodeCount: nodes.length,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    toleratedCount: 0,
    anySimulated: false,
    executor: opts.executor ?? (typeof window === "undefined" ? "server" : "browser"),
    environment: opts.environment,
  };

  if (!analysis.isValid) {
    const errors = analysis.issues.filter((i) => i.level === "error");
    const msg = errors.map((i) => i.message).join("; ");
    pushLog({ ts: Date.now(), level: "error", message: `Validation failed: ${msg}` });
    record.status = "error";
    record.finishedAt = Date.now();
    record.durationMs = record.finishedAt - startedAt;
    record.errorCount = errors.length || 1;
    events.onDone?.(record);
    return record;
  }

  // Per-edge "active" output values. Key: edgeId -> value passed along it.
  const edgeValue = new Map<string, unknown>();
  const edgeActive = new Set<string>();

  const outEdges = analysis.adjacency;
  const inEdges = analysis.incoming;

  const triggers = analysis.triggers;
  const startSet = new Set(opts.startNodeId ? [opts.startNodeId] : triggers);

  // Partial execution ("Run from here"): compute the downstream reachable set
  let reachable: Set<string> | null = null;
  if (opts.fromNodeId && nodeMap.has(opts.fromNodeId)) {
    reachable = new Set<string>([opts.fromNodeId]);
    const stack = [opts.fromNodeId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of outEdges[cur] || []) {
        if (!reachable.has(e.target)) {
          reachable.add(e.target);
          stack.push(e.target);
        }
      }
    }
  }

  /** Record a node as skipped (branch not taken, upstream failed, or post-halt). */
  const markSkipped = (node: FlowNode, reason: string) => {
    const skipped: NodeRunResult = {
      nodeId: node.id,
      nodeType: node.data.type,
      label: node.data.label,
      status: "skipped",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      durationMs: 0,
      logs: [{ ts: Date.now(), level: "debug", message: reason, nodeId: node.id }],
    };
    results.push(skipped);
    record.skippedCount = (record.skippedCount ?? 0) + 1;
    events.onNodeFinish?.(skipped);
  };

  let halted = false;

  for (const nodeId of analysis.order) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const def = getNodeDef(node.data.type);
    if (!def) continue;

    // Once the run has paused at an approval gate, nothing downstream runs.
    if (halted) {
      markSkipped(node, "Run paused at an approval gate — not executed");
      continue;
    }

    // In partial-run mode, anything not reachable from the start node is skipped
    if (reachable && !reachable.has(nodeId)) {
      markSkipped(node, "Outside the selected partial-run subtree");
      continue;
    }

    const incoming = inEdges[nodeId] || [];
    const isTrigger = def.category === "trigger";
    const isPartialStart = reachable !== null && nodeId === opts.fromNodeId;

    // determine if this node should run
    let shouldRun = false;
    let input: unknown;

    if (isPartialStart) {
      shouldRun = true;
      input = opts.initialInput;
    } else if (isTrigger) {
      shouldRun = startSet.size === 0 || startSet.has(nodeId);
      input = opts.initialInput;
    } else {
      const activeIncoming = incoming.filter((e) => edgeActive.has(e.id));
      shouldRun = activeIncoming.length > 0;
      if (shouldRun) {
        if (def.type === "logic.merge") {
          input = activeIncoming.map((e) => edgeValue.get(e.id));
        } else if (activeIncoming.length === 1) {
          input = edgeValue.get(activeIncoming[0].id);
        } else {
          const merged: Record<string, unknown> = {};
          let nonObj: unknown;
          for (const e of activeIncoming) {
            const v = edgeValue.get(e.id);
            if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(merged, v);
            else nonObj = v;
          }
          input = Object.keys(merged).length ? merged : nonObj;
        }
      }
    }

    if (!shouldRun) {
      markSkipped(node, "No active incoming branch — skipped");
      continue;
    }

    // Resolve {{secrets.NAME}} into a *copy* of the config. The stored workflow
    // keeps only the placeholder, so credentials never enter the graph JSON,
    // the run input/output panels, or the exported file.
    const secretRefs = new Set<string>();
    let execNode = node;
    if (node.data.config && Object.keys(secrets).length >= 0) {
      const { value, resolved, missing } = resolveSecretsDeep(node.data.config, secrets);
      for (const r of resolved) secretRefs.add(r);
      if (missing.length) {
        // surface as a warning now; the node will fail with an AUTH diagnosis
        pushLog({
          ts: Date.now(),
          level: "warn",
          message: `Missing secret${missing.length > 1 ? "s" : ""}: ${missing.join(", ")} — referenced as {{secrets.*}} but not set in the environment`,
          nodeId,
        });
      }
      execNode = { ...node, data: { ...node.data, config: value } };
    }
    if (secretRefs.size) {
      pushLog({
        ts: Date.now(),
        level: "info",
        message: `🔐 Resolved ${secretRefs.size} secret reference${secretRefs.size > 1 ? "s" : ""} (${[...secretRefs].join(", ")}) — values are never logged`,
        nodeId,
      });
    }

    events.onNodeStart?.(nodeId);
    const nodeLogs: LogEntry[] = [];
    const log = (level: LogEntry["level"], message: string) => {
      const safe = redact(String(message), secrets);
      const entry = { ts: Date.now(), level, message: safe, nodeId };
      nodeLogs.push(entry);
      pushLog(entry);
    };

    const effPolicy = normalizePolicy(node.data.policy);
    const nStart = Date.now();
    let result: NodeRunResult;

    const outcome = await withPolicy<ExecResult>(
      node.data.policy,
      (signal) =>
        runNode({
          input,
          node: execNode,
          log,
          signal,
          secretNames: Object.keys(secrets),
          env: typeof process !== "undefined" ? process.env : undefined,
          fetchImpl: opts.fetchImpl,
        }),
      { log, signal: opts.signal }
    );

    if (outcome.ok && outcome.value) {
      const exec = outcome.value;
      const finishedAt = Date.now();
      const isHalt = exec.halt === true;
      result = {
        nodeId,
        nodeType: node.data.type,
        label: node.data.label,
        status: isHalt ? "waiting" : "success",
        startedAt: nStart,
        finishedAt,
        durationMs: finishedAt - nStart,
        input,
        output: exec.output,
        takenBranch: exec.branch,
        logs: nodeLogs,
        attempts: outcome.attempts,
        simulated: exec.simulated,
        deliveryMode: exec.deliveryMode,
        policyUsed: node.data.policy,
      };
      record.successCount++;
      if (exec.simulated) record.anySimulated = true;

      if (isHalt) {
        const pending: PendingApproval = {
          nodeId,
          nodeLabel: node.data.label,
          request: exec.haltReason || "Approval required to continue",
          requestedAt: Date.now(),
          payload: input,
        };
        record.pendingApproval = pending;
        halted = true;
        log("warn", `⏸  Run paused — awaiting human approval: ${pending.request}`);
        events.onPaused?.(pending);
      } else {
        // activate outgoing edges according to branch / pass semantics
        const outs = outEdges[nodeId] || [];
        const passed = exec.pass !== false;
        if (passed) {
          for (const e of outs) {
            const handle = e.sourceHandle || "out";
            const matchesBranch = exec.branch ? handle === exec.branch : true;
            if (matchesBranch) {
              edgeActive.add(e.id);
              edgeValue.set(e.id, exec.output);
            }
          }
        }
      }
    } else {
      const finishedAt = Date.now();
      const rawMessage =
        outcome.error?.message || String(outcome.error ?? "unknown error");
      const message = redact(rawMessage, secrets);
      const hasInput =
        input !== undefined &&
        input !== null &&
        !(typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input as object).length === 0);

      const diag = diagnose(message, node.data.type, hasInput);
      const tolerated = effPolicy.continueOnError;

      log("error", message);
      if (diag.code !== "UNKNOWN") {
        log("debug", `Diagnosis ${diag.code}: ${diag.cause}`);
      }
      if (outcome.attempts > 1) {
        log(
          "warn",
          `Retries exhausted after ${outcome.attempts} attempts` +
            (outcome.history[0]?.backoffMs !== undefined
              ? ` (backoff started at ${effPolicy.backoffMs}ms)`
              : "")
        );
      }
      if (tolerated) {
        log("warn", "continueOnError is set — the run will proceed past this failure");
      }

      result = {
        nodeId,
        nodeType: node.data.type,
        label: node.data.label,
        status: "error",
        startedAt: nStart,
        finishedAt,
        durationMs: finishedAt - nStart,
        input,
        logs: nodeLogs,
        error: message,
        attempts: outcome.attempts,
        diagnosis: diag,
        policyUsed: node.data.policy,
        tolerated,
      };
      record.errorCount++;
      if (tolerated) {
        record.toleratedCount = (record.toleratedCount ?? 0) + 1;
        // let downstream nodes run, carrying the failure in `_error`
        for (const e of outEdges[nodeId] || []) {
          edgeActive.add(e.id);
          edgeValue.set(e.id, errorCarrier(input, message, diag.code));
        }
      }
      // otherwise: do not activate downstream edges on a hard error
    }

    results.push(result);
    events.onNodeFinish?.(result);
  }

  record.finishedAt = Date.now();
  record.durationMs = record.finishedAt - startedAt;

  const hardErrors = record.errorCount - (record.toleratedCount ?? 0);
  if (halted) {
    record.status = "paused";
  } else if (hardErrors > 0) {
    record.status = "error";
  } else if ((record.toleratedCount ?? 0) > 0) {
    // ran to completion, but some steps failed and were tolerated
    record.status = "partial";
  } else {
    record.status = "success";
  }

  if (halted) {
    pushLog({
      ts: Date.now(),
      level: "warn",
      message: `Run paused at "${record.pendingApproval?.nodeLabel}" · ${record.successCount} ok · awaiting approval`,
    });
  } else {
    pushLog({
      ts: Date.now(),
      level: hardErrors > 0 ? "warn" : "info",
      message:
        `Run finished · ${record.successCount} ok · ${record.errorCount} error` +
        ((record.toleratedCount ?? 0) > 0 ? ` (${record.toleratedCount} tolerated)` : "") +
        ` · ${record.skippedCount ?? 0} skipped · ${record.durationMs}ms`,
    });
  }

  events.onDone?.(record);
  return record;
}
