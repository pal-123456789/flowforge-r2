# FlowForge — Round 2 Q&A Bank
**Baloon National Hackathon 2026 · 10-minute technical Q&A**

> **How to use this file.** Each entry has the **question**, a **short answer** (say this if you
> have 20 seconds), a **longer answer** (if they push), and a **proof tab** — the page to open so
> your answer is not just words. Open the proof tab *while* you answer; it is far more convincing
> than any claim.
>
> Numbers used here are the measured ones from this build:
> **21 node types · 226 conformance checks passed / 0 failed / 2 skipped · 100% score ·
> worst p95 = 2 ms · 4/4 guarantees held · 14 diagnosis codes · 8 shipped templates.**

---

## A. ARCHITECTURE & ENGINE

### Q1. You say you built a "DAG engine from scratch". Why not use BullMQ, Temporal, or n8n?

**Short:** Because the panel's question was about *this problem*, and the engine is the part that
makes the guarantees possible. A from-scratch engine let me put a per-node reliability policy and
a root-cause classifier *inside* the execution loop — that's where the interesting behaviour lives,
and it would have taken longer to bolt onto a third-party orchestrator than to write 400 lines.

**Longer:** The engine is four steps. (1) `analyzeGraph` does a Kahn topological sort with cycle
detection — an invalid graph never runs. (2) Branch routing activates edges by *handle id*, so an
untaken branch is genuinely skipped rather than executed-and-ignored. (3) Each node executes inside
a **policy wrapper** — timeout ceiling, retry with exponential backoff, continue-on-error. (4)
Every failure is passed through a **classifier** that returns a structured diagnosis instead of a
string. Because the wrapper and classifier are mine, the conformance suite can assert on them
directly: 226 checks, 0 failing, and it's a real readiness probe at `/api/health` (503 on failure).

**Proof tab:** `/health` → the four contract layers.
**Honest caveat:** Temporal and BullMQ give durability, distributed execution and a UI I don't
have. My engine is single-process. I say that on the roadmap slide rather than hiding it.

---

### Q2. How does a workflow actually get executed — server, browser, or both?

**Short:** Both, and they're the *same* code path. `executeWorkflow()` is one function; the
browser calls it directly, the API routes call it on the server. The conformance suite calls it
too, with a hermetic `fetch` injected so all 226 checks run offline with zero network traffic.

**Longer:** That's deliberate — it's what makes the test suite meaningful. The suite doesn't
mock the engine, it runs the real engine with a fake network. The only difference between hosts
is who calls it and where results are persisted. `RunRecord.executor` records which was used
(`"browser"` or `"server"`), so a run never lies about where it executed.

**Proof tab:** `/health` → run a check; or open the same workflow in `/editor` and hit `Ctrl+Enter`,
then hit the same workflow's webhook URL — same graph, same result.

---

### Q3. What happens if the graph has a cycle?

**Short:** It never runs. `analyzeGraph` detects the cycle in the topological sort and the editor's
Validation panel refuses the run. You get the specific nodes involved, not a generic error.

**Longer:** Kahn's algorithm processes nodes with in-degree zero and decrements neighbours as
edges are consumed. If the run ends with nodes still holding in-degree, those nodes form a cycle
and that's reported with their ids. This is one of the platform-wide cross-checks in the
conformance suite, so the behaviour is asserted, not assumed.

**Proof tab:** `/health` → platform checks → cycle detection.

---

## B. RELIABILITY

### Q4. You added timeouts. What happens when a node blows its budget?

**Short:** The run doesn't hang. The budget is a hard ceiling enforced with an `AbortController` —
the node is aborted and the failure is classified as `TIMEOUT`. The run continues to the next
branch with a diagnosis attached.

**Longer:** The guarantee is measured, not asserted: *"a node with a 20 ms budget cannot stall the
run for 2 000 ms."* The benchmark lab runs a node with a 2 000 ms workload against a 20 ms
budget and asserts the run aborts in under 500 ms **with a TIMEOUT diagnosis**. Measured last
build: **24 ms**. That is one of the four hard guarantees, and the lab reports a violation if it
ever stops holding.

**Proof tab:** `/benchmarks` → guarantee #1.

---

### Q5. How do retries differ from just re-running the workflow?

**Short:** Retries are per node, per policy, and bounded — max 5, exponential backoff, and a
selector for *what* to retry on (always / error / timeout). A re-run is the whole graph from the
top with a different input.

**Longer:** Every node result records its **attempt count**, so the UI can say "retried — 3 attempts
before this outcome" instead of hiding the flakiness. Backoff is exponential from a 300 ms base
up to a 5 s cap, because retrying a failing dependency in a tight loop is how you turn a small
outage into a large one.

