# FlowForge — Round 2 Demo Script
**Baloon National Hackathon 2026 · Round 2 · 15-minute live demo**

Format: 15 min demo + 10 min technical Q&A + 5 min panel feedback.
Total live-demo budget: **15:00**. Script below is timed to **14:15**, leaving **45 s** of buffer.

---

## 0. PRE-FLIGHT (do this 10 minutes before you go live)

Everything below is offline-capable. Do **not** depend on a network connection or any API key.

| # | Check | Command / action | Expected |
|---|-------|------------------|----------|
| 1 | Production build is green | `npm run build` | exit 0 |
| 2 | Conformance passes | open `/health` | **100% · 226 passed · 0 failed · 2 skipped** |
| 3 | Benchmarks pass | open `/benchmarks` | **4/4 guarantees held** |
| 4 | Storage mode known | `/health` → runtime block | "Project data/" (durable) or "Ephemeral" |
| 5 | Demo workflow saved | open `/editor` → your workflow | graph loads, Validation panel green |
| 6 | Failure injection **off** by default | select the demo node → Reliability | "None" |
| 7 | Two browser tabs | `localhost:3000/editor` and `localhost:3000/runs` | ready |
| 8 | Terminal open | with the webhook curl command pre-typed | see §8 |

> **If a live network call fails during the demo, that is fine — it is a feature.**
> The platform will classify the failure (NETWORK / TIMEOUT / HTTP_STATUS) and show a root cause.
> Actually *use* that if it happens. "The failure path is the demo" is a strong answer.

---

## 1. COLD OPEN — 0:00 → 0:45

**Screen:** Home `/`

> "Last round I showed you a visual workflow builder. This round the panel asked me to make it
> production-grade. I didn't just add features — I added the ability to **prove** the thing works.
>
> In the next fifteen minutes I'm going to show you FlowForge **failing on purpose** and
> **explaining itself**, then prove it with 226 automated checks and measured latency."

**Action:** hover the four nav pills (Runs · Analytics · **Conformance** · **Benchmarks**).
Do not click yet — tease it.

---

## 2. THE CANVAS — 0:45 → 3:00

**Screen:** `/editor` — open the pre-built demo workflow

> "This is the editor. 21 node types across 5 categories. Drag from the palette, connect the
> handles, and the engine works out the execution order."

**Beat 2a — the palette (15 s)**
- Point at the left palette: Trigger / Action / Logic / Data / AI.
- Say: "Twenty-one types. Every one of them is executable — not decorative."

**Beat 2b — reliability is a first-class control (45 s)**
- Click the **HTTP** node → the right-hand **Inspector** opens.
- Scroll to the **Reliability** panel. Point at it:
  > "This is what Round 1 was missing. Every node carries its own policy: a timeout ceiling,
  > retries with exponential backoff, a retry condition, and **continue-on-error**."
- Show the **Failure injection** control but leave it on *None* for now:
  > "And this is a deliberate failure injector. I'll use it in four minutes. It's how you
  > test the failure path without waiting for a real outage."

**Beat 2c — validation is registry-driven (30 s)**
- Click into the **email** node and clear its recipient field.
- The **Validation** panel immediately flags it.
- Say: "No hand-written validation code. The node definition declares `required` and
> `format: email`, and the editor, the API and the conformance suite all enforce the same rule."

**Beat 2d — the graph (30 s)**
- Click `Ctrl+L` (auto-layout) — the graph tidies itself.
- Say: "Layered DAG auto-layout, one keystroke."

---

## 3. RUN IT — 3:00 → 4:30

**Action:** `Ctrl+Enter` (or the ▶ Run button)

> "One keystroke. The DAG engine does a topological sort, activates only the edges on the taken
> branch, and executes."

**Watch for and narrate:**
- Nodes light up as they execute; the progress bar shows the current node.
- An untaken branch is **skipped**, not executed. Say it out loud:
  > "The branch that wasn't taken is genuinely skipped — it never ran."

**Beat 3b — a real error (optional, 20 s)**
- If the demo workflow includes a deliberate failing step, point at the red node:
  > "That's a failure. Click it and I'll show you what the platform says about it."
- Otherwise skip to §4.

---

## 4. RUN DETAIL — 4:30 → 5:30

**Action:** the run opens at `/runs/<id>` (or click **Runs** in the nav)

> "Every run is persisted with a full timeline, per-node input and output, and the log stream."

**Point at:**
- The **timeline** (left) — each node with its status and duration.
- The **node inspector** (right) — click a node to see its input and output JSON.
- The **log stream** (bottom).
- The **Delivery** stat card: *Live* or *Simulated*.

> "One more thing here. The Delivery badge says **Simulated** — because the email node had no
> API key, so FlowForge did *not* send anything, and it says so. I'll come back to this."

