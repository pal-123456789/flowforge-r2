# Changelog

All notable changes to FlowForge. This project targets Baloon National Hackathon 2026.

## [1.6.0] — Reliability engine, human approvals & self-verification

### Added
- **Approval node (`action.approval`)** — a human-in-the-loop gate. The first pass pauses the
  whole run (run status `"paused"`, a `pendingApproval` recorded on the run); a resume call
  re-executes from the gate with the decision injected and routes to the **Approved** or
  **Rejected** output. `POST /api/runs/[id]/resume` (`{ "decision": "approved" | "rejected" }`)
  keeps the paused run intact as an audit record and stitches both timelines into one.
- **Per-node reliability policy** (`src/lib/policy.ts`) — every execution is wrapped by
  `withPolicy`: a hard timeout (default 15 s, max 120 s), 0–5 retries with exponential backoff
  (base 300 ms, doubled per attempt, capped at 5 s), `retryOn: always | error | timeout`, and
  continue-on-error (the run proceeds past the failure, ends `"partial"`, and downstream nodes
  receive the error in an `_error` field). Configured in the Inspector's policy editor.
- **Failure Injection** — any node can be told to fail on purpose (`none | error | timeout`,
  optional custom message) so failure paths can be demoed and tested. Injection is always
  visibly logged as a 🧪 warning and diagnosed as `INJECTED`.
- **Root-cause diagnosis engine** (`src/lib/diagnostics.ts`) — every node failure is classified
  into a structured `Diagnosis` (code, title, cause, fix, severity, retryable). 14 codes:
  `TIMEOUT`, `NETWORK`, `HTTP_STATUS`, `AUTH`, `RATE_LIMIT`, `INVALID_URL`, `VALIDATION`,
  `CODE_SYNTAX`, `CODE_RUNTIME`, `EXPRESSION`, `FILE_WRITE`, `MISSING_INPUT`, `INJECTED`,
  `UNKNOWN`. An explicit `"Category:"` message prefix from an executor is treated as
  authoritative.
- **Secrets layer** (`src/lib/secrets.ts`) — secrets live in `FF_SECRET_<NAME>` environment
  variables and are referenced in node config as `{{secrets.NAME}}`. They are substituted into a
  *copy* of the config at execution time, so the value never enters the stored workflow JSON,
  run panels, or exports, and secret values are redacted from logs. In the browser no secrets
  resolve, so a node needing one fails with an `AUTH` diagnosis instead of silently sending
  nothing.
- **Registry-driven field validation** (`src/lib/validation.ts`) — node fields can declare
  `required`, `format` (`email`/`url`/`cron`/`filename`/`json`/`positiveNumber`/`port`),
  `min`, and `max`; the editor's Validation panel now merges these config issues in, and a node
  with failure injection ON raises a warning-level `INJECTED_FAILURE` issue.
- **Real email delivery (`action.email`)** — three transports, chosen per node or auto-detected:
  **Resend** (live, key from the node or `RESEND_API_KEY`), an **HTTP mail gateway** (live POST
  of `{from,to,subject,text}` to `gatewayUrl` or `MAIL_GATEWAY_URL`), or **mock** (nothing is
  delivered; the log prints an explicit `SIMULATED email (mock mode)` warning and the output
  records `delivered: false, simulated: true`). Auto mode picks live when a credential exists.
  The recipient is validated before anything is sent.
- **Durable, self-describing storage** (`src/lib/server/store.ts`) — the backend is discovered
  at runtime by probing, in order: remote KV (Upstash / Vercel KV REST) → `<project>/data` if
  writable → OS temp dir → in-process memory. `storageInfo()` / `storageInfoSync()` /
  `storageStats()` report the backend, whether it is durable, and a plain-English reason that
  includes *why* a better backend was rejected.
- **`GET /api/health`** — runs the full Node Conformance Suite and returns the report; HTTP 200
  when everything passes, 503 when any check fails, so it works as a real readiness probe.
  Supports `?only=type1,type2`; the response includes a `runtime` block (Node version, platform,
  `secretsConfigured` count, storage mode).