**Proof tab:** `/editor` → any node → Inspector → **Reliability** panel.

---

### Q6. What's "partial" run status, and when do you use it?

**Short:** When a node fails but the policy says `continueOnError`, the run doesn't die. Downstream
nodes receive the failure in an `_error` carrier, the run is marked `partial` rather than `error`,
and the run record tracks `toleratedCount` separately from `errorCount`.

**Longer:** This matters because a workflow is often "best effort" — enrich 500 records, and 3 of
them fail. Killing the run discards 497 good results. A partial run keeps them, but marks the run
honestly as partial so nobody downstream reads it as a clean success. It's the difference between
"it worked" and "it worked, except here, and here is why".

**Proof tab:** `/benchmarks` → guarantee #3 (`status=partial, tolerated=1, downstream ran=true`).

---

### Q7. How does the Approval node pause a run — and what if nobody comes back?

**Short:** The run is persisted with status `paused` and a `pendingApproval` record (node, request
text, timestamp, payload). It survives a server restart, because it's in the run store, not in
memory. Nobody coming back just means it stays paused — it never auto-resumes.

**Longer:** That's the important property. A pause held only in process memory would evaporate on
redeploy, which is exactly the case where you'd need it most. The decision, the note, and who
made it are written back onto the original run as an audit trail, and the original run records the
id of the run that continued it. Resuming re-executes *from* the approval node and stitches the
earlier results back in, so the resumed timeline reads as one continuous run with correct
topological ordering.

**Proof tab:** `/runs/<id>` of a paused run → the Approval panel.

---

## C. SECURITY & STORAGE

### Q8. How are inbound webhooks authenticated?

**Short:** HMAC-SHA256 over the raw request body, `sha256=<hex>` in an `x-flowforge-signature`
header, compared in constant time. Missing or wrong signature → **401**. There's also an optional
replay window via `x-flowforge-timestamp`.

**Longer:** The raw body matters — signing a re-serialised JSON object is a classic bug because
key order and whitespace change the hash. The comparison uses `crypto.timingSafeEqual` with a
length pre-check, so it's not vulnerable to timing oracles. A 300-second skew window is enforced
whenever the sender includes a timestamp, which defeats recorded-and-replayed requests. If no
secret is configured the endpoint still works — but every response says `"authMode": "unsigned"`
and the UI surfaces that state. An unauthenticated ingress should never *look* normal.

**Proof tab:** terminal — the demo script §8b has the two curl commands ready.

---

### Q9. How do you handle secrets, and how do you know they don't leak?

**Short:** Secrets come from `FF_SECRET_*` environment variables and are referenced as
`{{secrets.NAME}}`. They are substituted into a **copy** of the node config at execution time, so
the value never enters the stored workflow JSON, the run input/output panels, or exported files.
Logs are redacted.

**Longer:** The substitution happens against a deep-cloned config, immediately before the executor
runs. The persisted artefact is the template with the placeholder still in it. There's a
`maskSecretRefs` helper so even a UI that wants to show you "which secrets does this node use?"
shows names, not values. In the browser no secrets resolve, so a node that needs one fails with
an **AUTH** diagnosis rather than silently sending nothing — which is the failure mode I'd be most
worried about in a less careful system.

**Proof tab:** `src/lib/secrets.ts`; the AUTH diagnosis in `/editor`.

---

### Q10. Where is the data stored, and what happens on Vercel?

**Short:** The backend is **probed at runtime**, not hard-coded, and the product reports which one
it got. Order: remote KV (Upstash / Vercel KV REST) → local disk → OS temp → in-process memory.
Remote KV is durable across redeploys and instances; disk is durable on a VM; temp and memory are
ephemeral and the UI says so.

**Longer:** The probe writes a uniquely-named file, confirms it can be read back, and treats a
transient unlink failure as non-fatal (Windows indexers can hold a file open — that actually bit
us during development). The `StorageInfo` includes a plain-English `reason` for *why* a better
backend was rejected, surfaced in the UI — "storage degrades, it doesn't crash". On Vercel
serverless, local disk is ephemeral, so the honest answer is: set `KV_REST_API_URL` and
`KV_REST_API_TOKEN` for durability, and the app will tell you if you haven't.

**Proof tab:** `/health` → runtime → storage block.

---

### Q11. There's no authentication. Isn't that disqualifying?

**Short:** Yes, for a multi-user SaaS — and that's exactly what I said on the roadmap slide. This
build is a single-tenant deployment. I'd rather ship the reliability and evidence work well and
name the gap than bolt on a half-finished login that gives a false sense of security.

