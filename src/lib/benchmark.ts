/**
 * FlowForge Benchmark Lab.
 *
 * The Measure half of "verify and measure": deterministic, offline workloads
 * executed through the real engine, reported as percentiles rather than a
 * single flattering number. Averages hide tail latency; p95 and p99 are what
 * actually decide whether an automation is safe to schedule.
 *
 * Every workload runs against an injected fetch stub, so results are stable
 * and reproducible on any machine with no network access.
 *
 * On top of the percentile suite the lab asserts three *guarantees* — claims
 * that must hold on every run, not on average:
 *
 *   • a node timeout is enforced (a 20 ms budget cannot stall for 2 s)
 *   • a rejected failure is classified, not thrown away
 *   • continue-on-error turns a hard failure into a partial run
 */

import type { FlowNode, FlowEdge } from "./types";
import { executeWorkflow } from "./engine";
import { makeNode, makeEdge } from "./templates";
import { makeStubFetch } from "./conformance";

/* ---------------------------------- types --------------------------------- */

export interface BenchmarkSample {
  durationMs: number;
  nodeCount: number;
  status: string;
  ok: boolean;
}

export interface NodeTiming {
  label: string;
  type: string;
  calls: number;
  p50: number;
  p95: number;
  max: number;
}

export interface BenchmarkStats {
  iterations: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  stdDev: number;
  throughputPerSec: number;
}

export interface BenchmarkResult {
  id: string;
  name: string;
  description: string;
  nodes: number;
  iterations: number;
  stats: BenchmarkStats;
  samples: BenchmarkSample[];
  perNode: NodeTiming[];
  failures: number;
}

export interface Guarantee {
  id: string;
  claim: string;
  /** what we measured */
  observed: string;
  passed: boolean;
  /** the tolerance the claim was tested against */
  budget: string;
  measuredMs: number;
}

export interface BenchmarkReport {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  iterations: number;
  results: BenchmarkResult[];
  guarantees: Guarantee[];
  failedGuarantees: number;
  environment: {
    executor: string;
    nodeTypes: number;
    runtime: string;
    generatedAt: string;
  };
  ok: boolean;
}

export interface BenchmarkOptions {
  iterations?: number;
  warmup?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (name: string, index: number, total: number) => void;
}

/* ------------------------------- workloads -------------------------------- */

interface Workload {
  id: string;
  name: string;
  description: string;
  /** heavier workloads get fewer iterations so the lab stays quick */
  iterations?: number;
  build: () => { nodes: FlowNode[]; edges: FlowEdge[] };
}

const N = (type: string, x: number, y: number, config: Record<string, unknown> = {}) =>
  makeNode(type, { x, y }, config);

/** Deterministic pseudo-random rows — same data on every machine. */
function rows(count: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let seed = 42;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const r = seed / 2147483648;
    out.push({
      id: i + 1,
      name: `row-${i + 1}`,
      amount: Math.round(r * 1000) / 10,
      region: ["eu", "us", "apac"][i % 3],
      active: r > 0.25,
    });
  }
  return out;
}

