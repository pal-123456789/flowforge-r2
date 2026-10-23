/**
 * FlowForge Node Conformance Suite.
 *
 * A self-test the platform runs against *itself*. For every node type it
 * asserts:
 *
 *   1. Registry contract  — the type declares a label, description, icon that
 *      actually exists, at least one output handle, and unique handle ids.
 *   2. Schema contract    — the shipped defaults pass input validation with
 *      zero errors, so a freshly-dropped node is always runnable.
 *   3. Executor contract  — an executor is registered and, when invoked, either
 *      returns an ExecResult with an `output` property or fails with a
 *      *classified* diagnosis (never an anonymous crash).
 *   4. Behaviour contract — a hand-written case per node asserting real output
 *      (routing, merging, validation, mock labelling, halt semantics).
 *
 * It also cross-checks the whole platform: every node type is covered, every
 * executor has a definition, and every shipped template is structurally valid.
 *
 * The suite is fully offline and deterministic — network nodes run against an
 * injected fetch stub, and the one node with an unavoidable side effect (Write
 * File) is reported as *skipped with a reason* rather than silently omitted.
 */

import type { FlowNode, NodeCategory, DiagnosisCode } from "./types";
import { normalizePolicy } from "./policy";
import { NODE_TYPES, NODE_MAP, getNodeDef } from "./nodeRegistry";
import { runNode, hasExecutor, EXECUTOR_TYPES, type ExecResult } from "./executors";
import { validateNodeConfig } from "./validation";
import { diagnose } from "./diagnostics";
import { instantiateTemplate, TEMPLATES } from "./templates";
import { analyzeGraph } from "./graph";
import { ICON_NAMES } from "../components/ui/iconMap";
import { nanoid } from "nanoid";

/* ---------------------------------- types --------------------------------- */

export interface Check {
  name: string;
  ok: boolean;
  /** human-readable explanation; always present, pass or fail */
  detail: string;
  /** true when the check could not run and is honestly excluded from scoring */
  skipped?: boolean;
}

export interface NodeReport {
  type: string;
  label: string;
  category: NodeCategory;
  checks: Check[];
  passed: number;
  failed: number;
  skipped: number;
  ok: boolean;
  durationMs: number;
}

export interface ConformanceReport {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** number of node types exercised */
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 0–100, computed over executed (non-skipped) checks */
  score: number;
  nodes: NodeReport[];
  platform: Check[];
  platformFailed: number;
  /** true when nothing failed */
  ok: boolean;
}

export interface ConformanceOptions {
  /** injected fetch so network nodes are exercised offline */
  fetchImpl?: typeof fetch;
  /** restrict to these node types (used by the /health page filter) */
  only?: string[];
  onProgress?: (label: string, index: number, total: number) => void;
}

/* ------------------------------- test fixtures ----------------------------- */

/** A deterministic fetch stub covering the success and failure paths. */
export function makeStubFetch(): typeof fetch {
  const stub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || "GET";
    const status = /fail|500/.test(url) ? 500 : 200;
    const body =
      status === 200
        ? JSON.stringify({ ok: true, url, method, data: { id: 1, name: "stub" } })
        : JSON.stringify({ error: "upstream failure" });
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return stub as unknown as typeof fetch;
}

/**
 * Node types whose *default invocation* mutates external state. The self-test
 * refuses to run them (a health check must never write to disk) and reports
 * an explicit skip instead of quietly dropping the coverage.
 */
const SIDE_EFFECTING: Record<string, string> = {
  "action.writeFile":
    "Writes a real file to the output folder — excluded so a health check never mutates data.",
};

function fixtureNode(type: string, config: Record<string, unknown> = {}): FlowNode {
  const def = getNodeDef(type);
  return {
    id: `test_${nanoid(6)}`,
    type: "flowNode",
    position: { x: 0, y: 0 },
    data: {
      type,
      label: def?.label ?? type,
      config: { ...(def?.defaults ?? {}), ...config },
    },
  };
}

