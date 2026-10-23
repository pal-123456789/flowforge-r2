/**
 * FlowForge core type system.
 * These types are shared across the editor, the execution engine, and the API.
 */

export type NodeCategory = "trigger" | "action" | "logic" | "data" | "ai";

/** A field in a node's configuration form. */
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "code"
  | "json"
  | "keyvalue";

export interface SelectOption {
  label: string;
  value: string;
}

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  default?: unknown;
  options?: SelectOption[];
  /** language hint for code fields */
  language?: "javascript" | "json";
  /** show this field only when another field has a given value */
  showIf?: { key: string; equals: unknown };
  rows?: number;
  /** validation: the field must be non-empty for the node to be considered valid */
  required?: boolean;
  /** validation: semantic format expected of the value */
  format?: "email" | "url" | "cron" | "filename" | "json" | "positiveNumber" | "port";
  /** validation: inclusive bounds for numeric fields */
  min?: number;
  max?: number;
}

/** Definition of a node *type* (the blueprint, not an instance). */
export interface NodeTypeDef {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  /** lucide-react icon name */
  icon: string;
  /** number of input handles (triggers = 0) */
  inputs: number;
  /** labelled output handles. Most nodes have one "out"; branch nodes have multiple. */
  outputs: { id: string; label: string }[];
  fields: FieldSchema[];
  /** default config applied on drop */
  defaults: Record<string, unknown>;
}

/* ------------------------------ Reliability ------------------------------- */

/** Chaos-engineering hook: force a node to fail so failure paths can be demoed. */
export type FailureInjection = "none" | "error" | "timeout";

/**
 * Per-node reliability policy. Applied by the engine around every execution:
 * timeout → retry (with exponential backoff) → continue-on-error.
 * `injectFailure` is the deliberate-failure switch used by Failure Injection mode.
 */
export interface NodePolicy {
  /** hard timeout for this node in ms (0 = inherit the engine default) */
  timeoutMs?: number;
  /** extra attempts after the first failure */
  maxRetries?: number;
  /** base backoff between retries in ms (grows exponentially) */
  backoffMs?: number;
  /** when a retry is worth attempting */
  retryOn?: "error" | "timeout" | "always";
  /** keep the run going even if this node ultimately fails */
  continueOnError?: boolean;
  /** force this node to fail — for testing and the failure-diagnosis demo */
  injectFailure?: FailureInjection;
  /** custom message shown when an injected failure fires */
  injectMessage?: string;
}

/* --------------------------------- Diagnosis ------------------------------ */

export type DiagnosisCode =
  | "MISSING_INPUT"
  | "INVALID_URL"
  | "NETWORK"
  | "TIMEOUT"
  | "HTTP_STATUS"
  | "AUTH"
  | "RATE_LIMIT"
  | "VALIDATION"
  | "EXPRESSION"
  | "CODE_SYNTAX"
  | "CODE_RUNTIME"
  | "FILE_WRITE"
  | "INJECTED"
  | "UNKNOWN";

/**
 * Structured root-cause analysis for a failed node. Every error surfaced by the
 * engine is classified into a code + human explanation + concrete fix.
 */
export interface Diagnosis {
  code: DiagnosisCode;
  title: string;
  cause: string;
  fix: string;
  severity: "error" | "warning";
  /** whether retrying this operation is likely to help */
  retryable: boolean;
  /** which node type produced it, for documentation deep-links */
  nodeType?: string;
}

/** A node instance on the canvas (persisted). */
export interface FlowNodeData {
  type: string;
  label: string;
  config: Record<string, unknown>;
  /** optional per-node reliability policy (timeout, retries, failure injection) */
  policy?: NodePolicy;
}

export interface FlowNode {
  id: string;
  type: "flowNode";
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  animated?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

/* ----------------------------- Execution types ---------------------------- */

export type NodeRunStatus =
  | "idle"
  | "waiting"
  | "running"
  | "success"
  | "error"
  | "skipped";

export interface NodeRunResult {
  nodeId: string;
  nodeType: string;
  label: string;
  status: NodeRunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  /** for branch nodes: which output handle was taken */
  takenBranch?: string;
  logs: LogEntry[];
  error?: string;
  /** how many execution attempts were made (1 = no retry needed) */
  attempts?: number;
  /** structured root-cause analysis, present when status === "error" */
  diagnosis?: Diagnosis;
  /** true when the node's side effect was simulated, not actually performed */
  simulated?: boolean;
  /** for side-effecting actions: how the effect was delivered */
  deliveryMode?: "live" | "mock" | "preview";
  /** the policy that was in force for this execution */
  policyUsed?: NodePolicy;
  /** true when the node failed but the run continued (continueOnError) */
  tolerated?: boolean;
}

/** A run paused at a human-in-the-loop Approval node. */
export interface PendingApproval {
  nodeId: string;
  nodeLabel: string;
  /** the message shown to the approver */
  request: string;
  requestedAt: number;
  /** the data snapshot waiting at the approval gate */
  payload?: unknown;
  decision?: "approved" | "rejected";
  decidedAt?: number;
  decidedBy?: string;
  note?: string;
}

export interface LogEntry {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  nodeId?: string;
}

export type RunStatus = "running" | "success" | "error" | "idle" | "paused" | "partial";

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  trigger: string;
  results: NodeRunResult[];
  logs: LogEntry[];
  nodeCount: number;
  successCount: number;
  errorCount: number;
  /** number of nodes that failed but were tolerated (continueOnError) */
  toleratedCount?: number;
  /** number of nodes that were skipped by branch routing */
  skippedCount?: number;
  /** set when the run halted at an Approval node awaiting a decision */
  pendingApproval?: PendingApproval;
  /** how the run was executed, for the honesty/observability story */
  executor?: "browser" | "server";
  /** environment facts captured at run time (keys present, storage mode, …) */
  environment?: Record<string, string | boolean>;
  /** true when any node's side effect was simulated rather than performed */
  anySimulated?: boolean;
  /** set on the run created when a paused run is resumed after approval */
  resumedFromRunId?: string;
  /** set on the paused run, pointing at the run that continued it */
  resumedByRunId?: string;
}