const WORKLOADS: Workload[] = [
  {
    id: "linear-5",
    name: "Linear chain (5 nodes)",
    description:
      "Trigger → set fields → template → code → log. The baseline cost of a straight-line automation.",
    build: () => {
      const t = N("trigger.manual", 0, 0, { payload: '{"name":"Ada","plan":"pro"}' });
      const s = N("data.set", 1, 0, { fields: { greeting: "hello {{name}}" } });
      const tpl = N("data.template", 2, 0, { template: "{{greeting}} / {{plan}}", outputKey: "line" });
      const c = N("data.code", 3, 0, { code: "return { ...input, upper: String(input.line).toUpperCase() };" });
      const l = N("action.log", 4, 0, { message: "{{upper}}", level: "debug" });
      return {
        nodes: [t, s, tpl, c, l],
        edges: [
          makeEdge(t.id, s.id),
          makeEdge(s.id, tpl.id),
          makeEdge(tpl.id, c.id),
          makeEdge(c.id, l.id),
        ],
      };
    },
  },
  {
    id: "branch-filter",
    name: "Conditional routing (if + filter)",
    description:
      "Trigger → filter → if → two branches. Measures branch resolution and edge activation.",
    build: () => {
      const t = N("trigger.manual", 0, 0, { payload: '{"amount":250,"region":"eu"}' });
      const f = N("logic.filter", 1, 0, { left: "{{amount}}", operator: "gt", right: "100" });
      const i = N("logic.if", 2, 0, { left: "{{region}}", operator: "equals", right: "eu" });
      const a = N("data.template", 3, -60, { template: "EU priority {{amount}}", outputKey: "route" });
      const b = N("data.template", 3, 60, { template: "standard {{amount}}", outputKey: "route" });
      return {
        nodes: [t, f, i, a, b],
        edges: [
          makeEdge(t.id, f.id),
          makeEdge(f.id, i.id),
          makeEdge(i.id, a.id, "true"),
          makeEdge(i.id, b.id, "false"),
        ],
      };
    },
  },
  {
    id: "fanout-merge",
    name: "Fan-out → merge (4 branches)",
    description:
      "One trigger into four independent transforms, recombined by a merge node.",
    build: () => {
      const t = N("trigger.manual", 0, 0, { payload: '{"base":10}' });
      const branches = [0, 1, 2, 3].map((k) =>
        N("data.set", 1, -120 + k * 80, { fields: { [`b${k}`]: "{{base}}" } })
      );
      const m = N("logic.merge", 2, 0, { strategy: "combine" });
      return {
        nodes: [t, ...branches, m],
        edges: [
          ...branches.map((b) => makeEdge(t.id, b.id)),
          ...branches.map((b) => makeEdge(b.id, m.id)),
        ],
      };
    },
  },
  {
    id: "transform-1k",
    name: "Transform 1,000 records",
    description:
      "A single code node mapping and filtering 1,000 rows. Tests per-node throughput on realistic data.",
    build: () => {
      const t = N("trigger.manual", 0, 0, {
        payload: JSON.stringify({ rows: rows(1000) }),
      });
      const c = N("data.code", 1, 0, {
        code:
          "const rows = input.rows || [];\n" +
          "return { count: rows.length, total: rows.reduce((s,r)=>s+r.amount,0), " +
          "active: rows.filter(r=>r.active).length };",
      });
      return { nodes: [t, c], edges: [makeEdge(t.id, c.id)] };
    },
  },
  {
    id: "batch-10k",
    name: "Batch split 10,000 items",
    description: "Slices a 10,000-element array down to a bounded batch of 1,000.",
    build: () => {
      const t = N("trigger.manual", 0, 0, {
        payload: JSON.stringify({ items: rows(10000).map((r) => r.id) }),
      });
      const b = N("logic.loop", 1, 0, { arrayPath: "items", maxIterations: 1000 });
      return { nodes: [t, b], edges: [makeEdge(t.id, b.id)] };
    },
  },
  {
    id: "ai-offline",
    name: "AI node (offline mock)",
    description:
      "Summarisation through the deterministic offline AI path — no network, no API key.",
    build: () => {
      const t = N("trigger.manual", 0, 0, {
        payload: JSON.stringify({
          review: "The product is great and the support team was excellent.",
        }),
      });
      const ai = N("ai.generate", 1, 0, { prompt: "Summarize: {{review}}", mode: "smart" });
      return { nodes: [t, ai], edges: [makeEdge(t.id, ai.id)] };
    },
  },
];

/* -------------------------------- statistics ------------------------------- */

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return round(sorted[idx]);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summarise(samples: BenchmarkSample[]): BenchmarkStats {
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const total = durations.reduce((a, b) => a + b, 0);
  const mean = durations.length ? total / durations.length : 0;
  const variance =
    durations.length > 1
      ? durations.reduce((acc, d) => acc + (d - mean) ** 2, 0) / (durations.length - 1)
      : 0;
  return {
    iterations: durations.length,
    min: round(durations[0] ?? 0),
    max: round(durations[durations.length - 1] ?? 0),
    mean: round(mean),
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    stdDev: round(Math.sqrt(variance)),
    throughputPerSec: mean > 0 ? round(1000 / mean) : 0,
  };
}

