# FlowForge — Architecture

This document explains how FlowForge works under the hood: the single-registry design, the
execution engine, branch routing, the expression VM, the state model, and persistence.

---

## 1. The single source of truth

Everything orbits one file: [`src/lib/nodeRegistry.ts`](./src/lib/nodeRegistry.ts). It exports
an array of `NodeTypeDef` objects — one per node type. Each definition is fully declarative:

```ts
interface NodeTypeDef {
  type: string;              // engine dispatch key, e.g. "logic.if"
  category: NodeCategory;    // trigger | action | logic | data | ai
  label: string;
  description: string;
  icon: string;              // lucide icon name
  inputs: number;            // input handle count (triggers = 0)
  outputs: { id: string; label: string }[];  // output handles
  fields: FieldSchema[];     // the Inspector form
  defaults: Record<string, unknown>;
}
```

From this one array we derive:

| Consumer | What it reads |
| --- | --- |
| **NodePalette** | label, description, icon, category → searchable/draggable list |
| **Inspector** | `fields` → a typed config form (text, number, select, boolean, textarea, json, code, keyvalue) with conditional `showIf` |
| **Canvas / FlowNode** | icon, category color, output handles |
| **graph.ts** | `inputs`/triggers → validation |
| **CommandPalette** | label/description → deep-linkable node insertion |
| **validation.ts** | `fields` → `required` / `format` / `min` / `max` enforcement |
| **engine/executors** | `type` → execution dispatch |
| **conformance.ts** | the whole definition → 4 contract layers of self-tests |

Adding a node = append one object here + add one executor. No other file needs editing for the
UI, validation, palette, or command palette to pick it up.

---

## 2. Data model

```ts
FlowNode  = { id, type: "flowNode", position, data: { type, label, config, policy? } }
FlowEdge  = { id, source, target, sourceHandle?, targetHandle? }
Workflow  = { id, name, nodes, edges, createdAt?, updatedAt? }
```

`data.type` is the registry key (e.g. `logic.if`). `sourceHandle` identifies which output a
branch node fired from (`"true"`, `"false"`, `"case1"`, `"approved"`/`"rejected"`, `"each"` on
the Batch Split node, or the default `"out"`). `data.policy` is the optional per-node
reliability policy (see §4a).

---

## 3. Graph analysis (`graph.ts`)

`analyzeGraph(nodes, edges)` returns a `GraphAnalysis`:

- **adjacency / incoming** maps,
- **triggers** (nodes with `inputs === 0`),
- **hasCycle** — detected with **Kahn's algorithm**: repeatedly remove zero-in-degree nodes; if
  any remain, there's a cycle,
- **order** — a topological ordering,
- **issues** — error/warning list (empty graph, no trigger, orphan nodes, cycle, …),
- **isValid** — true when there are no error-level issues.

`analyzeGraph` also merges in **registry-driven configuration validation** from
`validation.ts`: every node's fields are checked against their declared `required`, `format`
(`email`/`url`/`cron`/`filename`/`json`/`positiveNumber`/`port`), and `min`/`max` bounds, and a
node with failure injection ON raises a warning-level `INJECTED_FAILURE` issue. That keeps the
single-source-of-truth property — add a constraint in the registry and the editor's Validation
panel, the pre-run gate, and the engine's own validation all learn it.

The editor's **ValidationPanel** renders these issues live and lets you click one to select the
offending node. The engine refuses to run an invalid graph.

---

## 4. The execution engine (`engine.ts`)

`executeWorkflow(nodes, edges, meta, opts, events)` is a from-scratch DAG runner.

### Edge-value & edge-active model

Two structures drive the walk:

- `edgeValue: Map<edgeId, unknown>` — the data delivered along each edge.
- `edgeActive: Set<edgeId>` — which edges are "live".

### The walk

1. **Triggers** run first (when `startSet` is empty or includes them), emitting their payload
   onto all outgoing edges and marking those edges active.
2. Nodes are visited in topological order. A node runs when its incoming active edges have all
   delivered values. Its input is:
   - the single active input (passed through), or
   - a shallow merge of multiple active object inputs, or
   - for `logic.merge`, the **array** of active inputs.
