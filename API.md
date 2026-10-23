# FlowForge — HTTP API reference

Every endpoint is a Next.js App Router route handler under `src/app/api`. All responses are
JSON. Routes that touch the store are marked `force-dynamic` so they always read fresh data.

Base URL (local): `http://localhost:3000`
Base URL (deployed): `https://flowforge-r2.vercel.app`

---

## Workflows

### `GET /api/workflows`
List every saved workflow, newest first.

**Response**
```json
{ "workflows": [ { "id": "...", "name": "...", "nodes": [...], "edges": [...], "createdAt": "...", "updatedAt": "..." } ] }
```

### `POST /api/workflows`
Create or update a workflow (upsert by `id`).

**Body:** a full `Workflow` object (`id` and `name` required).

**Response:** `{ "workflow": <saved workflow with updatedAt> }`
**Errors:** `400` if `id` or `name` is missing.

```bash
curl -X POST http://localhost:3000/api/workflows \
  -H 'Content-Type: application/json' \
  -d '{"id":"wf_demo","name":"My Flow","nodes":[],"edges":[]}'
```

### `GET /api/workflows/[id]`
Fetch a single workflow.

**Response:** `{ "workflow": <Workflow> }` · **Errors:** `404` if not found.

### `DELETE /api/workflows/[id]`
Delete a workflow. **Response:** `{ "ok": true }`.

### `POST /api/workflows/from-template`
Instantiate a built-in template as a new saved workflow.

**Body:** `{ "templateId": "welcome-email" }`
**Response:** `{ "workflow": <new Workflow> }` · **Errors:** `400` if `templateId` missing/unknown.

---

## Templates

### `GET /api/templates`
List built-in starter templates (metadata only).

**Response**
```json
{ "templates": [ { "id": "...", "name": "...", "description": "...", "tags": ["..."] } ] }
```

---

## Execution

### `POST /api/run`
Execute a workflow **server-side** and return the full run record.

**Body (one of):**
- Inline graph: `{ "nodes": [...], "edges": [...], "trigger": "api", "input": {...}, "startNodeId": "..." }`
- By id: `{ "workflowId": "wf_demo", "trigger": "api", "input": {...} }`

Inline runs (or `workflowId: "inline"`) are **not** persisted; runs by a real `workflowId` are
saved to run history. Secrets from the server environment (`FF_SECRET_*`) are resolved into
node configs at execution time, and the run's `executor` field is `"server"`. A run that
reaches an Approval node is persisted with status `"paused"` and a `pendingApproval`; continue
it via `POST /api/runs/[id]/resume`.

**Response:** `{ "run": <RunRecord> }`
**Errors:** `400` if no nodes, `404` if `workflowId` not found.

```bash
curl -X POST http://localhost:3000/api/run \
  -H 'Content-Type: application/json' \
  -d '{"workflowId":"wf_demo"}'
```

---

## Runs

### `GET /api/runs`
List run records, newest first (capped at 100). Optional `?workflowId=` filter.

**Response:** `{ "runs": [ <RunRecord>, ... ] }`

### `POST /api/runs`
Persist a run record produced by the **in-browser** live engine, so it appears in run history
and analytics. Inline/unsaved workflows are skipped.

**Body:** `{ "run": <RunRecord> }`
**Response:** `{ "ok": true, "persisted": true | false }` · **Errors:** `400` if `run` missing.

### `GET /api/runs/[id]`
Fetch a single run record (used by the `/runs/[id]` drill-down page).

**Response:** `{ "run": <RunRecord> }` · **Errors:** `404` if not found.

### `POST /api/runs/[id]/resume`
Resume a run that is paused at an Approval node.

**Body:** `{ "decision": "approved" | "rejected", "note"?: string, "by"?: string }`

The paused run is left intact as an audit record (with the decision, decider, note, and
`resumedByRunId` stamped on it) and a **new** run is created that re-executes from the approval
node with the decision injected, then merges the earlier results back in so the timeline reads
as one continuous run (`resumedFromRunId` links them).

**Response:** `{ "run": <merged RunRecord>, "decidedAt": number, "decision": "approved" | "rejected" }`
**Errors:** `400` if `decision` is not `approved`/`rejected` · `404` if the run or its workflow
no longer exists · `409` if the run is not paused at an approval gate or the approval was
already decided.

```bash
curl -X POST http://localhost:3000/api/runs/<runId>/resume \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approved","by":"ops@example.com"}'
```

---

## Health & benchmarks

### `GET /api/health`
Runs the full **Node Conformance Suite** against the live deployment and returns the report.
HTTP **200** when every check passes, **503** when any check fails — usable as a real
readiness probe.

**Query:** `?only=action.http,action.email` — restrict the suite to specific node types.

**Response** (abridged):
```json
{
  "total": 21, "passed": 226, "failed": 0, "skipped": 2, "score": 100, "ok": true,
  "durationMs": 1658,
  "nodes": [ { "type": "action.http", "label": "HTTP Request", "checks": [...], "ok": true } ],
  "platform": [ { "name": "platform: no duplicate node type ids", "ok": true, "detail": "..." } ],
  "runtime": {
    "node": "v24.14.1",
    "platform": "win32",
    "executor": "server",
    "secretsConfigured": 2,
    "storage": { "backend": "filesystem", "durable": true, "label": "Project data/", "reason": "..." },
    "counts": { "workflows": 8, "runs": 12 },
    "checkedInMs": 1690
  }
}
```