---

## 5. VERIFY — 5:30 → 7:30

**Screen:** `/health` (nav pill **Conformance**)

> "Round 1, I said 'it works.' Round 2, I can *prove* it works. This is the Node Conformance
> Suite — the platform testing itself."

**Beat 5a — the headline (30 s)**
- Point at the big **100%** and the four metric cards:
  **226 passed · 0 failed · 2 skipped · 21 node types.**
- Say: "This is not a unit test file nobody runs. It's wired to `GET /api/health`, which returns
> HTTP 503 if any check fails — so it's a **real readiness probe**. Vercel, Docker, a cron job —
> anything can gate on it."

**Beat 5b — the four contract layers (45 s)**
- Point at the numbered list: Registry → Schema → Executor → Behaviour.
  > "Four contracts per node type. Does the definition exist, is the schema clean, is the executor
  > registered and deterministic, and does the behaviour actually do what it claims?"

**Beat 5c — drill in (45 s)**
- Click **Expand all**. Scroll to a node type. Show the individual checks.
  > "35 hand-written behaviour cases across the 21 types, on top of the structural contracts."

**Beat 5d — the honest part (30 s)** ← *do not skip this, it is a trust signal*
- Point at the "2 skipped" card and the footnote.
  > "Two checks are skipped **by design**. One of them is `writeFile` — executing it would write a
  > real file to disk, and a health check must never mutate data. I report it instead of hiding it."

---

## 6. MEASURE — 7:30 → 9:00

**Screen:** `/benchmarks` (nav pill **Benchmarks**)

> "Performance claims without numbers are marketing. Here are numbers."

**Beat 6a — the chart (45 s)**
- The native chart shows p50/p95/p99 for all 6 workloads.
  > "Six deterministic offline workloads — linear chain, conditional routing, fan-out to merge,
  > transform a thousand records, split ten thousand items, and an AI node.
  > Worst p95 across every workload: **2 milliseconds**."

**Beat 6b — the guarantees (60 s)** ← *this is the strongest slide*
- Point at the four green guarantee cards, read two of them:
  > "These aren't benchmark results. These are **guarantees that must hold on every single run**,
  > and the lab fails the build if one doesn't.
  > One: *a node with a 20 millisecond budget cannot stall the run for 2000 milliseconds.*
  > Measured: the run aborted after **24 milliseconds** with a TIMEOUT diagnosis.
  > Two: *every node failure carries a structured root-cause diagnosis.* Never just 'something went wrong'."

**Beat 6c — percentile discipline (15 s)**
> "Percentiles, not averages. An average hides the one request that took 400 ms. p95 and p99 don't."

---

## 7. PRESENT — FAILURE INJECTION + DIAGNOSIS — 9:00 → 10:45

**Screen:** back to `/editor`

> "Now the part I think you'll like most. Let me break it on purpose."

**Beat 7a — inject (40 s)**
- Click the **Code** node (or the HTTP node).
- Inspector → **Reliability** → **Failure injection** → set to **Error** (message: `boom`).
- Save, then `Ctrl+Enter` to run.

**Beat 7b — the diagnosis (45 s)**
- Open the failing run. The node shows a **Diagnosis card**:
  - the **code** (e.g. `CODE_SYNTAX` / `INJECTED` / `TIMEOUT`),
  - the **cause** in plain English,
  - the **fix** — a concrete instruction.
- Say:
  > "It doesn't print a stack trace and wish you luck. It names the category, explains the cause,
  > and tells you what to change. There are **14** classified failure codes — timeout, network,
  > auth, rate limit, invalid URL, validation, code syntax, code runtime, expression, file write,
  > missing input, injected, HTTP status, unknown."

**Beat 7c — the injection is visible (20 s)**
- Point at the log line — the injected failure is logged with a 🧪 warning.
  > "Even my own sabotage is labelled. The platform never hides that it was forced to fail."

**Beat 7d — the 14 codes (20 s)**
- Optional: show the diagnosis reference in the app if you have it open, else state the list.

---

## 8. HARDEN — 8:45 → 11:30  *(approximate — the two halves are independent, pick one if short on time)*

### 8a. Human-in-the-loop (60 s) — the Approval node
**Screen:** `/editor` — the workflow with an **Approval** node

> "Some decisions shouldn't be automated. The Approval node stops the entire run."

**Beat:** run it.
- The run status is **paused**. The run detail shows an **Approval panel**: the request text, a
  note field, and **Approve & continue** / **Reject**.
- Say: "Notice — the downstream nodes are marked **skipped**. Nothing downstream ran. It genuinely
> stopped."
- Click **Approve & continue** with a note.
- The resumed run executes the approved branch; the rejected branch stays skipped.
- Say: "The decision, the note and who made it are kept on the original run as an audit trail.
> And the resumed timeline is stitched back together so it reads as one continuous run."