3. The node's executor returns an `ExecResult { output, branch?, pass?, halt?, haltReason?,
   simulated?, deliveryMode? }`.
4. **Every execution is wrapped in the node's reliability policy** (`withPolicy`,
   `src/lib/policy.ts`): a hard timeout, bounded retries with exponential backoff, and optional
   continue-on-error. The outcome records how many attempts were made and whether the final
   failure was a timeout (see §4a).
5. Any failure is classified by the diagnosis engine (`src/lib/diagnostics.ts`) into a
   structured `Diagnosis` and attached to the node result (see §4b).

### Branch routing

- **`branch`** (If/Else, Switch, Approval): only the edge whose `sourceHandle` matches `branch`
  is activated. Edges on other handles stay inactive, so their entire downstream subtree is marked
  **skipped**.
- **`pass`** (Filter): when `false`, no downstream edge is activated → downstream skipped.
- **`halt`** (Approval): when `true`, the run pauses — a `pendingApproval` (node, label,
  request, `requestedAt`, payload snapshot) is recorded on the run, the run status becomes
  `"paused"`, and everything downstream is marked skipped until a decision arrives (§4c).

### Error containment & run status

If an executor throws (or times out), the node is marked `error` and its diagnosis is recorded.
Run status is then decided explicitly (`engine.ts`):

- any **non-tolerated** failure → `"error"`, and the failed node's downstream edges are **not**
  activated — the rest of the graph degrades gracefully instead of crashing the run;
- a failure **tolerated** via `continueOnError` → the outgoing edges *are* activated, carrying
  an **error carrier** (`{ …input, _error: { message, code } }`) so downstream nodes still
  execute and can react to the failure; when only tolerated failures occurred the run finishes
  `"partial"` (`toleratedCount` on the run);
- a run **halted at an Approval gate** → `"paused"`.

### Events

The engine emits:

```ts
onNodeStart(nodeId)
onNodeFinish(NodeRunResult)   // includes input, output, branch, attempts, diagnosis, logs, timing
onLog(LogEntry)               // secret values are redacted before a line is stored
onPaused(PendingApproval)     // fired when the run pauses at an approval gate
onDone(RunRecord)
```

- In the browser, `runLive` wires these to the Zustand store so nodes animate and the console
  streams in real time.
- On the server (`/api/run`, `/api/webhook/[id]`, `/api/runs/[id]/resume`), the same events are
  aggregated into a persisted `RunRecord` that carries `executor` (`"browser" | "server"`),
  `environment` facts, `skippedCount`, `toleratedCount`, `pendingApproval`, and `anySimulated`.

**One engine, two hosts** — identical semantics whether a run is live-previewed in the browser
or executed headless via the API. `RunOptions.secrets` resolves `{{secrets.NAME}}` references
into a copy of each node's config (server-side only), and `RunOptions.fetchImpl` lets the
conformance suite and benchmark lab execute network nodes hermetically with zero real traffic.

---

## 4a. The reliability policy (`policy.ts`)

`normalizePolicy` clamps every user-supplied value into safe bounds before execution:

| Field | Default | Bounds | Behaviour |
| --- | --- | --- | --- |
| `timeoutMs` | 15,000 | 1 – 120,000 | hard ceiling; the attempt is aborted with a `[timeout]` error and a `TIMEOUT` diagnosis |
| `maxRetries` | 0 | 0 – 5 | extra attempts after the first failure |
| `backoffMs` | 300 | 0 – 5,000 | base backoff, **doubled each attempt** (exponential), capped at 5,000 ms |
| `retryOn` | `"always"` | `always` / `error` / `timeout` | which failure kinds are worth retrying |
| `continueOnError` | `false` | boolean | tolerate the failure: run continues, status becomes `partial`, downstream receives `_error` |
| `injectFailure` | `"none"` | `none` / `error` / `timeout` | **Failure Injection** — force a deliberate failure (optional `injectMessage`) so failure paths can be demoed and tested |

`withPolicy` never throws — it returns a `PolicyOutcome` with `ok`, the value or final error,
the total `attempts`, whether the failure was a timeout or injected, and the per-attempt
`history` that feeds the run console. Injection is ALWAYS visibly logged as a 🧪 warning, and
the conformance suite asserts the clamping bounds hold.

---

## 4b. Root-cause diagnostics (`diagnostics.ts`)

`diagnose(error, nodeType, hasInput)` classifies any thrown error into a `Diagnosis`:
`code`, `title`, `cause`, `fix`, `severity`, `retryable`, and the failing `nodeType`.
**14 codes** (`DIAGNOSIS_CODES`): `TIMEOUT`, `NETWORK`, `HTTP_STATUS`, `AUTH`, `RATE_LIMIT`,
`INVALID_URL`, `VALIDATION`, `CODE_SYNTAX`, `CODE_RUNTIME`, `EXPRESSION`, `FILE_WRITE`,
`MISSING_INPUT`, `INJECTED`, `UNKNOWN`.

Classification order:

1. an explicit `"Category:"` message prefix from an executor (e.g.
   `throw new Error("Auth: no API key")`) is **authoritative** — the thrower knows best;
2. otherwise ordered regex signatures, most-specific first;
3. a node that received no input at all is refined to `MISSING_INPUT`;
4. anything unmatched is `UNKNOWN` — honest "read the raw error" guidance instead of a guess.

---

## 4c. Approvals & resume (`action.approval`)

First pass, the Approval executor returns `halt: true` with the resolved request message. The
engine records a `pendingApproval` on the run, marks the run `"paused"`, fires `onPaused`, and
skips everything downstream. The paused run is never mutated — it stays intact as the audit
record.

`POST /api/runs/[id]/resume` with `{ "decision": "approved" | "rejected", "note"?, "by"? }`:

1. validates the decision and that the run is actually paused and undecided (400/404/409
   otherwise),
2. re-executes the workflow **from the approval node** via `fromNodeId` + `initialInput`
   containing `_approval: { decision, note, by, decidedAt }`,
3. the executor routes to the `approved` or `rejected` output handle,
4. the earlier results are stitched back in (a prior real result wins over a fresh
   "skipped outside the subtree" placeholder), logs are concatenated, counters recomputed, and
   `resumedFromRunId` / `resumedByRunId` link the two records.

---

## 5. The executors (`executors.ts`)

A map `executors: Record<string, Executor>` keyed by node `type`. Each executor receives an
`ExecContext { input, node, log, signal?, secretNames?, env?, fetchImpl? }` and returns an
`ExecResult`. Highlights:

- `action.http` performs a **real** `fetch` (or the injected `fetchImpl`) with templated
  URL/method/headers/body and parses the response.
- `action.email` validates the recipient first, then picks a transport: **resend** (live POST
  with the node's API key or `RESEND_API_KEY`), **gateway** (live POST of
  `{from,to,subject,text}` to `gatewayUrl` or `MAIL_GATEWAY_URL`), or **mock**. Mock logs an
  explicit `SIMULATED email (mock mode)` warning and returns
  `delivered: false, simulated: true, deliveryMode: "mock"`. Auto mode picks live only when a
  credential exists — a simulated side effect is never presented as a real delivery.
- `action.approval` returns `halt: true` on the first pass and routes to `approved`/`rejected`
  once `_approval.decision` is present on the input (§4c).
- `action.writeFile` writes under `/data/outputs` server-side (safe no-op preview in browser).
- `logic.loop` (**Batch Split**) slices the array at `arrayPath` down to `maxIterations` items
  and returns the batch as its output in a single pass.
- `data.code` runs user JavaScript in a constrained function scope with only `input` available.
- `ai.generate` calls OpenAI when `OPENAI_API_KEY` is present, else a deterministic offline
  implementation (word-frequency keywords, sentiment lexicon, extractive summary).

---

## 6. The expression VM (`expression.ts`)

`{{ ... }}` tokens are resolved against the node's incoming data:

- dot-paths and array indexes: `{{data.user.email}}`, `{{items.0.id}}`,
- `{{json}}` → the whole payload,
- a comparison layer for conditions: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`,
  `truthy`, `empty`.

