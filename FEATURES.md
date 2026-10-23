# FlowForge — Full feature inventory

An honest, exhaustive list of what's actually built. Nothing here is aspirational — every item
ships in the codebase and runs offline.

## 1. Visual editor

- Infinite, pannable, zoomable canvas (React Flow 11) with a dotted grid background.
- Fit-view, zoom controls, and a live **minimap** color-coded by node category.
- Custom node rendering per category (color, icon, labelled input/output handles).
- Animated smoothstep edges with arrowheads.
- Drag to connect nodes; invalid connections are rejected.
- Multi-handle branch nodes (If/Else True+False, Switch 3 cases + default, Approval
  Approved/Rejected, Batch Split "Batch").
- **Double-click quick-add** — double-click any empty canvas spot for a fuzzy, keyboard-driven
  node picker that drops the chosen node exactly at the cursor (type to filter, ↑/↓, Enter).

## 2. Node palette

- Live fuzzy search across label, description, and type.
- Collapsible category groups in a fixed order (trigger → action → logic → data → ai) with counts.
- **Drag-or-click** to add a node.
- **★ Favorites** — pin any node; persisted in `localStorage`; shown in a dedicated group.
- **Recent** — tracks the last 6 node types you added (from palette or canvas drop); persisted.
- Per-node star toggle on hover.

## 3. Inspector (config forms)

- Typed form fields generated from the node registry: `text`, `number`, `select`, `boolean`,
  `textarea`, `json`, `code`, `keyvalue`.
- Conditional fields via `showIf` (e.g. the "compare to" field only shows for certain operators).
- Inline help text and placeholders.
- Live two-way binding to the editor store.
- **Per-node reliability policy editor** — set a hard timeout (default 15 s, max 120 s), 0–5
  retries with exponential backoff (base 300 ms, cap 5 s), when to retry (`always`/`error`/
  `timeout`), continue-on-error, and deliberate failure injection (`error`/`timeout`) with an
  optional custom message. The effective policy is summarized on the inspector header.
- **Run from here** — execute the selected node and its entire downstream subtree in one click;
  upstream nodes are reported as skipped. Ideal for iterating on the tail of a long workflow.
- **Post-run forensics per node** — captured input/output, the branch taken, and on failure a
  structured **root-cause diagnosis card** (code, cause, suggested fix). A node whose side
  effect was simulated is explicitly marked **SIMULATED — no real side effect was performed**.

## 4. Live validation

- Floating validation badge on the canvas: green when valid, amber for warnings, red for errors.
- Expands into a panel listing every issue (empty graph, missing trigger, orphan nodes, cycles).
- **Registry-driven config checks** — each node field can declare `required`, a semantic
  `format` (`email`, `url`, `cron`, `filename`, `json`, `positiveNumber`, `port`), and `min`/
  `max` numeric bounds; violations surface in the same panel. A node with failure injection ON
  raises a warning-level `INJECTED_FAILURE` issue so a "production" run can't fail by accident.
- Click an issue to select & focus the offending node.
- The Run action is blocked while error-level issues exist, with a toast explaining why.

## 5. Editing & history

- Undo / redo with a 50-step bounded history stack.
- Duplicate selected node (`Ctrl+D`); copy / cut / paste nodes (`Ctrl+C` / `Ctrl+X` / `Ctrl+V`).
- **Auto-layout** (`Ctrl+L`) — a layered DAG algorithm (longest-path layering + barycenter crossing
  reduction) tidies the whole graph left → right; grid fallback for cyclic graphs.
- **Version snapshots** — capture named local checkpoints and restore any of them instantly, with
  one-click undo; stored per-workflow in `localStorage` (offline, max 25).
- Delete selected node (`Delete` / `Backspace`).
- Dirty-state indicator; save with `Ctrl+S`.
- Import a `*.flowforge.json` file (schema-validated); export the current workflow to one.
- **Duplicate & rename workflows** from the workspace — hover any card to deep-copy it into a new
  workflow (nodes, edges, and config intact) or rename it inline.

## 6. Execution engine