**Longer:** The security work that *is* done is the part that needs no identity to be meaningful:
signed ingress, secret isolation, redacted logs. Adding auth means adding identity, per-user
secret scoping, and per-tenant run isolation — a real project, not a weekend. It's on slide 11
of the deck, by name.

---

## D. DIAGNOSIS

### Q12. Your "diagnosis" feature — is it just regex over error strings?

**Short:** Mostly, yes, and that's a fair question. But it's regex over *classified* signals, with
an explicit override: if the error message contains a `Category:` prefix — like
`throw new Error("Auth: no API key")` — that prefix is authoritative and wins over the pattern
match.

**Longer:** There are **14 codes**: TIMEOUT, NETWORK, HTTP_STATUS, AUTH, RATE_LIMIT, INVALID_URL,
VALIDATION, CODE_SYNTAX, CODE_RUNTIME, EXPRESSION, FILE_WRITE, MISSING_INPUT, INJECTED, UNKNOWN.
Each carries a cause, a concrete fix, a severity, and a `retryable` flag — so the UI can say
"retryable" only where retrying actually helps. The prefix-override exists because a human who
knows their system knows better than a pattern; the tool should defer to them. The classifier
ships with real failures found during development, including two that the conformance suite caught
— one AUTH error misclassified as MISSING_INPUT.

**Proof tab:** `/editor` → set Failure injection → error → run → the diagnosis card.

---

### Q13. Why is "UNKNOWN" a diagnosis at all?

**Short:** Because claiming to know the cause when you don't is worse than admitting it. UNKNOWN
is an explicit "I couldn't classify this" with a severity, and it still surfaces the raw error
text.

**Longer:** The benchmark lab asserts that a failure carries a **non-UNKNOWN** code *with* a
suggested fix — so UNKNOWN is allowed to exist, but the lab's own scenarios must not produce it.
That's the difference between "the classifier can fail" and "the classifier fails silently".

**Proof tab:** `/benchmarks` → guarantee #2.

---

## E. TESTING & MEASUREMENT

### Q14. 226 checks — is that a real suite or padding?

**Short:** Real, and I'd rather show the structure than defend the number. It's **35 hand-written
behaviour cases** plus structural contracts across **21 node types**, and the structural part
scales with node count while the behaviour part is the part that actually costs.

**Longer:** Four layers: (1) registry — label, description, icon actually exists in the icon map,
unique non-empty output handles, valid category, correct input arity; (2) schema — shipped
defaults are format- and range-clean, and a `required` field with no safe default is *reported*,
not failed; (3) executor — registered, returns a well-formed result, deterministic for identical
input; (4) behaviour — the 35 cases. Plus platform cross-checks: no duplicate type ids, every
executor maps to a declared type, all 8 shipped templates are structurally valid with resolvable
edge handles, and policy clamping bounds hold.

**Proof tab:** `/health` → click a node type → expand the individual checks.

---

### Q15. Why are 2 checks skipped? Isn't skipping a failure?

**Short:** No — it's the opposite. One of them executes `writeFile`, which would write a real file
to disk. A health check that mutates data is a bad health check, so it's skipped *by design* and
**reported on the dashboard** rather than hidden.

**Longer:** The distinction I care about is between a check that can't run and a check that was
removed. A removed check is invisible. This one is visible, counted, and labelled. The 2 skips
appear on the `/health` page as a distinct count with a "by design" note, and the suite reports
`skipped: 2` in the API response — so a monitor can alert on it changing.

**Proof tab:** `/health` → the "skipped by design" metric card and the footnote.

---

### Q16. Your benchmarks show 1–2 ms. Isn't that suspiciously fast?

**Short:** Fair challenge. The honesty is *in the label*: these are the **engine's own overhead**,
not end-to-end request latency. A workload of 6 workloads, 50 iterations, no network.

**Longer:** What's being measured is the engine: topological sort, routing, template resolution,
the policy wrapper, and the classifier — across a linear chain, conditional routing, fan-out to
merge, a 1 000-record transform, a 10 000-item batch split, and an AI node running on its offline
mock. The AI node's 0–1 ms p95 is exactly the point: it's a **mock**, labelled as such, and I'm
not going to present a mock's latency as a model's. The numbers I'd actually defend are the
**guarantees** — the timeout ceiling, the diagnosis classifier, the partial-run semantics, the
simulation flag — because those are properties, not timings.

**Proof tab:** `/benchmarks` → the workload descriptions, which say what each one does and
doesn't include.

---

### Q17. What does "offline-capable" actually mean? Can I demo this on a plane?

**Short:** Yes. No database, no paid key, no API call is required for any core feature. The
conformance suite and benchmark lab both inject a hermetic `fetch`, so they run with zero network
traffic.