Resolution is pure and side-effect-free; unknown paths resolve to empty rather than throwing.

---

## 7. Editor state (`store/editorStore.ts`)

A Zustand store holds `nodes`, `edges`, selection, run status, live logs, and last run. Key
design points:

- **History stack** — structural edits push onto a bounded (50-entry) undo/redo stack.
- **Serialization** — `getWorkflow()` emits React Flow nodes as `{ type: "flowNode", … }`.
- **Live run plumbing** — `setNodeStatus`, `applyRunResult`, `appendLog` (bounded to 500),
  `setLastRun`, `clearLogs`.
- **Deep-linking** — `addNodeOfType(type, pos)` powers both the palette and `/editor?add=<type>`.
- **Clipboard & bulk ops** — `copyNode` / `cutNode` / `pasteClipboard` use an in-session clipboard
  (pasted nodes get fresh ids + offset); `applyLayout` and `restoreGraph` are history-aware so
  every bulk change is undoable.

---

## 7a. Auto-layout (`lib/layout.ts`)

`autoLayoutNodes(nodes, edges)` is a from-scratch layered ("Sugiyama-lite") DAG layout:

1. **Layering** — each node's layer is its longest-path depth from any root (computed in one pass
   over the topological order).
2. **Ordering** — within each layer, nodes are sorted by the **barycenter** (mean index) of their
   parents in the previous layer to reduce edge crossings.