- **`GET /api/benchmarks`** — runs the Benchmark Lab; supports `?iterations=N` (1–200, default 20).
- **Node Conformance Suite** (`src/lib/conformance.ts`) — a self-test the platform runs against
  itself: 4 contract layers per node type (registry, schema, executor, behaviour — 35
  hand-written cases across all 21 types) plus platform-wide cross-checks (no duplicate type
  ids, executor coverage, all 8 shipped templates structurally valid with resolvable edge
  handles, policy clamping bounds). Measured: **226 checks passed, 0 failed, 2 skipped, 100%
  score, across 21 node types in ~1.7 s**. The 2 skips are `action.writeFile`'s invocation
  checks, skipped deliberately because executing it would write a real file — a health check
  must never mutate data.
- **Benchmark Lab** (`src/lib/benchmark.ts`) — 6 deterministic offline workloads (linear chain,
  conditional routing, fan-out → merge, 1,000-record transform, 10,000-item batch split, offline
  AI) reported as nearest-rank p50/p95/p99 plus min/max/mean/stdDev/throughput. It also asserts
  4 hard guarantees on every run: a node timeout is a hard ceiling (a 20 ms budget aborts a
  2,000 ms node in ~20–25 ms with a `TIMEOUT` diagnosis), every failure carries a structured
  non-UNKNOWN diagnosis with a fix, continue-on-error yields a `partial` run with downstream
  still executing, and a simulated side effect is flagged on both the node and the run.
  Measured: **p95 ≤ 2 ms on every workload; 0 failures; 4/4 guarantees passed.**

### Changed
- `logic.loop` is relabelled **Batch Split** (type string unchanged) and its documentation now
  tells the truth: it slices an array field into a batch of up to N items and passes the batch
  downstream in a single pass — it never iterated per item. Output handle label is "Batch"
  (handle id is still `each`).
- `RunStatus` gained `"paused"` and `"partial"`; `RunRecord` gained `skippedCount`,
  `toleratedCount`, `pendingApproval`, `executor`, `environment`, and `anySimulated`;
  `NodeRunResult` gained `attempts`, `diagnosis`, `simulated`, `deliveryMode`, `policyUsed`,
  and `tolerated`. The engine accepts `RunOptions.fromNodeId` + `initialInput` (partial runs),
  `secrets`, and an injectable `fetchImpl` used by the conformance suite and benchmark lab so
  they run hermetically with zero network traffic.
- Webhook responses now report `authMode` (`signed`/`unsigned`), `toleratedCount`,
  `anySimulated`, and a pending approval, and support optional HMAC-SHA256 request signing.
- `README.md`, `FEATURES.md`, `ARCHITECTURE.md`, `API.md`, and `DISCLOSURE.md` rewritten to
  match the engine, including an honest limitations statement.

## [1.5.0] — Landing polish & correct links

### Added
- A subtle sweeping **sheen** animation on primary call-to-action buttons (hero, nav, CTA).
- A **GitHub** icon-link in the landing navigation and a **Source** button in the final CTA.

### Fixed
- All landing GitHub links now point to the configured repository
  (`NEXT_PUBLIC_REPO_URL`) and open in a new tab, instead of the generic
  `github.com` homepage.

## [1.4.0] — More ready-to-run templates

### Added
- Three new one-click starter templates (now **8** total), chosen to showcase nodes the earlier
  templates didn't exercise:
  - **Batch Processor (Loop)** — iterate an array with the Loop node, enrich each item in custom
    JS, and log every processed row.
  - **Parallel Fetch → Merge** — fan out to two public APIs in parallel and recombine both
    responses into one object with the Merge node.
  - **AI Summary Digest** — fetch content, summarize it with the AI node, format a digest via a
    Template, and email it.

## [1.3.0] — Pro editor: layout, clipboard & versioning

### Added
- **Auto-layout ("Tidy graph")** — a from-scratch layered DAG layout (longest-path layering +
  barycenter crossing reduction) arranges the whole graph left → right in one click (`Ctrl+L`,
  toolbar button, or command palette). Falls back to a balanced grid for cyclic graphs.