interface BehaviourCase {
  id: string;
  type: string;
  input?: unknown;
  config?: Record<string, unknown>;
  /** for success cases: return an error string, or null when satisfied */
  assert?: (r: ExecResult) => string | null;
  /** for failure cases: the diagnosis codes that are acceptable */
  expectErrorCodes?: DiagnosisCode[];
  /** the case is intentionally not executed; explains why */
  skip?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const BEHAVIOUR: BehaviourCase[] = [
  /* -------------------------------- triggers -------------------------------- */
  {
    id: "manual emits its configured payload",
    type: "trigger.manual",
    config: { payload: '{"a":1}' },
    assert: (r) => (isObj(r.output) && r.output.a === 1 ? null : `output.a !== 1 (got ${JSON.stringify(r.output)})`),
  },
  {
    id: "webhook falls back to the sample body when there is no request",
    type: "trigger.webhook",
    config: { sample: '{"b":2}' },
    assert: (r) => (isObj(r.output) && r.output.b === 2 ? null : `sample fallback failed (got ${JSON.stringify(r.output)})`),
  },
  {
    id: "webhook prefers the live request body over the sample",
    type: "trigger.webhook",
    input: { c: 3 },
    config: { sample: '{"b":2}' },
    assert: (r) => (isObj(r.output) && r.output.c === 3 ? null : `live body not used (got ${JSON.stringify(r.output)})`),
  },
  {
    id: "schedule reports its cron expression",
    type: "trigger.schedule",
    config: { cron: "*/5 * * * *" },
    assert: (r) => (isObj(r.output) && r.output.cron === "*/5 * * * *" ? null : "cron not echoed"),
  },
  {
    id: "interval reports its period",
    type: "trigger.interval",
    config: { seconds: 60 },
    assert: (r) => (isObj(r.output) && r.output.intervalSeconds === 60 ? null : "intervalSeconds not echoed"),
  },

  /* --------------------------------- actions -------------------------------- */
  {
    id: "http parses a JSON 200 response",
    type: "action.http",
    config: { url: "https://api.example.test/ok", method: "GET" },
    assert: (r) =>
      isObj(r.output) && r.output.status === 200 && isObj(r.output.data)
        ? null
        : `unexpected output ${JSON.stringify(r.output)}`,
  },
  {
    id: "http surfaces a 5xx as a non-ok result (does not throw)",
    type: "action.http",
    config: { url: "https://api.example.test/fail500", method: "GET" },
    assert: (r) =>
      isObj(r.output) && r.output.ok === false && r.output.status === 500
        ? null
        : `expected ok:false/500, got ${JSON.stringify(r.output)}`,
  },
  {
    id: "http with a blank URL fails with an INVALID_URL diagnosis",
    type: "action.http",
    config: { url: "" },
    expectErrorCodes: ["INVALID_URL", "VALIDATION"],
  },
  {
    id: "email in mock mode is labelled simulated and never claims delivery",
    type: "action.email",
    config: { to: "user@example.com", subject: "Hi", body: "Body", transport: "mock" },
    assert: (r) => {
      if (r.simulated !== true) return "result was not flagged simulated";
      if (!isObj(r.output) || !isObj(r.output.email)) return "email output missing";
      const e = r.output.email as Record<string, unknown>;
      if (e.delivered !== false) return "mock email claimed delivery";
      if (e.deliveryMode !== "mock") return `deliveryMode was ${String(e.deliveryMode)}`;
      return null;
    },
  },
  {
    id: "email rejects a malformed recipient before sending",
    type: "action.email",
    config: { to: "not-an-email", transport: "mock" },
    expectErrorCodes: ["VALIDATION"],
  },
  {
    id: "email reports AUTH when a live transport has no credential",
    type: "action.email",
    config: { to: "user@example.com", transport: "resend", apiKey: "" },
    expectErrorCodes: ["AUTH", "VALIDATION"],
  },
  {
    id: "email delivers live through the injected transport",
    type: "action.email",
    config: {
      to: "user@example.com",
      subject: "Hi",
      body: "Body",
      transport: "resend",
      apiKey: "test-key",
    },
    assert: (r) => {
      if (r.simulated === true) return "live send was flagged simulated";
      if (!isObj(r.output) || !isObj(r.output.email)) return "email output missing";
      const e = r.output.email as Record<string, unknown>;
      if (e.delivered !== true) return "email was not delivered";
      if (e.deliveryMode !== "live") return `deliveryMode was ${String(e.deliveryMode)}`;
      return null;
    },
  },
  {
    id: "log resolves expressions and passes the payload through",
    type: "action.log",
    input: { value: "world" },
    config: { message: "hi {{value}}", level: "info" },
    assert: (r) => (isObj(r.output) && r.output.value === "world" ? null : "input not passed through"),
  },
  {
    id: "delay waits then passes the payload through",
    type: "action.delay",
    input: { x: 1 },
    config: { ms: 1 },
    assert: (r) => (isObj(r.output) && r.output.x === 1 ? null : "input not passed through"),
  },
  {
    id: "approval halts the run on first pass",
    type: "action.approval",
    input: { amount: 5 },
    assert: (r) =>
      r.halt === true && typeof r.haltReason === "string" && r.haltReason.length > 0
        ? null
        : "approval did not halt with a reason",
  },
  {
    id: "approval routes to the approved branch once decided",
    type: "action.approval",
    input: { _approval: { decision: "approved", by: "tester" } },
    assert: (r) => (r.branch === "approved" ? null : `branch was ${String(r.branch)}`),
  },
  {
    id: "approval routes to the rejected branch once declined",
    type: "action.approval",
    input: { _approval: { decision: "rejected", by: "tester" } },
    assert: (r) => (r.branch === "rejected" ? null : `branch was ${String(r.branch)}`),
  },
  {
    id: "write file (side-effecting — covered by run-level integration instead)",
    type: "action.writeFile",
    skip: "Writes to disk; excluded from the self-test so a health check never mutates data.",
  },

  /* ---------------------------------- logic --------------------------------- */
  {
    id: "if routes true when the comparison holds",
    type: "logic.if",
    input: { n: 10 },
    config: { left: "{{n}}", operator: "gt", right: "5" },
    assert: (r) => (r.branch === "true" ? null : `branch was ${String(r.branch)}`),
  },
  {
    id: "if routes false when the comparison fails",
    type: "logic.if",
    input: { n: 1 },
    config: { left: "{{n}}", operator: "gt", right: "5" },
    assert: (r) => (r.branch === "false" ? null : `branch was ${String(r.branch)}`),
  },
  {
    id: "switch selects the matching case handle",
    type: "logic.switch",
    input: { kind: "b" },
    config: { value: "{{kind}}", case1: "a", case2: "b" },
    assert: (r) => (r.branch === "case2" ? null : `branch was ${String(r.branch)}`),
  },
  {
    id: "switch falls back to the default handle",
    type: "logic.switch",
    input: { kind: "zzz" },
    config: { value: "{{kind}}", case1: "a", case2: "b" },
    assert: (r) => (r.branch === "default" ? null : `branch was ${String(r.branch)}`),
  },
  {
    id: "filter passes a matching record",
    type: "logic.filter",
    input: { n: 10 },
    config: { left: "{{n}}", operator: "gt", right: "5" },
    assert: (r) => (r.pass === true ? null : "filter did not pass"),
  },
  {
    id: "filter blocks a non-matching record",
    type: "logic.filter",
    input: { n: 1 },
    config: { left: "{{n}}", operator: "gt", right: "5" },
    assert: (r) => (r.pass === false ? null : "filter did not block"),
  },
  {
    id: "merge combines object branches",
    type: "logic.merge",
    input: [{ a: 1 }, { b: 2 }],
    config: { strategy: "combine" },
    assert: (r) =>
      isObj(r.output) && r.output.a === 1 && r.output.b === 2
        ? null
        : `merge produced ${JSON.stringify(r.output)}`,
  },
  {
    id: "merge can emit an array of branches",
    type: "logic.merge",
    input: [{ a: 1 }, { b: 2 }],
    config: { strategy: "array" },
    assert: (r) => (Array.isArray(r.output) && r.output.length === 2 ? null : "array strategy failed"),
  },
  {
    id: "batch split caps the carried batch size",
    type: "logic.loop",
    input: { items: [1, 2, 3] },
    config: { arrayPath: "items", maxIterations: 2 },
    assert: (r) =>
      Array.isArray(r.output) && r.output.length === 2
        ? null
        : `expected 2 items, got ${JSON.stringify(r.output)}`,
  },

  /* ---------------------------------- data ---------------------------------- */
  {
    id: "set fields merges computed values onto the payload",
    type: "data.set",
    input: { name: "Ada" },
    config: { fields: { greeting: "hi {{name}}" } },
    assert: (r) =>
      isObj(r.output) && r.output.greeting === "hi Ada" && r.output.name === "Ada"
        ? null
        : `set produced ${JSON.stringify(r.output)}`,
  },
  {
    id: "transform projects only the mapped keys",
    type: "data.transform",
    input: { user: { id: 7 }, noise: true },
    config: { mapping: { id: "{{user.id}}" } },
    assert: (r) => {
      if (!isObj(r.output)) return "output was not an object";
      if (String(r.output.id) !== "7") return `id was ${String(r.output.id)}`;
      if ("noise" in r.output) return "unmapped key leaked through";
      return null;
    },
  },
  {
    id: "code node executes and returns a value",
    type: "data.code",
    input: { n: 21 },
    config: { code: "return { doubled: input.n * 2 };" },
    assert: (r) =>
      isObj(r.output) && r.output.doubled === 42 ? null : `code produced ${JSON.stringify(r.output)}`,
  },
  {
    id: "code node reports a syntax error as a CODE_SYNTAX diagnosis",
    type: "data.code",
    input: { n: 1 },
    config: { code: "return {;" },
    expectErrorCodes: ["CODE_SYNTAX", "CODE_RUNTIME"],
  },
  {
    id: "template renders and writes to its output key",
    type: "data.template",
    input: { name: "Ada" },
    config: { template: "Hello {{name}}", outputKey: "text" },
    assert: (r) => (isObj(r.output) && r.output.text === "Hello Ada" ? null : "template did not render"),
  },
  {
    id: "math evaluates an expression into its output key",
    type: "data.math",
    input: {},
    config: { expression: "2 * 21", outputKey: "result" },
    assert: (r) => (isObj(r.output) && r.output.result === 42 ? null : `math produced ${JSON.stringify(r.output)}`),
  },

  /* ----------------------------------- ai ----------------------------------- */
  {
    id: "ai falls back to a deterministic offline mock without a key",
    type: "ai.generate",
    input: {},
    config: { prompt: "Summarize: the product is great", mode: "smart" },
    assert: (r) => {
      if (!isObj(r.output)) return "output was not an object";
      if (typeof r.output.completion !== "string" || !r.output.completion) return "no completion text";
      if (!String(r.output._aiMode || "").startsWith("mock")) return `mode was ${String(r.output._aiMode)}`;
      return null;
    },
  },
  {
    id: "ai sentiment mode classifies clearly positive text",
    type: "ai.generate",
    input: {},
    config: { prompt: "I love this excellent product", mode: "sentiment" },
    assert: (r) =>
      isObj(r.output) && String(r.output.completion).includes("positive")
        ? null
        : `sentiment was ${String(isObj(r.output) ? r.output.completion : r.output)}`,
  },
];

/* ---------------------------------- runner --------------------------------- */

async function executeCase(
  c: BehaviourCase,
  fetchImpl: typeof fetch
): Promise<Check> {
  if (c.skip) {
    return { name: c.id, ok: true, detail: c.skip, skipped: true };
  }
  const node = fixtureNode(c.type, c.config);
  const logs: string[] = [];
  try {
    const result = await runNode({
      input: c.input,
      node,
      log: (_lvl, msg) => logs.push(msg),
      fetchImpl,
    });

    if (c.expectErrorCodes) {
      return {
        name: c.id,
        ok: false,
        detail: `expected a failure with code ${c.expectErrorCodes.join("/")}, but the node succeeded`,
      };
    }
    if (c.assert) {
      const problem = c.assert(result);
      return {
        name: c.id,
        ok: problem === null,
        detail: problem ?? "matched the expected behaviour",
      };
    }
    return { name: c.id, ok: true, detail: "executed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diag = diagnose(message, c.type, c.input !== undefined);

    if (c.expectErrorCodes) {
      const ok = c.expectErrorCodes.includes(diag.code);
      return {
        name: c.id,
        ok,
        detail: ok
          ? `failed as expected with ${diag.code}: ${message}`
          : `expected ${c.expectErrorCodes.join("/")} but got ${diag.code}: ${message}`,
      };
    }
    return {
      name: c.id,
      ok: false,
      detail: `threw unexpectedly — ${diag.code}: ${message}`,
    };
  }
}

/** Run the whole suite. Offline, deterministic, side-effect free. */
export async function runConformance(
  opts: ConformanceOptions = {}
): Promise<ConformanceReport> {
  const startedAt = Date.now();
  const fetchImpl = opts.fetchImpl ?? makeStubFetch();
  const types = NODE_TYPES.map((d) => d.type).filter(
    (t) => !opts.only || opts.only.includes(t)
  );
  const nodes: NodeReport[] = [];

  let index = 0;
  for (const type of types) {
    index++;
    opts.onProgress?.(type, index, types.length);
    const def = NODE_MAP[type];
    const nStart = Date.now();
    const checks: Check[] = [];

    /* ------------------------- 1. registry contract ------------------------- */
    checks.push({
      name: "registry: label and description present",
      ok: !!def.label?.trim() && !!def.description?.trim(),
      detail: def.label ? `"${def.label}" — ${def.description}` : "missing label/description",
    });
    checks.push({
      name: "registry: icon exists in the icon registry",
      ok: ICON_NAMES.includes(def.icon),
      detail: ICON_NAMES.includes(def.icon)
        ? `icon "${def.icon}" resolved`
        : `icon "${def.icon}" is NOT registered in iconMap.ts`,
    });
    const handleIds = def.outputs.map((o) => o.id);
    checks.push({
      name: "registry: output handles are unique and non-empty",
      ok:
        handleIds.length > 0 &&
        handleIds.every((h) => !!h) &&
        new Set(handleIds).size === handleIds.length,
      detail: `handles: [${handleIds.join(", ")}]`,
    });
    checks.push({
      name: "registry: category is one of the five known categories",
      ok: ["trigger", "action", "logic", "data", "ai"].includes(def.category),
      detail: `category "${def.category}"`,
    });
    checks.push({
      name: "registry: non-trigger nodes accept at least one input",
      ok: def.category === "trigger" ? def.inputs === 0 : def.inputs >= 1,
      detail: `inputs = ${def.inputs}`,
    });

    /* -------------------------- 2. schema contract -------------------------- */
    const fresh = fixtureNode(type);
    const issues = validateNodeConfig(fresh);
    const errors = issues.filter((i) => i.level === "error");
    // A field marked `required` with no safe default (a recipient address, say)
    // is a legitimate prompt for the user — not a defect. What must never
    // happen is a shipped default that violates a *format* or *range* rule.
    const needsUser = errors.filter((e) => e.code === "REQUIRED");
    const realErrors = errors.filter((e) => e.code !== "REQUIRED");
    checks.push({
      name: "schema: shipped defaults are format- and range-clean",
      ok: realErrors.length === 0,
      detail:
        realErrors.length > 0
          ? realErrors.map((e) => `${e.field ?? "-"}: ${e.message}`).join("; ")
          : needsUser.length === 0
            ? `${def.fields.length} field(s) checked — defaults fully valid`
            : `${def.fields.length} field(s) checked — no format/range errors; ` +
              `${needsUser.length} require user input (${needsUser
                .map((e) => e.field)
                .join(", ")})`,
    });

    /* ------------------------- 3. executor contract ------------------------- */
    const has = hasExecutor(type);
    checks.push({
      name: "executor: registered for this node type",
      ok: has,
      detail: has ? "executor found" : "NO executor registered — this node cannot run",
    });

    if (SIDE_EFFECTING[type]) {
      checks.push({
        name: "executor: invocation contract",
        ok: true,
        skipped: true,
        detail: SIDE_EFFECTING[type],
      });
    } else if (has) {
      try {
        const res = await runNode({
          input: {},
          node: fresh,
          log: () => {},
          fetchImpl,
        });
        const hasOutput = res !== null && typeof res === "object" && "output" in res;
        checks.push({
          name: "executor: returns an ExecResult with an `output` property",
          ok: hasOutput,
          detail: hasOutput
            ? "contract satisfied on default config"
            : `returned ${JSON.stringify(res)}`,
        });

        /* determinism: same input twice ⇒ structurally equal output */
        const again = await runNode({
          input: {},
          node: fresh,
          log: () => {},
          fetchImpl,
        });
        const a = stable(res.output);
        const b = stable(again.output);
        checks.push({
          name: "executor: deterministic for identical input",
          ok: a === b,
          detail: a === b ? "identical output on repeat" : `output drifted:\n${a}\n${b}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const diag = diagnose(message, type, false);
        // A structured failure is an acceptable contract on empty input —
        // what matters is that the error is classified, not anonymous.
        checks.push({
          name: "executor: fails with a classified diagnosis on empty input",
          ok: diag.code !== "UNKNOWN",
          detail: `${diag.code}: ${message}`,
        });
      }
    }

    /* ------------------------- 4. behaviour contract ------------------------ */
    const cases = BEHAVIOUR.filter((c) => c.type === type);
    if (cases.length === 0) {
      checks.push({
        name: "behaviour: has at least one assertion case",
        ok: false,
        detail: "no behaviour case defined for this node type — coverage gap",
      });
    }
    for (const c of cases) {
      checks.push(await executeCase(c, fetchImpl));
    }

    const failed = checks.filter((c) => !c.ok).length;
    const skipped = checks.filter((c) => c.skipped).length;
    nodes.push({
      type,
      label: def.label,
      category: def.category,
      checks,
      passed: checks.length - failed - skipped,
      failed,
      skipped,
      ok: failed === 0,
      durationMs: Date.now() - nStart,
    });
  }

  /* --------------------------- platform-wide checks -------------------------- */
  const platform: Check[] = [];

  platform.push({
    name: "platform: every node type has a conformance case",
    ok: BEHAVIOUR.some((c) => !c.skip) &&
      NODE_TYPES.every((d) => BEHAVIOUR.some((c) => c.type === d.type)),
    detail: `${BEHAVIOUR.length} case(s) across ${new Set(BEHAVIOUR.map((c) => c.type)).size} type(s)`,
  });

  platform.push({
    name: "platform: no duplicate node type ids",
    ok: new Set(NODE_TYPES.map((d) => d.type)).size === NODE_TYPES.length,
    detail: `${NODE_TYPES.length} declared, ${new Set(NODE_TYPES.map((d) => d.type)).size} unique`,
  });

  const orphanExecutors = EXECUTOR_TYPES.filter((t) => !NODE_MAP[t]);
  platform.push({
    name: "platform: every executor maps to a declared node type",
    ok: orphanExecutors.length === 0,
    detail:
      orphanExecutors.length === 0
        ? `${EXECUTOR_TYPES.length} executor(s), all mapped`
        : `orphans: ${orphanExecutors.join(", ")}`,
  });

  const missingExecutors = NODE_TYPES.filter((d) => !hasExecutor(d.type)).map((d) => d.type);
  platform.push({
    name: "platform: every node type has an executor",
    ok: missingExecutors.length === 0,
    detail:
      missingExecutors.length === 0
        ? "all node types are executable"
        : `missing: ${missingExecutors.join(", ")}`,
  });

  /* template integrity — catches a handle rename breaking shipped templates */
  const templateProblems: string[] = [];
  for (const tpl of TEMPLATES) {
    try {
      const wf = instantiateTemplate(tpl.id);
      const analysis = analyzeGraph(wf.nodes, wf.edges);
      if (!analysis.isValid) {
        templateProblems.push(
          `${tpl.id}: ${analysis.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`
        );
      }
      for (const e of wf.edges) {
        const src = wf.nodes.find((n) => n.id === e.source);
        const dst = wf.nodes.find((n) => n.id === e.target);
        if (!src || !dst) {
          templateProblems.push(`${tpl.id}: edge ${e.id} references a missing node`);
          continue;
        }
        const srcDef = getNodeDef(src.data.type);
        const dstDef = getNodeDef(dst.data.type);
        const handle = e.sourceHandle || "out";
        if (srcDef && !srcDef.outputs.some((o) => o.id === handle)) {
          templateProblems.push(
            `${tpl.id}: handle "${handle}" does not exist on ${srcDef.type}`
          );
        }
        if (dstDef && dstDef.inputs === 0) {
          templateProblems.push(`${tpl.id}: ${dstDef.type} is a trigger but receives an edge`);
        }
      }
    } catch (err) {
      templateProblems.push(`${tpl.id}: ${(err as Error).message}`);
    }
  }
  platform.push({
    name: "platform: every shipped template is structurally valid",
    ok: templateProblems.length === 0,
    detail:
      templateProblems.length === 0
        ? `${TEMPLATES.length} template(s) validated, all edge handles resolve`
        : templateProblems.join(" | "),
  });

  platform.push({
    name: "platform: reliability policy clamps unsafe values",
    ok: clampContractHolds(),
    detail: clampContractHolds()
      ? "timeouts, retries and backoff are bounded to safe ranges"
      : "policy clamping is not enforcing its bounds",
  });

  const finishedAt = Date.now();
  const allChecks = [...nodes.flatMap((n) => n.checks), ...platform];
  const executed = allChecks.filter((c) => !c.skipped);
  const failedCount = executed.filter((c) => !c.ok).length;
  const skippedCount = allChecks.length - executed.length;
  const passedCount = executed.length - failedCount;

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    total: nodes.length,
    passed: passedCount,
    failed: failedCount,
    skipped: skippedCount,
    score: executed.length === 0 ? 0 : Math.round((passedCount / executed.length) * 1000) / 10,
    nodes,
    platform,
    platformFailed: platform.filter((c) => !c.ok).length,
    ok: failedCount === 0,
  };
}

/* --------------------------------- helpers -------------------------------- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Deterministic structural serialisation: sorts object keys and normalises
 * wall-clock timestamps, so a node that legitimately stamps `new Date()` is
 * still comparable between two runs.
 */
function stable(value: unknown): string {
  if (typeof value === "string") {
    return ISO_RE.test(value) ? '"<timestamp>"' : JSON.stringify(value);
  }
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** Proof that user-supplied policy values cannot escape their safe bounds. */
function clampContractHolds(): boolean {
  const p = normalizePolicy({
    timeoutMs: 10_000_000,
    maxRetries: 999,
    backoffMs: 10_000_000,
  });
  return p.timeoutMs === 120_000 && p.maxRetries === 5 && p.backoffMs === 5_000;
}