- From-scratch topological DAG runner (Kahn's algorithm) — no third-party workflow runtime.
- Cycle detection; refuses to run invalid graphs.
- True **edge-activation** branch routing: untaken branches are skipped, not merely ignored.
- Filter short-circuiting; **Batch Split** passes a bounded batch downstream in one pass;
  multi-input Merge (object-merge or array).
- **Reliability policy around every node** — hard timeout, bounded retries with exponential
  backoff, and optional continue-on-error, applied by `withPolicy` (`src/lib/policy.ts`).
- **Structured root-cause diagnosis on every failure** (`src/lib/diagnostics.ts`) — a stable
  code, cause, fix, severity, and retryability, never an anonymous crash.
- **Error containment** — a failing node's downstream is skipped; with continue-on-error the
  run proceeds and downstream nodes receive the failure in an `_error` field. Run status is
  `error` for any non-tolerated failure, `partial` when failures were only tolerated, and
  `paused` when halted at an Approval gate.
- **Human approvals** — an Approval node pauses the run; a resume executes the remainder and
  merges both timelines into one run record.
- **Secrets** — `{{secrets.NAME}}` references resolve from `FF_SECRET_*` environment variables
  into a copy of the node config at execution time; values are redacted from logs and never
  stored in the workflow JSON.
- Identical engine runs both **in-browser (live preview)** and **server-side (API/webhook)**;
  the run record reports which `executor` ran it, plus `environment` facts and an
  `anySimulated` flag when any side effect was mocked.

## 7. Run console

- Dockable panel with three tabs:
  - **Timeline** — every node with live status and per-node timing.
  - **Logs** — streamed, color-coded by level (info/warn/error/debug), timestamped.
  - **Data** — inspect any node's captured input/output as collapsible, syntax-colored JSON.
- Clear-logs button; running indicator; last-run summary (ok/err counts + duration).
- "Detail" shortcut to the full run drill-down page.

## 8. Run history (`/runs`)

- Searchable, filterable list of every execution.
- Filter by status (all / success / error) and by workflow.
- Per-row success bar, duration, trigger, relative time.
- Summary counts (successes / errors) in the header.

## 9. Run drill-down (`/runs/[id]`)

- Stat strip: status, duration, nodes-ok ratio, trigger.
- **Gantt-style execution timeline** — each node drawn as a bar positioned by start time and
  sized by duration, color-coded by status; skipped nodes marked.
- **Per-node inspector** — click any node to see its exact input, output, branch taken, error,
  and node-level logs.
- Full run **log stream**.
- One-click **Re-run** (server-side) that navigates to the fresh run.
- "Open editor" shortcut.

## 10. Analytics (`/analytics`)

- Total runs, success rate, average duration, total nodes executed (animated count-ups).
- SVG **donut** of node-category distribution.
- Most-used-nodes bar chart (top 10).
- Recent-runs list.
- Everything computed client-side from the run store — no analytics service.

## 11. Templates

- **8 built-in starter workflows**, instantiable with one click from the workspace or
  `POST /api/workflows/from-template`.
- Each ships as seedable JSON (`npm run seed`).
- Coverage: webhook onboarding, HTTP enrichment, AI sentiment routing, order math + code +
  file write, scheduled health check with a Switch, batch Loop iteration, parallel fetch + Merge,
  and an AI summary digest.

## 12. Webhooks

- Every saved workflow exposes `POST/GET /api/webhook/[id]`.
- The request body (POST) or query string (GET) becomes the trigger input.
- Runs server-side and persists the run; returns runId, status, duration, and final output.
- **Optional HMAC-SHA256 signing** — set `FF_WEBHOOK_SECRET` and requests must carry
  `x-flowforge-signature: sha256=<hex>` over the raw body (Stripe/GitHub-style; common alias
  headers accepted, plus a 5-minute timestamp replay guard). Without a secret the endpoint
  still works but every response reports `"authMode": "unsigned"`.
- "Copy webhook URL" action in the editor toolbar.

## 13. Command palette (⌘K / Ctrl+K)

- Fuzzy subsequence search with keyboard navigation and grouped results.
- Navigate home, open analytics, open **run history**, browse templates, explore the node library.
- Create a new workflow.
- Insert **any** node type — deep-links to `/editor?add=<type>` on a fresh canvas.
- **Toggle light / dark theme.**
- Escape to close.

## 14. Landing experience

- Scroll-driven 3D hero: a WebGL node-constellation (Three.js via @react-three/fiber).
- Aurora/gradient backgrounds, scroll-reveal sections, count-up metrics.
- Auto-playing live-engine demo embedded in the page.
- Feature, node-library, architecture, and workspace sections with anchor nav.
- Tilt-on-hover cards.

## 15. Polish & accessibility

- Global click feedback (ripple + press-scale) via one delegated listener.
- Bespoke 3D loading animations on every route transition.
- Graceful 3D degradation: SSR-off dynamic import + error boundary + CSS fallback.
- `prefers-reduced-motion` honored (smooth-scroll and heavy motion disabled).
- **Light & dark themes** — a CSS-variable token system (`<html data-theme>`), toggleable from the
  toolbar or command palette, persisted in `localStorage`, and applied pre-paint to avoid flashes.
- Token-based design system consistent across every surface — including the React Flow canvas,
  controls, and minimap, which all adapt to the active theme.
- **First-run onboarding tour** — a five-step guided walkthrough shown once per browser.
- Toast notifications for all key actions.

## 16. Offline-first guarantees

- No database, no required API keys, no external services.
- AI nodes fall back to a deterministic offline implementation.
- Email defaults to **clearly-labelled mock mode** when no mail transport is configured — a
  simulated side effect is never presented as a real delivery.
- Storage degrades gracefully instead of crashing: remote KV → project `data/` → OS temp dir →
  in-process memory, with the active mode and its reason always reportable.

---

## 17. Human-in-the-loop approvals (`action.approval`)

- A new **Approval** action node pauses the entire run and records a `pendingApproval`
  (node, label, request message, requestedAt, payload snapshot) on the run; run status becomes
  `"paused"` and everything downstream is marked skipped.
- Resuming re-executes from the approval node with the decision injected
  (`_approval.decision = approved | rejected`), routes to the **Approved** or **Rejected**
  output handle, and merges both timelines into a single coherent run record.
- The paused run is kept intact as an audit record with the decision, decider, note, and
  `resumedByRunId` stamped on it.
- Decisions go through `POST /api/runs/[id]/resume` — double-resume is rejected with 409.

## 18. Reliability engine (`src/lib/policy.ts`)

- Every node execution is wrapped by `withPolicy`: a hard timeout (default **15,000 ms**, max
  **120,000 ms**), **0–5** retries with **exponential backoff** (base 300 ms, doubled each
  attempt, capped at 5,000 ms), and `retryOn: "always" | "error" | "timeout"` (default
  `"always"`).
- **continueOnError** keeps the run going past a failure: the node is recorded as tolerated,
  the run finishes `"partial"`, and downstream nodes receive the error in an `_error` field.
- **Failure Injection** (`injectFailure: "none" | "error" | "timeout"`, optional
  `injectMessage`) forces a deliberate failure so the failure path can be demonstrated and
  tested. Injection is ALWAYS visibly logged as a 🧪 warning.
- All user-supplied policy values are clamped into safe bounds before use; the conformance
  suite asserts the clamping contract holds.

## 19. Root-cause diagnostics (`src/lib/diagnostics.ts`)

- Every node failure is classified into a structured `Diagnosis`: `code`, `title`, `cause`,
  `fix`, `severity`, `retryable`, and the failing `nodeType`.
- **14 codes:** `TIMEOUT`, `NETWORK`, `HTTP_STATUS`, `AUTH`, `RATE_LIMIT`, `INVALID_URL`,
  `VALIDATION`, `CODE_SYNTAX`, `CODE_RUNTIME`, `EXPRESSION`, `FILE_WRITE`, `MISSING_INPUT`,
  `INJECTED`, `UNKNOWN`.
- An executor may declare its category authoritatively with an explicit `"Category:"` message
  prefix (e.g. `throw new Error("Auth: no API key")`).
- The classifier is conservative: when it isn't confident it returns `UNKNOWN` with honest,
  actionable guidance rather than guessing. Diagnoses are rendered on the node inspector's
  diagnosis card and attached to run records.

## 20. Secrets (`src/lib/secrets.ts`)

- Secrets are environment variables named `FF_SECRET_<NAME>`, referenced in node config as
  `{{secrets.NAME}}`.
- Substitution happens into a **copy** of the node config at execution time, so a secret value
  never enters the stored workflow JSON, the run input/output panels, or exported files.
- Secret values are redacted from log lines (`redact()`), and config previews can show *that*
  a secret is used via `maskSecretRefs()` without leaking it. Helpers: `secretNames()`,
  `findSecretRefs()`.
- In the browser no secrets resolve — a node that needs one fails with an **AUTH** diagnosis
  (plus a "missing secret" warning) instead of silently sending nothing.

## 21. Honest delivery (`action.email`)

- Three transports, chosen per node or auto-detected: **resend** (live POST to the Resend API,
  key from the node's `apiKey` field or env `RESEND_API_KEY`), **gateway** (live POST of
  `{from,to,subject,text}` JSON to `gatewayUrl` or env `MAIL_GATEWAY_URL`), and **mock**
  (nothing is delivered).
- **Auto** mode picks live when a credential exists, otherwise mock. The recipient is validated
  before anything is sent.
- Mock mode logs an explicit `SIMULATED email (mock mode)` warning and records
  `delivered: false, simulated: true, deliveryMode: "mock"`; live sends record
  `delivered: true, simulated: false, deliveryMode: "live"`.
- Core product principle: **a simulated side effect is never presented as a real delivery** —
  flagged on the node result and rolled up into the run's `anySimulated`.

## 22. Self-describing storage (`src/lib/server/store.ts`)

- The backend is **discovered at runtime by probing**, in this order: 1) remote KV (Upstash /
  Vercel KV REST — `KV_REST_API_URL`+`KV_REST_API_TOKEN` or
  `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN`) → durable across redeploys and
  instances; 2) `<project>/data` if writable → durable on a VM/container; 3) OS temp dir →
  ephemeral, per-instance; 4) in-process memory → last resort so the product degrades instead
  of crashing.