3. **Placement** — layers flow left → right; each column is vertically centered.

Cyclic graphs (no valid topo order) fall back to a balanced grid. The result is a new node array
with updated `position`; edges are untouched. Triggered by `Ctrl+L`, the toolbar, or the palette.

---

## 7b. Version snapshots (`lib/snapshots.ts`)

Local, offline version history stored per-workflow in `localStorage` (`flowforge:snapshots:<id>`,
max 25). `saveSnapshot` captures a deep copy of the current `Workflow`; `restoreGraph` loads one
back into the store (undoable). The `SnapshotPanel` drawer lists, restores, and deletes them, and
listens for a `flowforge:snapshots-updated` event to stay in sync. Complements — doesn't replace —
the server-side file save.

---

## 7c. Partial execution ("Run from here")

`executeWorkflow` accepts `opts.fromNodeId`. When set, it computes the **downstream-reachable
set** via DFS from that node, seeds the chosen node directly with `initialInput` (as if it were a
trigger), and marks every node outside the reachable set `skipped`. Status counting is unaffected,
so partial runs report accurately. Invoked from the Inspector's "Run from here" action.

---

## 8. Persistence (`lib/server/store.ts`)

Durable, self-describing storage. The backend is **discovered at runtime by probing**, in this
order:

1. **Remote KV** (Upstash / Vercel KV REST — `KV_REST_API_URL`+`KV_REST_API_TOKEN` or
   `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN`, proven with a `ping`) → durable across
   redeploys and shared across instances.
2. **`<project>/data`** if a real write probe succeeds → durable on a VM/container.
3. **`<os.tmpdir()>/flowforge-data`** → ephemeral, per-instance; seeded once from the bundled
   demo data so a fresh deploy opens with content.
4. **In-process memory** → last resort, so the product degrades instead of crashing.

Every mode is fully functional for create / save / run / delete; only durability differs. The
probe result is cached and exposed honestly:

- `storageInfo()` → `{ backend, durable, label, root, reason }` where `reason` is a
  plain-English explanation that includes **why** a better backend was rejected (e.g. the exact
  filesystem error that demoted `data/` to the temp dir);
- `storageInfoSync()` → the resolved info, `null` before the first storage operation;
- `storageStats()` → workflow/run counts for the health surface;
- `GET /api/health` embeds the active backend, durability, label, and reason in its `runtime`
  block.

The public CRUD API is unchanged: `listWorkflows`, `getWorkflow`, `saveWorkflow`,
`deleteWorkflow`, `saveRun`, `listRuns`, `getRun`.

---

## 8a. Secrets (`secrets.ts`)

