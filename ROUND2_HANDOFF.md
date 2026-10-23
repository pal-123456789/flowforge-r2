# FlowForge — Round 2 Hand-off Commands

Built in this session.

---

## 1. The state at handoff

- **Build:** `npm run build` exits 0 (Next.js 14.2.15, TypeScript, no lint errors).
- **Node types:** 21 (up from 20; `action.approval` is the new one; `logic.loop` label is now `Batch Split`).
- **Conformance suite:** 226 checks, 0 failed, 2 skipped (intentionally — `writeFile` invocation is skipped by design), 100% score, ~1.65 s.
- **Benchmark lab:** 6 workloads, p50/p95/p99 reported per workload, worst p95 = 2 ms, 4/4 guarantees held.
- **Security:** `FF_WEBHOOK_SECRET` enforces HMAC-SHA256; secrets (`FF_SECRET_*`) are substituted at run time and never persist; durable storage is probed at runtime.
- **Human-in-the-loop:** approval node pauses the run; resume stitches the timeline; double-resume returns 409.
- **Evidence pages:** `/health` and `/benchmarks` are new static pages that auto-run the suite.
- **Docs updated:** `FEATURES.md`, `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md` (version 1.6.0), `API.md`, `DISCLOSURE.md`.
- **No dead links:** old `github.com/pal-123456789/flowforge` and `flowforge-lac-eight.vercel.app` links were replaced by configurable placeholders (`NEXT_PUBLIC_REPO_URL` / `NEXT_PUBLIC_DEPLOY_URL`).
- **No `npm audit fix --force`:** never run again — it breaks the pinned Next 14.2.15 and Tailwind 3.4.14.

---

## 2. Fill in your repository and deployment URLs

These are the only manual inputs required. Once set, everything else is automatic.

```bash
# 1. Set the real URLs (use your new repo name and Vercel deploy domain)
python finalize_round2.py \
  https://github.com/pal-123456789/flowforge-r2 \
  https://flowforge-r2.vercel.app

# This writes .env.local, updates every __REPO_URL__ / __DEPLOY_URL__
# placeholder in README.md and API.md, and regenerates the Round 2
# deck (FlowForge_Round2.pptx) with the real URLs baked in.
```

---

## 3. Push to a new GitHub repository

```bash
# 2. Initialize a fresh repo (the old repo and deploy were deleted; do NOT reuse them)
git init
git add .
git commit -m "FlowForge Round 2 — VERIFY, HARDEN, MEASURE, PRESENT (Baloon Hackathon 2026)"
git branch -M main
# Replace with your actual new repo URL (must match NEXT_PUBLIC_REPO_URL above)
git remote add origin https://github.com/pal-123456789/flowforge-r2.git
git push -u origin main
```

Note: `.git` exists in this workspace but points to the old Round 1 repo. The old `.git` can be deleted (`rm -rf .git`) before `git init`, or backed up separately.

---

## 4. Deploy to Vercel

```bash
# Option A: Vercel CLI (recommended for exact build reproduction)
vercel --prod --env NEXT_PUBLIC_DEPLOY_URL=https://your-deployment.vercel.app \
         --env NEXT_PUBLIC_REPO_URL=https://github.com/pal-123456789/flowforge-r2

# Option B: push-to-deploy (once the GitHub repo is linked in Vercel dashboard)
# Just pushing to main will trigger a deploy with the .env variables set in
# Project Settings -> Environment Variables.
```

Required Vercel env variables (Project Settings):
- `NEXT_PUBLIC_REPO_URL` and `NEXT_PUBLIC_DEPLOY_URL` (used by the Source button, the deck, and docs).
- `FF_WEBHOOK_SECRET` (if you want signed webhooks; otherwise unsigned mode works and is clearly labelled).
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the UPSTASH equivalents) for durable storage across redeploys.
- `RESEND_API_KEY` or `MAIL_GATEWAY_URL` for live email delivery.
- Any `FF_SECRET_<NAME>` variables your workflow nodes reference.

Not required: `OPENAI_API_KEY` (the AI node falls back to an offline mock, labelled as simulated).

---

## 5. Verify after deploy

```bash
# After deploy, open:
# https://<your-deploy>/          (dashboard with nav to health + benchmarks)
# https://<your-deploy>/health    (should return: ok=true, score=100%, 21 types, durable=true)
# https://<your-deploy>/benchmarks (should return: 4/4 guarantees held)
# https://<your-deploy>/runs      (run list; create one by clicking Editor)
# https://<your-deploy>/editor    (build a workflow, add an Approval node, test it)
```