- `storageInfo()` returns `{ backend, durable, label, root, reason }`, where `reason` is a
  plain-English explanation that includes **why** a better backend was rejected. Also
  `storageInfoSync()` and `storageStats()`.
- The public CRUD API is unchanged (`listWorkflows`, `getWorkflow`, `saveWorkflow`,
  `deleteWorkflow`, `saveRun`, `listRuns`, `getRun`).

## 23. Node Conformance Suite (`src/lib/conformance.ts`)

- A self-test the platform runs against itself — **4 layers of contract per node type**:
  1. **Registry contract** — label/description present, icon actually exists in
     `src/components/ui/iconMap.ts`, unique non-empty output handles, valid category, correct
     input arity.
  2. **Schema contract** — shipped defaults are format- and range-clean (a `required` field
     with no safe default is legitimate and reported, not failed).
  3. **Executor contract** — an executor is registered; returns an `ExecResult` with an
     `output` property; deterministic for identical input; or fails with a classified diagnosis.
  4. **Behaviour contract** — hand-written assertion cases (**35 cases across 21 types**),
     including routing, merging, validation, mock labelling, and approval-halt semantics.
- Plus platform-wide cross-checks: no duplicate type ids, every executor maps to a declared
  type, every type has an executor, all **8** shipped templates structurally valid with
  resolvable edge handles, and policy clamping bounds enforced.