Secrets are environment variables named `FF_SECRET_<NAME>` and referenced in node config as
`{{secrets.NAME}}`. Before execution the engine deep-clones the node config and substitutes
every reference (`resolveSecretsDeep`), reporting which names resolved and which are missing.
Consequences:

- the stored workflow JSON, exports, and run input/output panels only ever contain the
  **placeholder**, never the value;
- every log line passes through `redact()` before it is stored, so a secret value that leaks
  into a message is replaced with `«redacted»`;
- `maskSecretRefs` lets a config preview show *that* a secret is used; `secretNames` and
  `findSecretRefs` power autocomplete and capability checks;
- in the browser there is no environment, so no secrets resolve — a node that needs one fails
  with an **AUTH** diagnosis (and a "missing secret" warning) instead of silently sending
  nothing.

---

## 8b. Node Conformance Suite (`conformance.ts`)

A self-test the platform runs against itself — fully offline and deterministic (network nodes
run against an injected fetch stub, `makeStubFetch`). Four layers of contract per node type:

1. **Registry contract** — label/description present, the icon actually exists in
   `src/components/ui/iconMap.ts` (`ICON_NAMES`), unique non-empty output handles, valid
   category, correct input arity.
2. **Schema contract** — the shipped defaults are format- and range-clean. A `required` field
   with no safe default is legitimate and reported, not failed.
3. **Executor contract** — an executor is registered; invoking it returns an `ExecResult` with
   an `output` property; it is deterministic for identical input (timestamps normalised); or it
   fails with a **classified** diagnosis rather than an anonymous crash.
4. **Behaviour contract** — hand-written assertion cases, **35 across the 21 node types**.

Plus platform-wide cross-checks: no duplicate type ids, every executor maps to a declared type,
every type has an executor, all **8** shipped templates structurally valid with resolvable edge
handles, and the policy clamping bounds enforced.

The one side-effecting node (`action.writeFile`) is **skipped deliberately** — executing it
would write a real file, and a health check must never mutate data. The skip is reported with
its reason, never hidden.

**Measured: 226 checks passed, 0 failed, 2 skipped, 100% score, across 21 node types in ~1.7 s.**

---

## 8c. Benchmark Lab (`benchmark.ts`)

Six deterministic offline workloads through the real engine, reported as **nearest-rank
percentiles** (p50/p95/p99, plus min/max/mean/stdDev/throughput): Linear chain (5 nodes),
Conditional routing (if + filter), Fan-out → merge (4 branches), Transform 1,000 records,
Batch split 10,000 items, and AI node (offline mock).

**Measured: p95 ≤ 2 ms on every workload; 0 failures.**

It also asserts **4 hard guarantees** that must hold on every run, not on average:

1. a node timeout is a hard ceiling — a 20 ms budget aborts a 2,000 ms node in ~20–25 ms
   (measured 21 ms) with a `TIMEOUT` diagnosis;
2. every node failure carries a structured root-cause diagnosis (non-`UNKNOWN`, with a
   suggested fix);
3. with continue-on-error, a failed node yields a `partial` run and downstream nodes still
   execute;
4. a simulated side effect is flagged as simulated on both the node and the run — never
   reported as a real delivery.

---

## 9. Rendering & performance notes

- **No barrel imports** of `lucide-react`; an explicit `Icon` registry keeps the bundle and dev
  compile small. `next.config.mjs` also uses `optimizePackageImports`.
- **3D is isolated** — all Three.js lives inside a single `dynamic(async () => …, { ssr: false })`
  import, wrapped in a React error boundary with a CSS fallback, so WebGL issues never break the
  page or SSR.
- **Smooth scroll** via Lenis on `window.__lenis`, disabled under `prefers-reduced-motion`.
- **Theming** — neutral design tokens (`bg`/`line`/`ink`) resolve through CSS variables set on
  `<html data-theme>`. `lib/theme.ts` persists the choice in `localStorage` and a pre-paint boot
  script (`THEME_BOOT_SCRIPT`, injected in `layout.tsx`) applies it before first render to avoid
  any flash. The React Flow canvas, controls, minimap, and dot grid all read the same variables.
