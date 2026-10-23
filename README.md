# FlowForge

> **A drag-and-drop canvas that lets anyone build, run, and watch real automations — no code required.**

🧑‍💻 **Built for:** Baloon National Hackathon 2026
🏷️ **Focus:** Visual Workflow Automation — a no-code, offline-first workflow builder
⚡ **Runs 100% offline** — zero paid API keys, zero external services required.
🌐 **Live demo:** https://flowforge-r2.vercel.app
📦 **Source:** https://github.com/pal-123456789/flowforge-r2

---

## Table of contents

1. [The problem](#-the-problem)
2. [Our solution](#-our-solution)
3. [Feature tour](#-feature-tour)
4. [The complete node library](#-the-complete-node-library-21-nodes--5-categories)
5. [How the engine works](#-how-the-engine-works)
6. [The expression language](#-the-expression-language)
7. [Architecture](#-architecture)
8. [Quick start](#-quick-start)
9. [Keyboard shortcuts](#-keyboard-shortcuts)
10. [Pages & routes](#-pages--routes)
11. [HTTP API reference](#-http-api-reference)
12. [Project layout](#-project-layout)
13. [Design system](#-design-system)
14. [Deployment](#-deployment)
15. [A 3-minute demo script](#-a-3-minute-demo-script)
16. [Disclosure](#-disclosure)
17. [License](#-license)

Deeper companion docs live alongside this README:

| Doc | What's inside |
| --- | --- |
| [`FEATURES.md`](./FEATURES.md) | An exhaustive, honest catalog of every feature in the product. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Engine internals: the DAG runner, branch routing, expression VM, state model. |
| [`API.md`](./API.md) | Every HTTP endpoint, request/response shape, and example. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release history. |
| [`DISCLOSURE.md`](./DISCLOSURE.md) | AI tools, third-party libraries, APIs, and datasets. |

---

## 🎯 The problem

Automation is everywhere, but building it is still gatekept by code. Tools like Zapier
or n8n are powerful yet either closed, cloud-locked, or intimidating for newcomers. The
Teams want automations, but only have code. FlowForge delivers a
**visual workflow automation builder**: a way to wire
triggers → conditions → actions → transforms on a canvas and actually execute them.

The people who feel this pain — ops teams, founders, students, analysts — understand their
process perfectly but can't translate *"when X happens, check Y, then do Z"* into working
software without a developer.

## 💡 Our solution

**FlowForge** is a node-based automation studio built in Next.js. You drag nodes onto an
infinite canvas, connect them, configure each with simple forms, and press **Run**. A custom
**topological execution engine** walks the graph node-by-node and lights each one up live with
its *real* input and output — so you literally watch your logic think.

The standout engineering insight: a **single node registry** is the source of truth for *both*
the visual editor *and* the execution engine. Add one declarative node definition and it instantly:

- appears in the palette (searchable, draggable, favoritable),
- renders a fully-typed configuration form in the Inspector,
- participates in graph validation,
- becomes available in the command palette,
- and runs on the engine.

That single-source-of-truth design is what lets FlowForge ship **21 node types across 5
categories** — with real branching, batching, merging, templating, sandboxed JavaScript, AI,
human approvals, and per-node reliability policies — as one coherent, maintainable system
instead of 21 one-off features.

---

## ✨ Feature tour

FlowForge is intentionally deep. Here are the headline capabilities; the full inventory is in
[`FEATURES.md`](./FEATURES.md).

### The editor
- **Infinite node canvas** — drag, connect, pan, zoom, fit-view, minimap, dotted grid. Powered by React Flow with fully custom per-category node rendering. **Double-click any empty spot** for a fuzzy, keyboard-driven quick-add that drops a node right at the cursor.
- **Smart node palette** — live fuzzy search, collapsible categories, **drag-or-click to add**, **★ favorites** (persisted in `localStorage`), and a **Recent** section that tracks the nodes you use most.
- **Inspector forms** — every node renders a typed config form: text, number, select, boolean, textarea, JSON, code, and key/value editors, with conditional `showIf` fields. Includes **Run from here** to execute the selected node and everything downstream of it.
- **Live validation panel** — a floating badge continuously analyzes the graph and lists every error/warning (empty graph, missing trigger, orphaned nodes, cycles). Click an issue to jump straight to the offending node.
- **Undo / redo** — a 50-step history stack for every structural edit.
- **Copy / cut / paste & duplicate** — full keyboard-driven node editing (`Ctrl+C/X/V/D`) with an in-session clipboard.
- **Auto-layout** — one click (`Ctrl+L`) tidies the entire graph with a layered DAG algorithm (longest-path layering + barycenter crossing reduction).
- **Version snapshots** — capture named local checkpoints of a workflow and restore any of them instantly, with one-click undo. Entirely offline (`localStorage`).
- **Workspace management** — hover any workflow card to **duplicate** (deep-copy) or **rename** it inline.
- **Light & dark themes** — toggle from the toolbar or command palette; the choice persists and applies before first paint. Every surface, including the canvas, adapts.
- **First-run onboarding tour** — a concise five-step walkthrough for new users (shown once per browser).
- **Autosave-ready persistence** — save to the file store with one keystroke; dirty-state indicator in the toolbar.

### Running & observing
- **Live execution engine** — a Kahn's-algorithm topological DAG runner with cycle detection. Nodes animate through `idle → waiting → running → success/error/skipped` in real time.
- **Run console** — a dockable panel with three tabs: **Timeline** (per-node status + timing), **Logs** (streamed, color-coded by level), and **Data** (inspect any node's captured input/output as collapsible JSON).
- **Run history** — `/runs` lists every execution with status, success ratio, duration, and trigger. Filter by status or workflow, search by name.
- **Run drill-down** — `/runs/[id]` is a full forensic view: a **Gantt-style execution timeline**, a per-node inspector showing exact **input, output, branch taken, errors, and node-level logs**, the complete log stream, and a one-click **re-run**.
- **Analytics dashboard** — `/analytics` computes success rate, average duration, total nodes executed, an SVG donut of node-category distribution, a most-used-nodes bar chart, and recent runs — all client-side from the run store.

### Control flow & logic
- **Real branching** — `If/Else` and `Switch` route execution down specific edges using true **edge-activation** (downstream nodes on the untaken branch are skipped, not just ignored).
- **Filtering** — a `Filter` node halts a branch unless its condition passes.
- **Merging** — a `Merge` node waits for multiple branches and combines their outputs.
- **Batching** — a `Batch Split` node slices an array field into a batch of up to N items and passes the batch downstream in a single pass.
- **Human approvals** — an `Approval` node pauses the run until a human approves or rejects, then routes to the Approved or Rejected edge.

### Reliability, honesty & self-verification
- **Per-node reliability policy** — every execution is wrapped with a hard timeout (default 15 s, max 120 s), 0–5 retries with exponential backoff (base 300 ms, cap 5 s), a retry trigger (`always`/`error`/`timeout`), and optional continue-on-error that degrades the run to `partial` instead of failing it.
- **Failure Injection** — force any node to fail (`error`/`timeout`) to demo and test failure paths; injection is always logged as a 🧪 warning.
- **Root-cause diagnostics** — every failure is classified into one of **14 structured codes** (timeout, network, auth, rate-limit, validation, code syntax/runtime, …) with a cause and a concrete fix, shown on the node's diagnosis card.
- **Secrets** — reference `{{secrets.NAME}}` in any config; values resolve from `FF_SECRET_*` environment variables at execution time into a copy of the config, are redacted from logs, and never enter the stored workflow JSON or exports.
- **Honest email delivery** — `Send Email` posts live to Resend or an HTTP mail gateway when a credential is configured; otherwise it runs in mock mode that is explicitly labelled `SIMULATED` and never claims delivery. A simulated side effect is flagged on the node and the run — never presented as real.
- **Self-describing storage** — the persistence backend is discovered at runtime (remote KV → project `data/` → temp dir → memory) and the active mode, its durability, and the reason are reportable via the API.
- **Node Conformance Suite** — the platform tests itself: 4 contract layers per node type plus platform-wide cross-checks. **Measured: 226 checks passed, 0 failed, 2 skipped (deliberately — Write File would mutate disk), 100% score, across 21 node types in ~1.7 s.** Served by `GET /api/health` (200 all-pass / 503 any-fail) as a real readiness probe.
- **Benchmark Lab** — 6 deterministic offline workloads with p50/p95/p99 percentiles and 4 hard guarantees (timeout is a hard ceiling, failures are always classified, continue-on-error yields a `partial` run, simulated side effects are labelled). **Measured: p95 ≤ 2 ms on every workload, 0 failures.** Served by `GET /api/benchmarks`.

### Power features
- **Template expression engine** — `{{dot.path}}` interpolation is available in nearly every field, with helpers like `{{json}}` (the whole payload) and array/object path access.
- **Sandboxed Code node** — write JavaScript that receives `input` and returns any value, executed in a constrained scope.
- **Offline-safe AI nodes** — summarize, classify sentiment, or extract keywords. Uses the OpenAI API *if* `OPENAI_API_KEY` is set, otherwise a built-in deterministic mock so **demos never break**.
- **Webhook triggers** — every saved workflow gets a live `POST /api/webhook/[id]` endpoint that executes it with the request body as input.
- **Import / export** — download any workflow as portable `*.flowforge.json`; re-import with schema validation.
- **One-click templates** — seed-ready starter workflows you can open and run instantly.
- **Command palette (⌘K / Ctrl+K)** — fuzzy-search to navigate, create workflows, open analytics or run history, toggle the light/dark theme, auto-layout the graph, open version snapshots, or deep-link **any node type** straight onto a fresh canvas.

### Presentation
- **Cinematic 3D landing page** — a scroll-driven marketing experience with a WebGL node-constellation hero (Three.js via @react-three/fiber), aurora backgrounds, scroll reveals, count-up metrics, and an auto-playing live-engine demo.
- **Graceful degradation** — all 3D is behind an SSR-off dynamic import **and** a React error boundary with a CSS fallback. No WebGL? No problem — the page still looks great.
- **3D loading animations** — bespoke animated loaders on every route transition.
- **Global click feedback** — a single delegated listener adds a tasteful ripple + press-scale to every interactive element.
- **Reduced-motion aware** — honors `prefers-reduced-motion`.

---

## 🧩 The complete node library (21 nodes · 5 categories)

Every node below is **real and executable**. The `type` is the engine dispatch key.

### Triggers — start a workflow

| Node | `type` | What it does |
| --- | --- | --- |
| **Manual Trigger** | `trigger.manual` | Starts on **Run**; emits a JSON test payload you define. |
| **Webhook** | `trigger.webhook` | Starts when an HTTP request hits the workflow's webhook URL; emits the request body (or a sample in test runs). |
| **Schedule** | `trigger.schedule` | Represents a recurring cron schedule; emits trigger metadata. |
| **Interval** | `trigger.interval` | Represents an every-N-seconds trigger; emits interval metadata. |

### Actions — do something

| Node | `type` | What it does |
| --- | --- | --- |
| **HTTP Request** | `action.http` | Makes a **real** HTTP request (GET/POST/PUT/PATCH/DELETE) with templated URL, headers, and body; captures status + parsed JSON/text. |
| **Send Email** | `action.email` | Sends real email via **Resend** (key from the node or `RESEND_API_KEY`) or an **HTTP mail gateway** (`gatewayUrl` or `MAIL_GATEWAY_URL`). With no transport configured it runs in mock mode that logs an explicit `SIMULATED email (mock mode)` warning and records `delivered: false` — a simulated side effect is never presented as a real delivery. The recipient is validated before anything is sent. |
| **Log** | `action.log` | Writes a templated message to the run console at a chosen level. |
| **Delay** | `action.delay` | Pauses the branch for N milliseconds (capped for safety). |
| **Write File** | `action.writeFile` | Writes templated content to a file under `/data/outputs` (server-side); logs a preview in the browser. |
| **Approval** | `action.approval` | **Human-in-the-loop gate.** Pauses the whole run (status `"paused"`) until someone approves or rejects via `POST /api/runs/[id]/resume`, then routes to the **Approved** or **Rejected** output edge. |

### Logic — branch & control flow

| Node | `type` | What it does |
| --- | --- | --- |
| **If / Else** | `logic.if` | Evaluates a condition and routes to the **True** or **False** output edge. |
| **Switch** | `logic.switch` | Routes to one of several case edges (or Default) based on a value. |
| **Filter** | `logic.filter` | Passes data through only if the condition holds; otherwise downstream is skipped. |
| **Merge** | `logic.merge` | Waits for multiple incoming branches and combines them (object-merge or array). |
| **Batch Split** | `logic.loop` | Slices an array field into a batch of up to N items and passes the batch downstream **in a single pass** on the **Batch** edge. It does not iterate per item — map over the batch in a Code node if you need per-item work. |

### Data — shape & transform

| Node | `type` | What it does |
| --- | --- | --- |
| **Set Fields** | `data.set` | Adds/overrides fields via key/value pairs (values support expressions). |
| **JSON Transform** | `data.transform` | Reshapes data by mapping output keys to expressions over the input. |
| **Code (JS)** | `data.code` | Runs sandboxed JavaScript; `input` in, any value out. |
| **Template** | `data.template` | Builds a string from a `{{expression}}` template into a chosen field. |
| **Math** | `data.math` | Evaluates a numeric expression over the data into a chosen field. |

### AI — intelligent steps

| Node | `type` | What it does |
| --- | --- | --- |
| **AI Generate** | `ai.generate` | Generates text from a prompt. Modes: smart summary, sentiment classifier, keyword extractor. Uses OpenAI if a key is set, else an offline deterministic mock. |

> Adding a 22nd node is a single declarative object in `src/lib/nodeRegistry.ts` plus one
> executor function in `src/lib/executors.ts`. The palette, forms, validation, command palette,
> and engine all pick it up automatically — and the Node Conformance Suite then checks its
> registry, schema, executor, and behaviour contracts on every `/api/health` call.

---

## ⚙️ How the engine works

The engine lives in [`src/lib/engine.ts`](./src/lib/engine.ts) and is a from-scratch
topological DAG executor — no third-party workflow runtime.

1. **Analyze** — `analyzeGraph` (in `src/lib/graph.ts`) builds adjacency/incoming maps, finds
   triggers, detects cycles via **Kahn's algorithm**, produces a best-effort topological order,
   and merges in **registry-driven config validation** (required fields, formats, numeric
   ranges per node). A graph with any error-level issue won't run.
2. **Seed** — the run begins at the trigger(s). Each trigger emits its payload onto its
   outgoing edges. A partial run (`fromNodeId` + `initialInput`) seeds the chosen node
   directly instead and marks everything outside its subtree skipped.
3. **Walk** — nodes execute in topological order. A node runs once **all of its active incoming
   edges have delivered values**. Its executor returns an `ExecResult`:
   - `output` — the data passed downstream.
   - `branch` — which output handle to activate (`If/Else`, `Switch`, `Approval`). Only the
     matching edge is activated; the others are left inactive, so their subtrees are **skipped**.
   - `pass` — for `Filter`; when `false`, downstream edges are not activated.
   - `halt` / `haltReason` — for `Approval`; pauses the run and records a `pendingApproval`.
   - `simulated` / `deliveryMode` — how a side effect was performed (`live`/`mock`/`preview`).
4. **Wrap** — every execution runs under the node's **reliability policy** (`withPolicy` in
   `src/lib/policy.ts`): hard timeout → bounded retries with exponential backoff → optional
   continue-on-error. Attempt counts and timeouts are recorded on the node result.
5. **Classify** — any failure is run through the diagnosis engine (`src/lib/diagnostics.ts`)
   and attached to the node result as a structured `Diagnosis` (code, cause, fix, severity,
   retryable).
6. **Merge semantics** — a `Merge` node collects the array of active inputs and either
   shallow-merges objects or returns them as an array.
7. **Observe** — the engine emits `onNodeStart`, `onNodeFinish`, `onLog`, `onPaused`, and
   `onDone` events. The editor subscribes to animate node status and stream the console in
   real time; the API route collects them into a persisted `RunRecord`.

Failure semantics are explicit: a non-tolerated failure ends the run as `"error"` and its
downstream edges are **not** activated; a failure tolerated via continue-on-error activates the
outgoing edges with an **error carrier** (`_error` field) so the flow continues and the run
finishes `"partial"`; a run halted at an Approval gate finishes `"paused"`. Secret values are
redacted from every log line before it is stored.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full data model and edge-activation algorithm.

---

## 🔤 The expression language

Implemented in [`src/lib/expression.ts`](./src/lib/expression.ts). Any field documented as
supporting expressions accepts `{{ ... }}` tokens:

- `{{name}}` — top-level field.
- `{{data.user.email}}` — nested dot-path.
- `{{items.0.id}}` — array index access.
- `{{json}}` — the entire incoming payload, pretty-printed.

Expressions are resolved against the node's incoming data. The `If/Else`, `Switch`, and
`Filter` nodes additionally support a comparison layer (`eq`, `neq`, `gt`, `lt`, `gte`, `lte`,
`contains`, `truthy`, `empty`).

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          nodeRegistry.ts                               │
│         (single source of truth: 21 node type definitions)            │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │ drives                              │ drives
       ┌────────▼─────────┐                 ┌─────────▼──────────┐
       │   Visual editor   │                 │  Execution engine  │
       │ ───────────────── │                 │ ────────────────── │
       │ NodePalette       │                 │ engine.ts (DAG)    │
       │ Canvas (ReactFlow)│   serialize     │ policy.ts (wrap)   │
       │ Inspector forms   │ ───────────────▶│ executors.ts       │
       │ ValidationPanel   │   nodes+edges   │ diagnostics.ts     │
       │ editorStore (Zust)│◀─────────────── │                    │
       └────────┬──────────┘   run events    └─────────┬──────────┘
                │                                       │
                │ fetch                                 │ persist
       ┌────────▼───────────────────────────────────────▼─────────┐
       │                   Next.js App Router API                   │
       │  /api/workflows  /api/run  /api/runs  /api/webhook/[id]    │
        │  /api/health    /api/benchmarks  /api/runs/[id]/resume    │
       └────────────────────────────┬───────────────────────────── ┘
                                     │
                        ┌────────────▼────────────┐
                        │  Self-describing store   │
                        │  probe: remote KV first  │
                        │  (Upstash / Vercel KV),  │
                        │  then data/ → temp dir   │
                        │  → memory; storageInfo()  │
                        │  reports what won & why  │
                        └──────────────────────────┘
```

- **Framework:** Next.js 14 (App Router), React 18, TypeScript.
- **Canvas:** React Flow 11 with a custom `flowNode` renderer.
- **State:** Zustand store with an undo/redo history stack.
- **Styling:** Tailwind CSS 3 with a custom CSS-variable design-token system (light & dark themes).
- **Motion/3D:** Framer Motion, Three.js + @react-three/fiber, Lenis smooth-scroll.
- **Persistence:** self-describing storage with runtime backend probing — remote KV (Upstash /
  Vercel KV REST) when configured, else the project's `data/` directory, else the OS temp dir,
  else in-process memory. `storageInfo()` reports the active backend, whether it is durable,
  and why.

---

## 🚀 Quick start

```bash
cd flowforge
npm install
npm run seed      # optional: writes the demo workflows into data/
npm run dev       # http://localhost:3000
```

Production build:

```bash
npm run build
npm run start
```

> **Requirements:** Node.js 18.17+ (Next.js 14 requirement). No database, no API keys,
> no Docker, no external services. Everything runs locally.

### Optional: enable real AI

Set an OpenAI key to upgrade the AI node from offline-mock to live completions:

```bash
# .env.local
OPENAI_API_KEY=sk-...
```

If unset, the AI node automatically uses its deterministic offline implementation.

### Optional: real email, secrets, durable storage & signed webhooks

All of these are **optional** — the product is fully functional without any of them:

```bash
# .env.local
# Secrets: any FF_SECRET_<NAME> variable is available as {{secrets.NAME}} in node config.
# The value is substituted into a copy of the config at execution time and never stored.
FF_SECRET_RESEND_KEY=re_...          # used by {{secrets.RESEND_KEY}}
FF_SECRET_MAIL_GATEWAY_URL=https://…

# Live email (the Send Email node auto-detects these; without them it stays in labelled mock mode)
RESEND_API_KEY=re_...
MAIL_GATEWAY_URL=https://…           # receives {from,to,subject,text} as JSON

# Durable storage (probe order: remote KV → project data/ → temp dir → memory)
KV_REST_API_URL=https://…            # Upstash / Vercel KV REST
KV_REST_API_TOKEN=…
# or: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

# Signed webhooks (optional; without it the endpoint reports "authMode": "unsigned")
FF_WEBHOOK_SECRET=whsec_...
```

In the browser no secrets resolve — a node that needs one fails with an `AUTH` diagnosis
rather than silently sending nothing. Server-side runs (`/api/run`, webhooks, resume) resolve
secrets from the server environment.

---

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Open the command palette |
| `Ctrl+S` | Save workflow |
| `Ctrl+Enter` | Run workflow |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+D` | Duplicate selected node |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste node |
| `Ctrl+L` | Auto-layout (tidy) the graph |
| `Delete` / `Backspace` | Delete selected node |
| Double-click canvas | Quick-add a node at the cursor |
| `?` | Toggle the shortcuts overlay |
| `Esc` | Close palette / overlay / quick-add |

---

## 🧭 Pages & routes

| Route | Purpose |
| --- | --- |
| `/` | Cinematic 3D landing + live workspace (your workflows, templates, recent runs). |
| `/editor` | New blank workflow on an infinite canvas. |
| `/editor/[id]` | Open an existing saved workflow. |
| `/editor?add=<type>` | Open a canvas with a node pre-inserted (command-palette deep link). |
| `/runs` | Run history: searchable, filterable list of every execution. |
| `/runs/[id]` | Run drill-down: timeline, per-node I/O inspector, logs, re-run. |
| `/analytics` | Metrics dashboard across all runs and workflows. |

---

## 🔌 HTTP API reference

Full details and examples in [`API.md`](./API.md). Summary:

| Method & path | Purpose |
| --- | --- |
| `GET /api/workflows` | List all saved workflows. |
| `POST /api/workflows` | Create or update a workflow. |
| `GET /api/workflows/[id]` | Fetch one workflow. |
| `DELETE /api/workflows/[id]` | Delete a workflow. |
| `POST /api/workflows/from-template` | Create a workflow from a built-in template. |
| `POST /api/run` | Execute a workflow server-side (inline graph or by `workflowId`). |
| `GET /api/runs` | List run records (optionally by `workflowId`). |
| `POST /api/runs` | Persist a run record produced by the in-browser engine. |
| `GET /api/runs/[id]` | Fetch one run record. |
| `POST /api/runs/[id]/resume` | Approve/reject a run paused at an Approval node and continue it. |
| `POST /api/webhook/[id]` | Trigger a workflow with the request body as input (optional HMAC signing). |
| `GET /api/health` | Run the Node Conformance Suite; 200 all-pass, 503 any-fail. |
| `GET /api/benchmarks` | Run the Benchmark Lab (`?iterations=N`, 1–200, default 20). |

---

## 📁 Project layout

```
flowforge/
├── data/                      # JSON persistence (workflows, runs, outputs) + shipped seeds
├── scripts/seed.mjs           # Seeds demo workflows into data/
├── src/
│   ├── app/                   # Next.js App Router (pages, loading states, API routes)
│   │   ├── api/               # workflows, run, runs(+resume), webhook, health, benchmarks
│   │   ├── editor/            # /editor and /editor/[id]
│   │   ├── runs/              # /runs and /runs/[id]
│   │   ├── analytics/         # /analytics
│   │   └── page.tsx           # landing + workspace
│   ├── components/
│   │   ├── canvas/            # Canvas (React Flow), FlowNode, NodePalette
│   │   ├── console/           # RunConsole
│   │   ├── editor/            # Toolbar, EditorShell, ShortcutsHelp, ValidationPanel, SnapshotPanel, OnboardingTour
│   │   ├── inspector/         # Inspector config forms
│   │   ├── runs/              # RunHistory, RunDetail
│   │   ├── analytics/         # AnalyticsDashboard
│   │   ├── landing/           # Hero, Sections, Workspace, 3D scenes, primitives
│   │   └── ui/                # Toast, Icon, JsonView, Loader3D, ClickFX
│   ├── lib/
│   │   ├── nodeRegistry.ts    # ← single source of truth (21 node defs)
│   │   ├── engine.ts          # topological DAG executor (+ partial "run from here", approvals)
│   │   ├── policy.ts          # per-node reliability: timeout, retries, backoff, injection
│   │   ├── diagnostics.ts     # 14-code root-cause classification for every failure
│   │   ├── secrets.ts         # FF_SECRET_* env vars → {{secrets.NAME}} + redaction
│   │   ├── validation.ts      # registry-driven required/format/range checks
│   │   ├── conformance.ts     # Node Conformance Suite (self-test, backs /api/health)
│   │   ├── benchmark.ts       # Benchmark Lab (percentiles + guarantees, backs /api/benchmarks)
│   │   ├── executors.ts       # per-node execution logic
│   │   ├── expression.ts      # {{template}} engine + comparisons
│   │   ├── graph.ts           # analyze/validate (Kahn's algorithm)
│   │   ├── layout.ts          # layered DAG auto-layout
│   │   ├── snapshots.ts       # local version history
│   │   ├── theme.ts           # dark/light theme + pre-paint boot
│   │   ├── runLive.ts         # client-side live run wrapper
│   │   ├── templates.ts       # built-in starter workflows
│   │   ├── types.ts           # shared TypeScript types
│   │   ├── utils.ts           # formatting helpers
│   │   └── server/            # self-describing store (KV → data/ → temp → memory) + output writer
│   └── store/editorStore.ts   # Zustand editor state + history
└── (README / FEATURES / ARCHITECTURE / API / CHANGELOG / DISCLOSURE).md
```

---

## 🎨 Design system

- **Theme:** dark & light, driven by CSS variables on `<html data-theme>` in `globals.css`. Neutral tokens (`bg`/`line`/`ink`) resolve per theme; accents stay constant — `--brand #7c5cff`, `--brand-soft #9d84ff`, `--iris #06b6d4`. The choice persists in `localStorage` and is applied before first paint.
- **Typography:** Inter (UI) + JetBrains Mono (code/data).
- **Category colors:** triggers green, actions blue, logic amber, data pink, AI cyan — consistent across the palette, nodes, minimap, timeline, and analytics.
- **Motion:** out-expo easing `[0.16, 1, 0.3, 1]`; spring `cubic-bezier(0.22, 1, 0.36, 1)`.

---

## ☁️ Deployment

The repo root is the Next.js app, so **Vercel auto-detects it** — import the repo and deploy
with zero config. The included `vercel.json` pins the framework and build command.

The storage backend is **discovered at runtime by probing**, in this order: remote KV
(Upstash / Vercel KV REST — set `KV_REST_API_URL`+`KV_REST_API_TOKEN` or
`UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN`) → durable across redeploys and instances;
then the project's `data/` directory when writable → durable on a VM/container; then the OS
temp directory → ephemeral, per-instance (seeded from the bundled demo data so the demo opens
with content); finally in-process memory as a last resort, so the product degrades instead of
crashing. `GET /api/health` reports which backend is live, whether it is durable, and why —
including the reason a better backend was rejected.

Live deployment: **https://flowforge-r2.vercel.app**  ·  Source: **https://github.com/pal-123456789/flowforge-r2**

---

## 🎬 A 3-minute demo script

1. **Land** on `/` — scroll the 3D hero, metrics, and the auto-playing engine demo.
2. Hit **⌘K**, type "sentiment", and insert the AI node — or open a template from the workspace.
3. In `/editor`, **double-click the canvas** to quick-add nodes: a **Manual Trigger → AI Generate (sentiment) → If/Else → two Logs**. Hit **Ctrl+L** to auto-tidy the graph. Watch the **validation panel** go green.
4. Press **Ctrl+Enter**. Nodes light up live; the **run console** streams logs and shows each node's real I/O. Try **"Run from here"** on the If/Else to re-run just the tail.
5. Open **version snapshots**, capture a checkpoint, make a change, then restore it — all offline.
6. Click **Detail** in the console → land on `/runs/[id]`: the Gantt timeline, per-node input/output, and the branch that was taken.
7. Toggle **light/dark theme**, open `/analytics` for success rate, duration, and node-usage charts.
8. Note it all ran with **no API keys and no network** — fully offline.

---

## 🔍 Disclosure

See [`DISCLOSURE.md`](./DISCLOSURE.md) for the full statement. Summary:

- **AI tools:** an AI coding assistant was used to help scaffold and write code; all code was reviewed and is our responsibility.
- **External APIs:** OpenAI API — *optional*, only if a key is supplied. Resend and/or an HTTP mail gateway — *optional*, only for live email delivery; without them email is mock mode, explicitly labelled as simulated. Upstash / Vercel KV — *optional*, only for durable remote storage. Demo HTTP examples call the public `jsonplaceholder.typicode.com` test API.
- **Datasets:** none.
- **Notable libraries (all permissive licenses):** Next.js, React, React Flow, Zustand, Tailwind CSS, lucide-react, nanoid, clsx, Framer Motion, Three.js, @react-three/fiber, Lenis.

## 📄 License

MIT