/* --------------------------------- runner --------------------------------- */

export async function runBenchmarks(
  opts: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
  const iterations = Math.max(1, opts.iterations ?? 20);
  const warmup = Math.max(0, opts.warmup ?? 3);
  const fetchImpl = opts.fetchImpl ?? makeStubFetch();
  const startedAt = Date.now();
  const results: BenchmarkResult[] = [];

  let index = 0;
  for (const w of WORKLOADS) {
    index++;
    opts.onProgress?.(w.name, index, WORKLOADS.length);
    const { nodes, edges } = w.build();
    const perRun = Math.max(1, w.iterations ?? iterations);

    const samples: BenchmarkSample[] = [];
    const timing = new Map<string, number[]>();

    for (let i = 0; i < perRun + warmup; i++) {
      const isWarmup = i < warmup;
      const record = await executeWorkflow(
        nodes,
        edges,
        { workflowId: `bench-${w.id}`, workflowName: w.name },
        { trigger: "benchmark", fetchImpl }
      );

      if (isWarmup) continue;

      samples.push({
        durationMs: record.durationMs ?? 0,
        nodeCount: record.results.length,
        status: record.status,
        ok: record.status === "success" || record.status === "partial",
      });

      for (const r of record.results) {
        const key = `${r.label}|${r.nodeType}`;
        const arr = timing.get(key) ?? [];
        arr.push(r.durationMs ?? 0);
        timing.set(key, arr);
      }
    }

    const perNode: NodeTiming[] = [...timing.entries()].map(([key, durations]) => {
      const [label, type] = key.split("|");
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        label,
        type,
        calls: durations.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: round(sorted[sorted.length - 1] ?? 0),
      };
    });
    perNode.sort((a, b) => b.p95 - a.p95);

    results.push({
      id: w.id,
      name: w.name,
      description: w.description,
      nodes: nodes.length,
      iterations: perRun,
      stats: summarise(samples),
      samples,
      perNode,
      failures: samples.filter((s) => !s.ok).length,
    });
  }

  const guarantees = await measureGuarantees(fetchImpl);

  const finishedAt = Date.now();
  const failedGuarantees = guarantees.filter((g) => !g.passed).length;
  const anyFailures = results.some((r) => r.failures > 0);

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    iterations,
    results,
    guarantees,
    failedGuarantees,
    environment: {
      executor: typeof window === "undefined" ? "server" : "browser",
      nodeTypes: new Set(WORKLOADS.flatMap((w) => w.build().nodes.map((n) => n.data.type)))
        .size,
      runtime: typeof process !== "undefined" ? process.version : "browser",
      generatedAt: new Date().toISOString(),
    },
    ok: failedGuarantees === 0 && !anyFailures,
  };
}

/* ------------------------------- guarantees ------------------------------- */

/**
 * Claims that must hold on *every* run. These are the difference between
 * "usually fast" and "will not hang production".
 */