The 2 skipped checks are `action.writeFile`'s invocation checks — skipped **deliberately**
because executing it would write a real file to disk; a health check must never mutate data.

### `GET /api/benchmarks`
Runs the **Benchmark Lab** and returns per-workload percentile statistics plus the four
reliability guarantees.

**Query:** `?iterations=N` — samples per workload, 1–200, default 20.

**Response** (abridged):
```json
{
  "iterations": 20,
  "results": [ {
    "id": "linear-5", "name": "Linear chain (5 nodes)", "nodes": 5, "iterations": 20,
    "stats": { "p50": 0, "p95": 1, "p99": 1, "min": 0, "max": 1, "mean": 0.1, "stdDev": 0.31, "throughputPerSec": 10000 },
    "failures": 0
  } ],
  "guarantees": [ {
    "id": "timeout-enforced",
    "claim": "A node with a 20 ms budget cannot stall the run for 2,000 ms",
    "observed": "run aborted after 21 ms with diagnosis TIMEOUT",
    "passed": true
  } ],
  "failedGuarantees": 0,
  "ok": true
}
```

---

## Webhooks

### `POST /api/webhook/[id]` · `GET /api/webhook/[id]`
Public trigger endpoint for a saved workflow. On `POST`, the JSON body becomes the trigger
input; on `GET`, the query string is used. The workflow runs server-side and the run is
persisted.

**Optional signing** — when `FF_WEBHOOK_SECRET` (or `WEBHOOK_SECRET`) is set, POST requests
must carry `x-flowforge-signature: sha256=<hex>` over the **raw** body (`x-hub-signature-256`
and `x-signature-256` are accepted as aliases). A missing or bad signature is a **401**, as is
a stale `x-flowforge-timestamp` (older than 300 seconds). Without a secret the endpoint still
works, but every response reports `"authMode": "unsigned"`.

**Response**
```json
{
  "ok": true,
  "authMode": "unsigned",
  "runId": "run_...",
  "status": "success",
  "durationMs": 42,
  "toleratedCount": 0,
  "anySimulated": false,
  "pendingApproval": null,
  "output": { }
}
```
`status` is the run status (`success`, `error`, `partial`, or `paused`); when a webhook pauses
at an Approval node, `pendingApproval` carries `{ nodeId, request }` and the run can be
continued via `POST /api/runs/[id]/resume`.

**Errors:** `404` if the workflow does not exist · `400` if the body is not valid JSON ·
`401` when signing is enforced and the signature/timestamp check fails.

```bash
curl -X POST http://localhost:3000/api/webhook/wf_demo \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","name":"Ada"}'
```

---

## Core types (abridged)

```ts
interface Workflow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt?: string;
  updatedAt?: string;
}

interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  // "paused"  — halted at an Approval node (pendingApproval is set)
  // "partial" — completed, but some node failures were tolerated via continueOnError
  status: "success" | "error" | "running" | "idle" | "paused" | "partial";
  startedAt: number;        // epoch ms
  finishedAt?: number;
  durationMs: number;
  trigger: string;          // "manual" | "api" | "webhook" | "rerun" | "approval:approved" | ...
  results: NodeRunResult[];
  logs: LogEntry[];
  nodeCount: number;
  successCount: number;
  errorCount: number;
  toleratedCount?: number;   // failures the run continued past (continueOnError)
  skippedCount?: number;     // nodes skipped by branch routing / partial runs / pauses
  pendingApproval?: PendingApproval;  // set when status === "paused"
  executor?: "browser" | "server";
  environment?: Record<string, string | boolean>;
  anySimulated?: boolean;    // true when any node's side effect was simulated
  resumedFromRunId?: string; // set on the run created by an approval resume
  resumedByRunId?: string;   // set on the paused run, pointing at the continuation
}

interface PendingApproval {
  nodeId: string;
  nodeLabel: string;
  request: string;           // the message shown to the approver
  requestedAt: number;
  payload?: unknown;         // data snapshot waiting at the gate
  decision?: "approved" | "rejected";
  decidedAt?: number;
  decidedBy?: string;
  note?: string;
}

interface NodeRunResult {
  nodeId: string;
  nodeType: string;
  label: string;
  status: "idle" | "waiting" | "running" | "success" | "error" | "skipped";
  input?: unknown;
  output?: unknown;
  takenBranch?: string;
  error?: string;
  attempts?: number;         // execution attempts (1 = no retry needed)
  diagnosis?: Diagnosis;     // structured root cause, present on failure
  simulated?: boolean;       // side effect was simulated, not performed
  deliveryMode?: "live" | "mock" | "preview";
  policyUsed?: NodePolicy;   // the reliability policy in force for this execution
  tolerated?: boolean;       // failed but the run continued (continueOnError)
  startedAt: number;
  durationMs: number;
  logs: LogEntry[];
}

interface Diagnosis {
  code:                      // 14 codes — see src/lib/diagnostics.ts
    | "TIMEOUT" | "NETWORK" | "HTTP_STATUS" | "AUTH" | "RATE_LIMIT"
    | "INVALID_URL" | "VALIDATION" | "CODE_SYNTAX" | "CODE_RUNTIME"
    | "EXPRESSION" | "FILE_WRITE" | "MISSING_INPUT" | "INJECTED" | "UNKNOWN";
  title: string;
  cause: string;
  fix: string;
  severity: "error" | "warning";
  retryable: boolean;
  nodeType?: string;
}

interface LogEntry {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;           // secret values are redacted before storage
}
```

See [`src/lib/types.ts`](./src/lib/types.ts) for the authoritative definitions.