- **Measured result: 226 checks passed, 0 failed, 2 skipped, 100% score, across 21 node types
  in ~1.7 s.** The 2 skips are `action.writeFile`'s invocation checks, skipped *deliberately*
  because executing it would write a real file to disk — a health check must never mutate data.
  Reported transparently, never hidden.
- Exposed via `GET /api/health` (HTTP 200 all-pass / 503 any-fail, `?only=type1,type2` filter,
  `runtime` block with Node version, platform, `secretsConfigured` count, and storage mode).

## 24. Benchmark Lab (`src/lib/benchmark.ts`)

- **6 deterministic offline workloads**, reported as nearest-rank percentiles (p50/p95/p99 plus
  min/max/mean/stdDev/throughput): Linear chain (5 nodes), Conditional routing (if + filter),
  Fan-out → merge (4 branches), Transform 1,000 records, Batch split 10,000 items, and an AI
  node (offline mock).
- **Measured: p95 ≤ 2 ms on every workload; 0 failures** (measured p95 ≤ 1 ms per workload on
  the dev machine; results are machine-dependent, the guarantees below are not).
- Asserts **4 hard guarantees that must hold on every run**:
  1. a node timeout is a hard ceiling — a 20 ms budget aborts a 2,000 ms node in ~20–25 ms
     (measured 21 ms) with a `TIMEOUT` diagnosis;
  2. every node failure carries a structured root-cause diagnosis (non-`UNKNOWN`, with a
     suggested fix);
  3. with continue-on-error, a failed node yields a `partial` run and downstream nodes still
     execute;
  4. a simulated side effect is flagged as simulated on both the node and the run — never
     reported as a real delivery.
- Exposed via `GET /api/benchmarks?iterations=N` (1–200, default 20).

---

### Node library at a glance (21 nodes · 5 categories)

- **Triggers (4):** Manual, Webhook, Schedule, Interval.
- **Actions (6):** HTTP Request, Send Email, Log, Delay, Write File, Approval.
- **Logic (5):** If/Else, Switch, Filter, Merge, Batch Split.
- **Data (5):** Set Fields, JSON Transform, Code (JS), Template, Math.
- **AI (1):** AI Generate (smart / sentiment / keywords).

Full per-node details are in the [README node table](./README.md#-the-complete-node-library-21-nodes--5-categories).