async function measureGuarantees(fetchImpl: typeof fetch): Promise<Guarantee[]> {
  const out: Guarantee[] = [];

  /* 1. a node timeout is a hard ceiling */
  {
    const t = N("trigger.manual", 0, 0, { payload: "{}" });
    const slow = N("action.delay", 1, 0, { ms: 2000 });
    slow.data.policy = { timeoutMs: 20, maxRetries: 0 };
    const start = Date.now();
    const rec = await executeWorkflow(
      [t, slow],
      [makeEdge(t.id, slow.id)],
      { workflowId: "bench-timeout", workflowName: "Timeout guarantee" },
      { trigger: "benchmark", fetchImpl }
    );
    const elapsed = Date.now() - start;
    const result = rec.results.find((r) => r.nodeId === slow.id);
    const enforced = elapsed < 500 && result?.diagnosis?.code === "TIMEOUT";
    out.push({
      id: "timeout-enforced",
      claim: "A node with a 20 ms budget cannot stall the run for 2,000 ms",
      observed: enforced
        ? `run aborted after ${elapsed} ms with diagnosis ${result?.diagnosis?.code}`
        : `run took ${elapsed} ms, diagnosis ${result?.diagnosis?.code ?? "none"}`,
      passed: enforced,
      budget: "< 500 ms wall clock, TIMEOUT diagnosis",
      measuredMs: elapsed,
    });
  }

  /* 2. an unexpected failure is always classified */
  {
    const t = N("trigger.manual", 0, 0, { payload: "{}" });
    const bad = N("data.code", 1, 0, { code: "throw new Error('boom: unexpected token');" });
    const rec = await executeWorkflow(
      [t, bad],
      [makeEdge(t.id, bad.id)],
      { workflowId: "bench-diag", workflowName: "Diagnosis guarantee" },
      { trigger: "benchmark", fetchImpl }
    );
    const result = rec.results.find((r) => r.nodeId === bad.id);
    const code = result?.diagnosis?.code;
    out.push({
      id: "failure-classified",
      claim: "Every node failure carries a structured root-cause diagnosis",
      observed: code
        ? `${code} — "${result?.diagnosis?.cause.slice(0, 60)}…"`
        : "no diagnosis attached",
      passed: !!code && code !== "UNKNOWN" && !!result?.diagnosis?.fix,
      budget: "non-UNKNOWN code plus a suggested fix",
      measuredMs: rec.durationMs ?? 0,
    });
  }

  /* 3. continue-on-error degrades to a partial run instead of dying */
  {
    const t = N("trigger.manual", 0, 0, { payload: '{"keep":"me"}' });
    const bad = N("data.code", 1, 0, { code: "throw new Error('boom');" });
    bad.data.policy = { continueOnError: true };
    const after = N("action.log", 2, 0, { message: "survived {{keep}}", level: "info" });
    const start = Date.now();
    const rec = await executeWorkflow(
      [t, bad, after],
      [makeEdge(t.id, bad.id), makeEdge(bad.id, after.id)],
      { workflowId: "bench-tolerate", workflowName: "Tolerance guarantee" },
      { trigger: "benchmark", fetchImpl }
    );
    const degraded = rec.status === "partial" && (rec.toleratedCount ?? 0) === 1;
    out.push({
      id: "tolerated-partial",
      claim: "With continue-on-error set, a failed node yields a PARTIAL run and the flow continues",
      observed: `status=${rec.status}, tolerated=${rec.toleratedCount ?? 0}, downstream ran=${rec.results.length === 3}`,
      passed: degraded && rec.results.length === 3,
      budget: "status = partial, downstream still executed",
      measuredMs: Date.now() - start,
    });
  }

  /* 4. delivery honesty — a simulated side effect must never be reported as real */
  {
    const t = N("trigger.manual", 0, 0, { payload: '{"email":"a@b.co"}' });
    // transport "mock" is pinned so a benchmark can never send real mail, even
    // on a machine that happens to have a live mail credential configured.
    const mail = N("action.email", 1, 0, {
      to: "{{email}}",
      subject: "s",
      transport: "mock",
    });
    const rec = await executeWorkflow(
      [t, mail],
      [makeEdge(t.id, mail.id)],
      { workflowId: "bench-mail", workflowName: "Delivery honesty guarantee" },
      { trigger: "benchmark", fetchImpl }
    );
    const result = rec.results.find((r) => r.nodeId === mail.id);
    const honest = result?.simulated === true && rec.anySimulated === true;
    out.push({
      id: "simulation-labelled",
      claim:
        "A simulated side effect is flagged as simulated on the node and on the run — never reported as a real delivery",
      observed: honest
        ? `simulated=${result?.simulated}, run flagged anySimulated=${rec.anySimulated}`
        : `simulated=${String(result?.simulated)}, anySimulated=${String(rec.anySimulated)}`,
      passed: honest,
      budget: "simulated flag set on the node and on the run",
      measuredMs: rec.durationMs ?? 0,
    });
  }

  return out;
}

/** The workload catalogue, exposed so the UI can describe what it will run. */
export function workloadCatalogue(): { id: string; name: string; description: string }[] {
  return WORKLOADS.map((w) => ({ id: w.id, name: w.name, description: w.description }));
}