**Longer:** The email node is the one that would need a credential — and there it degrades to
`mock` transport, which is **labelled as simulated** in the log, on the node result, on the run
record, and as a badge in the UI. The AI node behaves the same way with its deterministic
on-device mock. So a demo on a plane is a legitimate demo, and the product tells the truth about
which parts were live.

**Proof tab:** the run detail **Delivery** stat card.

---

## F. PRODUCT & HONESTY

### Q18. You renamed a node. Why?

**Short:** Because the old name was a lie. The node was called "Loop / Iterator" and its
description said it ran downstream nodes for each item. It doesn't — it slices an array into a
bounded batch and passes it downstream in a single pass. I renamed it **Batch Split** and
rewrote the description.

**Longer:** It was a small thing, but it's the clearest example of the standard I applied across
the whole build: the documentation should describe what the code does, not what I hoped it would
do. The same standard produced the `DISCLOSURE.md` file, which lists every limitation — including
that Batch Split doesn't iterate per item, that secrets need env vars and aren't available in the
browser, that durable storage needs KV credentials, that 2 checks are skipped, and that email is
live only with a Resend key or gateway URL. All of that is in the repository, publicly, so it's
auditable rather than a verbal assurance.

**Proof tab:** `DISCLOSURE.md` in the repo.

---

### Q19. If a simulated action is so heavily labelled, is the product actually useful without credentials?

**Short:** Yes — and the distinction is between *simulated* and *fake*. A simulated email still
executes the full node path: the recipient is validated, the template is resolved, the branch
logic runs, the run is recorded. Only the final HTTP POST is replaced.

**Longer:** The credential only changes the transport, not the graph. Same node, same code path,
one branch swapped — and the UI always says which one ran. That's the point of the labelling
rule: a developer can trust the *flow* without a key, and can trust the *delivery* because the
product never claims more than it did.

**Proof tab:** deck slide 8, or the run detail Delivery badge.

---

### Q20. If you had another 24 hours, what would you build?

**Short:** A real scheduler, and true per-item iteration. Those are the two places where the
product is honest-but-incomplete, and they're the two that would block a real production
deployment.

**Longer:** The scheduler: cron and interval triggers are modelled, validated, and have a correct
cron expression checker — but the server doesn't poll on a wall clock yet. That needs a durable
scheduler with leader election so two instances don't double-fire. True iteration: Batch Split
hands a bounded batch downstream in one pass; a real Loop node with per-item context and bounded
concurrency is the honest upgrade. After those: multi-tenant auth and per-tenant secret scoping,
then horizontal scale — which needs a durable queue and a lease-based executor, a real project
rather than a weekend. It's on the roadmap slide with the same wording I just used.

**Proof tab:** deck slide 11.

---

## QUICK-FACT SHEET (memorise these)

| Fact | Value |
|------|-------|
| Node types | 21 (4 trigger, 6 action, 5 logic, 5 data, 1 AI) |
| Conformance | 226 passed · 0 failed · 2 skipped · 100% score · ~1.65 s |
| Contract layers | 4 (registry, schema, executor, behaviour) |
| Hand-written behaviour cases | 35 |
| Diagnosis codes | 14 |
| Templates shipped | 8 |
| Node policy | timeout ≤120 s · retries 0–5 · backoff ≤5 s · continue-on-error |
| Default timeout | 15 000 ms (max 120 000 ms) |
| Webhook auth | HMAC-SHA256 over raw body · 300 s replay window · 401 on failure |
| Secrets | `FF_SECRET_*` env vars · never persisted · redacted from logs |
| Storage | KV → disk → temp → memory, probed at runtime, mode surfaced |
| Benchmarks | 6 workloads · p50/p95/p99 · worst p95 = 2 ms |
| Guarantees | 4/4 held · timeout measured at 24 ms against a 2 000 ms workload |
| Engine | Kahn topological sort · edge-activation routing · cycle detection |
| Stack | Next.js 14.2.15 · React Flow 11 · Zustand 4 · Tailwind 3.4 · TypeScript |
| Offline | 100% — no key, no DB, no network required for any core feature |

## THE THREE ANSWERS TO KEEP SHARP

If you only remember three, make it these:

1. **"How do you know it works?"** → 226 automated checks, 0 failing, wired to a readiness probe
   that returns 503 on failure. Not a claim — a gate.
2. **"How do you know it's fast?"** → 6 workloads, percentiles not averages, and 4 guarantees
   that must hold every run. The timeout ceiling is measured: 24 ms against a 2 000 ms workload.
3. **"How do I know it isn't lying to me?"** → Every simulated side effect is labelled in the
   log, on the node, on the run, and in the UI. And every limitation is published in the repo.