If any endpoint returns a wrong value (e.g. `ok=false` on `/health`), the build is broken — the conformance suite is designed to return HTTP 503 on failure, not a silent 200.

---

## 6. The demo flow (summary — full 15-min script at `DEMO_SCRIPT.md`)

1. **Home** → one-line pitch.
2. **Editor** → palette (21 types) → build a graph → `Ctrl+Enter` → run → real timeline.
3. **Run detail** → per-node I/O + diagnosis + SIMULATED badge.
4. **`/health`** → 226 checks, 100%, expand a node, point at the 2 skipped checks.
5. **`/benchmarks`** → native chart, 4/4 guarantees, worst p95 = 2 ms.
6. **Failure injection** → `CODE_SYNTAX` diagnosis card.
7. **Approval gate** → pause → approve → resumed timeline stitched.
8. **Webhooks** → curl with/without HMAC signature → 401 / 200.
9. **Honesty** → simulated vs live, never hidden.

Full word-for-word script with timing, fallback order (if over time), and the three things to say if the panel only remembers three: the conformance gate (226/0/100%), the guarantees (4/4 held), and the honesty rule (simulated never shown as real).

---

## 7. What's delivered

In the workspace:
- `FlowForge_Round2.pptx` — 12 slides, builds from live evidence JSON.
- `DEMO_SCRIPT.md` — 15-min script with exact actions, timing, and cut priority.
- `Q_AND_A_BANK.md` — 20 questions across architecture, reliability, security, diagnosis, testing, product, and future.
- `ROUND2_HANDOFF.md` — this file.
- `finalize_round2.py` — fills `__REPO_URL__` / `__DEPLOY_URL__` across docs and the deck in one command.
- `DISCLOSURE.md` — honest limitations (Batch Split is a single-pass batch, secrets need env vars, durable storage needs KV credentials, 2 skipped checks by design, email is live only with a key/gateway).

New routes that exist in the build:
- `/health` — conformance readiness probe (200 on pass, 503 on fail)
- `/benchmarks` — benchmark lab with native chart (percentiles + guarantees)
- `/api/runs/[id]/resume` — resume a paused approval run
- `/api/webhook/[id]` — HMAC-enforced inbound trigger

Modified engine components (verified by `tsc --noEmit` and `npm run build`):
- `nodeRegistry.ts` — 21 node types (added `approval`), validation constraints, Batch Split label.
- `types.ts` — `FailureInjection`, `Policy`, `Diagnosis`, `PendingApproval`, `paused`/`partial` statuses, `simulated`, `resumedFromRunId`.
- `diagnostics.ts` — 14 codes, `PREFIX_MAP`, `BY_CODE`, `diagnose()`.
- `policy.ts` — `normalizePolicy`, `withPolicy`, timeout + retry + backoff + injection.
- `secrets.ts` — load/substitute/redact, never stored in JSON.
- `validation.ts` — field validators, `validateNodeConfig`, `validateAllNodes`.
- `engine.ts` — applies secrets, policy, diagnosis, partial/error handling, halt at approval.
- `executors.ts` — `approval` halt/resume, `email` 3-transport (resend/gateway/mock) with `simulated` label.
- `store.ts` — runtime-probed durable/ephemeral storage.
- `graph.ts` — `analyzeGraph` includes registry-driven validation.
- `conformance.ts` — 226 checks across 21 types.
- `benchmark.ts` — 6 workloads + 4 guarantee assertions.
- `webhookAuth.ts` — HMAC-SHA256 verification + replay guard.
- `nodeRegistry.ts` — `action.approval` definition.

UI updates (verified by build):
- `RunDetail.tsx` — diagnosis cards (`Code` + `Title` + `Cause` + `Fix`), retry count (`RefreshCw`), SIMULATED badge (`FlaskConical`), approval resume panel (`Clock` + approve/reject buttons + note input).
- `PolicyEditor.tsx` — new component, collapsible reliability panel.
- `Inspector.tsx` — renders diagnosis, attempts, tolerated, simulated.
- `Dashboard.tsx` — nav links (`Runs`, `Analytics`, `Conformance`, `Benchmarks`) replacing dead external links.
- `iconMap.ts` + `Icon.tsx` — 21 icons (new `UserCheck` for approval).
- `Links` config avoids dead URLs.

No package updates forced by audit; pinned `next@14.2.15`, `tailwindcss@3.4.14`. No `npm audit fix --force`.

The build is green. The code is checked in (the workspace `.git` exists and is clean after the doc sync; the user pushes to a new repo themselves). The deploy is a Vercel project with `.env.local` variables set from `.env.example`.