- **Copy / cut / paste nodes** — `Ctrl+C` / `Ctrl+X` / `Ctrl+V` with an in-session clipboard;
  pasted nodes get fresh ids and a slight offset.
- **Version snapshots** — a slide-in drawer to capture named, local checkpoints of a workflow and
  restore any of them instantly (with one-click undo). Stored per-workflow in `localStorage`
  (max 25), fully offline. Open from the toolbar or command palette.

### Changed
- Editor store gained `applyLayout`, `copyNode`, `cutNode`, `pasteClipboard`, `hasClipboard`, and
  `restoreGraph` actions — all history-aware so every bulk change is undoable.
- Shortcuts overlay and docs updated with the new hotkeys.

## [1.2.0] — Flow ergonomics & themeable UI

### Added
- **Run from here** — execute a single node and everything downstream of it, straight from the
  inspector. The engine computes the downstream reachable set, seeds the chosen node directly,
  and reports every upstream node as skipped. Great for iterating on the tail of a long graph.
- **Canvas quick-add** — double-click any empty spot on the canvas for a fuzzy, keyboard-driven
  node picker (type to filter every registered node, ↑/↓ to navigate, Enter to drop at the cursor).
- **Light & dark themes** — a token-based theme system (CSS variables on `<html data-theme>`)
  with a toggle in both the editor toolbar and the command palette. The choice persists in
  `localStorage` and is applied before first paint to avoid any flash.
- **Workflow duplicate & rename** — hover any workspace card to duplicate it (deep-copies nodes,
  edges, and config into a new workflow) or rename it inline.
- **First-run onboarding tour** — a five-step guided walkthrough shown once per browser
  (`localStorage`-gated), re-openable via the `flowforge:tour` event.

### Changed
- Neutral design tokens (`bg`/`line`/`ink`) now resolve through CSS variables so every surface —
  including the React Flow canvas, controls, and minimap — adapts to the active theme.
- The editor **Run** button and `Ctrl+Enter` now route through a single run path that also powers
  partial "Run from here" executions.

## [1.1.0] — Run observability & deeper editor

### Added
- **Run history** page (`/runs`) — searchable, status/workflow-filterable list of every execution.
- **Run drill-down** page (`/runs/[id]`) — Gantt-style execution timeline, per-node input/output
  inspector, branch-taken display, full log stream, and one-click server-side re-run.
- `GET /api/runs/[id]` single-run endpoint and `POST /api/runs` to persist in-browser runs so
  live editor runs now appear in history and analytics.
- **Live validation panel** in the editor — surfaces graph errors/warnings and jumps to the
  offending node on click.
- **Node palette favorites** (★, persisted in `localStorage`) and a **Recent** nodes section.
- Command-palette entry for **Run History**.
- Deep documentation suite: `FEATURES.md`, `ARCHITECTURE.md`, `API.md`, this `CHANGELOG.md`,
  and a fully rewritten `README.md`.

### Changed
- Workspace "recent runs" rows and the run console now link straight to the run drill-down.
- Canvas drops and palette adds both record recently-used nodes.

## [1.0.0] — Hackathon baseline

### Added
- Visual node editor on an infinite React Flow canvas with custom per-category rendering.
- From-scratch topological DAG execution engine with cycle detection, edge-activation branch
  routing, filter/merge/loop, and error containment.
- Single node registry across trigger / action / logic / data / ai (twenty node types at v1.0;
  21 as of 1.6.0) driving the palette, Inspector forms, validation, command palette, and engine.
- `{{expression}}` template language with comparison operators; sandboxed Code node.
- Offline-safe AI node (OpenAI when keyed, deterministic mock otherwise).
- Run console (timeline / logs / data), analytics dashboard, templates, import/export.
- Webhook trigger endpoint per workflow.
- Cinematic 3D landing page with graceful WebGL degradation, 3D loaders, command palette,
  global click feedback, and a dark token-based design system.
- File-based persistence with serverless temp-dir fallback + seeding.