### 8b. Signed webhooks (45 s)
**Screen:** terminal

```bash
# unsigned request → 401
curl -i -X POST -H "Content-Type: application/json" \
  -d '{"order":"A-1"}' https://YOUR-DEPLOY/api/webhook/<workflowId>

# correctly signed request → 200
BODY='{"order":"A-1"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$FF_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -i -X POST -H "Content-Type: application/json" \
  -H "x-flowforge-signature: sha256=$SIG" \
  -d "$BODY" https://YOUR-DEPLOY/api/webhook/<workflowId>
```

> "Inbound webhooks are authenticated with HMAC-SHA256 over the raw body, compared in constant
> time, with an optional replay window. Unsigned or tampered requests get a 401 — I can show you
> the rejected one too."

**Fallback if the deploy has no `FF_WEBHOOK_SECRET` set:** the endpoint still works, but the
response says `"authMode": "unsigned"` and the UI flags it. Say that plainly — it is honest and
it is what the README documents.

### 8c. Secrets and storage (30 s) — *only if time allows*
> "Secrets come from `FF_SECRET_*` environment variables and are substituted into a **copy** of
> the node config at run time. The secret value never enters the stored workflow JSON and is
> redacted from logs. And the storage backend is probed at runtime — remote KV, local disk, or
> ephemeral — and the product tells you which one it got and why."

---

## 9. HONESTY — 11:30 → 12:30

**Screen:** `/runs` (or the run detail from §4)

> "One principle, and I'll close on it."

- Point at the **Delivery: Simulated** badge on the run.
  > "With no Resend key configured, this run did **not** send an email. The node logged
  > 'SIMULATED — nothing was delivered', the node result carries `simulated: true`, and the run
  > is flagged `anySimulated: true`. The UI shows a SIMULATED badge.
  >
  > With a key present, the *same node, same graph, same code path* does a live API call — and
  > the badge flips to Live.
  >
  > I would rather show you a limitation than fake a success. A platform that quietly pretends
  > to have sent your email is worse than one that tells you it didn't."

---

## 10. CLOSE — 12:30 → 13:30

**Screen:** home `/`

> "Round 1 I gave you a visual workflow builder.
> Round 2 I gave you the four things you asked for:
>
> - **Verify** — 226 conformance checks, 100%, wired to a real readiness probe.
> - **Harden** — timeout ceilings, retries, HMAC webhooks, secrets, durable storage, real SMTP.
> - **Measure** — 6 workloads, p50/p95/p99, and 4 hard guarantees that must hold every run.
> - **Present** — deliberate failure injection and a 14-code root-cause diagnosis.
>
> Everything runs offline. No API key, no database, no cloud account. Clone it and run it.
>
> My honest next steps are on slide 11 — a real scheduler, true per-item iteration, multi-tenant
> auth, and horizontal scale. I'm not going to pretend those are done."

---

## 11. HANDOFF TO Q&A — 13:30 → 14:15

> "Happy to go deep on any of it — the engine, the conformance suite, the reliability model,
> the storage probe, or the security model. What's most useful to you?"

**Keep these tabs open for Q&A:**
- `/health` — for "how do you know it works?"
- `/benchmarks` — for "how do you know it's fast?"
- `/editor` — for "show me the engine"
- `DISCLOSURE.md` in the repo — for "what doesn't it do?"

---

## 12. IF YOU GO OVER — cut in this order

| Priority | Cut | Saves |
|---|---|---|
| 1 | §8c secrets & storage | 30 s |
| 2 | §3 beat 3b (the optional real error) | 20 s |
| 3 | §6c percentile discipline | 15 s |
| 4 | §5c drill-in (keep §5d — the honest skip) | 45 s |
| 5 | §2d auto-layout | 30 s |

**Never cut:** §5d (the skipped checks), §6b (the guarantees), §7 (failure injection + diagnosis),
§9 (honesty). Those are the three moments that separate this from a feature list.

---

## 13. THINGS NOT TO SAY

| ✗ Don't say | ✓ Say instead |
|---|---|
| "It handles millions of requests per second" | "The benchmark lab measures 16,667 executions/sec on a single node in-process." |
| "The AI node summarises anything" | "The AI node falls back to a deterministic offline mock when no provider key is configured, and labels it." |
| "It has 21 nodes" as the headline | "It has 21 nodes **and a suite that proves each one**." |
| "It's production ready" | "It's built to production standards in the areas the panel asked about, and I've published exactly what isn't finished." |
| "It scales horizontally" | "It doesn't yet. That's slide 11." |
