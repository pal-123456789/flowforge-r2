/**
 * FlowForge root-cause diagnostics.
 *
 * Every error the engine surfaces is classified into a structured `Diagnosis`:
 * a stable code, a plain-English cause, a concrete fix, and whether retrying is
 * likely to help. This turns "fetch failed" into "the host could not be reached
 * — check the URL, your network, or whether the API is behind auth".
 *
 * The classifier is deliberately conservative: when it is not confident it
 * returns UNKNOWN with honest, actionable guidance rather than guessing.
 */

import type { Diagnosis, DiagnosisCode } from "./types";

interface Rule {
  code: DiagnosisCode;
  /** regexes matched against `${message}` (lower-cased copy is also tried) */
  patterns: RegExp[];
  title: string;
  cause: string;
  fix: string;
  retryable: boolean;
  severity?: "error" | "warning";
}

/**
 * Ordered most-specific → least-specific. The first matching rule wins, so put
 * narrow signatures (a specific library error) above broad ones ("failed").
 */
const RULES: Rule[] = [
  /* ------------------------- deliberate/chaos failures ------------------------ */
  {
    code: "INJECTED",
    patterns: [/^\[injected\]/i, /injected failure/i],
    title: "Injected failure (Failure Injection mode)",
    cause:
      "This node was told to fail on purpose by Failure Injection mode so the failure path could be exercised.",
    fix: "Turn the injected failure off in the node's reliability policy to let it run normally.",
    retryable: false,
    severity: "warning",
  },

  /* ---------------------------------- timeout -------------------------------- */
  {
    code: "TIMEOUT",
    patterns: [
      /\btimed? ?out\b/i,
      /timeout of \d+ms exceeded/i,
      /AbortError/i,
      /operation was aborted/i,
      /exceeded .*timeout/i,
    ],
    title: "Node exceeded its time limit",
    cause:
      "The operation did not finish inside the configured timeout. Slow or unreachable endpoints are the usual cause.",
    fix: "Raise this node's timeout, add retries with backoff, or point it at a faster/nearer endpoint.",
    retryable: true,
  },

  /* ----------------------------------- auth ---------------------------------- */
  {
    code: "AUTH",
    patterns: [
      /\b401\b/, /\b403\b/,
      /unauthori[sz]ed/i, /\bforbidden\b/i,
      /invalid[ _-]?api[ _-]?key/i,
      /no api[ _-]?key/i,
      /api[ _-]?key is not configured/i,
      /missing api[ _-]?key/i,
      /authentication failed/i,
      /missing.*token/i,
      /bearer.*invalid/i,
    ],
    title: "Authentication or permission was rejected",
    cause:
      "The remote service refused the request — the credential is missing, wrong, expired, or lacks access to this resource.",
    fix: "Set the correct secret in your environment and reference it as {{secrets.NAME}} so it is never stored in the graph.",
    retryable: false,
  },

  /* --------------------------------- rate limit ------------------------------ */
  {
    code: "RATE_LIMIT",
    patterns: [/\b429\b/, /rate ?limit/i, /too many requests/i, /quota exceeded/i],
    title: "Rate limited by the remote service",
    cause: "The service is throttling requests from this client.",
    fix: "Enable retries with a larger backoff, or slow the workflow down with a Delay node.",
    retryable: true,
    severity: "warning",
  },

  /* ---------------------------------- network -------------------------------- */
  {
    code: "NETWORK",
    patterns: [
      /fetch failed/i,
      /\bENOTFOUND\b/, /\bEAI_AGAIN\b/, /\bECONNREFUSED\b/, /\bECONNRESET\b/,
      /getaddrinfo/i,
      /network is unreachable/i,
      /socket hang ?up/i,
      /certificate/i,
      /\bDNS\b/,
    ],
    title: "The host could not be reached",
    cause:
      "DNS or the network connection failed — the domain may be wrong, the service may be down, or the sandbox may have no outbound network.",
    fix: "Check the URL for typos, verify the service is up, and confirm outbound network access. Retries help with transient blips.",
    retryable: true,
  },

  /* ------------------------------- http status ------------------------------- */
  {
    code: "HTTP_STATUS",
    patterns: [/response \b[45]\d\d\b/i, /http \b[45]\d\d\b/i, /status[^\d]*\b[45]\d\d\b/i],
    title: "The remote service returned an error status",
    cause: "The request reached the server but the server rejected it (4xx client error or 5xx server error).",
    fix: "Inspect the response body in the node output — it usually names the invalid field or the upstream outage.",
    retryable: true,
    severity: "warning",
  },

  /* ------------------------------- invalid URL ------------------------------- */
  {
    code: "INVALID_URL",
    patterns: [
      /URL is empty/i,
      /invalid url/i,
      /failed to parse url/i,
      /unsupported protocol/i,
      /only absolute urls/i,
      /\bTypeError:.*url/i,
    ],
    title: "The URL is missing or malformed",
    cause: "The HTTP node received an empty or unparseable URL after expression resolution.",
    fix: "Check the URL field and any {{expressions}} feeding it — a blank upstream value will blank the URL too.",
    retryable: false,
  },

  /* -------------------------------- validation ------------------------------- */
  {
    code: "VALIDATION",
    patterns: [/^validation/i, /is required/i, /must be a/i, /invalid .*(value|format|type)/i],
    title: "Input failed validation",
    cause: "A supplied value did not meet this node's requirements (missing, wrong type, or out of range).",
    fix: "Open the node's configuration and correct the flagged field, or add a Filter/validation step upstream.",
    retryable: false,
  },

  /* ----------------------------------- code ---------------------------------- */
  {
    code: "CODE_SYNTAX",
    patterns: [
      /SyntaxError/i,
      /Unexpected token/i,
      /Unexpected end of input/i,
      /Invalid or unexpected token/i,
      /missing \) after/i,
    ],
    title: "The custom code has a syntax error",
    cause: "The JavaScript in the Code node could not be parsed.",
    fix: "Check for unbalanced braces or parentheses and missing commas. The exact token is named in the log line above.",
    retryable: false,
  },
  {
    code: "CODE_RUNTIME",
    patterns: [
      /is not defined/i,
      /is not a function/i,
      /Cannot read propert/i,
      /undefined is not/i,
      /TypeError/i,
      /ReferenceError/i,
    ],
    title: "The custom code threw at runtime",
    cause: "The script parsed but failed while running — usually a missing input field or an unexpected type.",
    fix: "Guard the fields you read (e.g. `input.email ?? \"\"`) and confirm the upstream node actually produces them.",
    retryable: false,
  },

  /* --------------------------------- expression ------------------------------ */
  {
    code: "EXPRESSION",
    patterns: [/expression/i, /\{\{.*\}\}/, /template/i],
    title: "An expression could not be resolved",
    cause: "A {{...}} expression referenced data that was not present, or produced an unusable value.",
    fix: "Verify the field exists on the node's input (check the Input panel) and that the path is spelled correctly.",
    retryable: false,
  },

  /* --------------------------------- file write ------------------------------ */
  {
    code: "FILE_WRITE",
    patterns: [
      /\bEROFS\b/, /\bEACCES\b/, /\bEPERM\b/, /\bENOSPC\b/,
      /read-?only file system/i,
      /permission denied/i,
      /no space left/i,
    ],
    title: "The file could not be written",
    cause:
      "The destination is read-only, not permitted, or full — serverless hosts often expose a read-only project directory.",
    fix: "Write to the temporary/output directory instead, or run on a host with a writable volume.",
    retryable: false,
  },

  /* ----------------------------------- misc ---------------------------------- */
  {
    code: "MISSING_INPUT",
    patterns: [/no executor for node type/i, /receiv(ed|es) no input/i, /no input/i, /is empty/i],
    title: "The node had nothing to work with",
    cause: "This node ran without usable input — its upstream branch may have been skipped or produced nothing.",
    fix: "Check that the upstream condition actually routed here, and that the previous node returned data.",
    retryable: false,
  },
];

const FALLBACK: Omit<Rule, "patterns"> = {
  code: "UNKNOWN",
  title: "The node failed",
  cause: "The operation threw an error that did not match a known failure signature.",
  fix: "Read the error text and the node's Input panel — the raw message is preserved verbatim above this diagnosis.",
  retryable: false,
  severity: "error",
};

/**
 * Explicit prefixes an executor may use to declare the failure category up
 * front, e.g. `throw new Error("Auth: no API key is configured")`. When present
 * this is authoritative — it is the thrower telling us exactly what went wrong,
 * which is more reliable than inferring from prose.
 */
const PREFIX_MAP: Record<string, DiagnosisCode> = {
  auth: "AUTH",
  authentication: "AUTH",
  permission: "AUTH",
  validation: "VALIDATION",
  timeout: "TIMEOUT",
  network: "NETWORK",
  rate_limit: "RATE_LIMIT",
  ratelimit: "RATE_LIMIT",
  url: "INVALID_URL",
  expression: "EXPRESSION",
  file: "FILE_WRITE",
  injected: "INJECTED",
};

const BY_CODE = new Map<DiagnosisCode, Rule>(RULES.map((r) => [r.code, r]));

function fromCode(code: DiagnosisCode, nodeType?: string): Diagnosis {
  const rule = BY_CODE.get(code);
  return {
    code,
    title: rule?.title ?? FALLBACK.title,
    cause: rule?.cause ?? FALLBACK.cause,
    fix: rule?.fix ?? FALLBACK.fix,
    severity: rule?.severity ?? "error",
    retryable: rule?.retryable ?? false,
    nodeType,
  };
}

/**
 * Classify a raw error message into a structured diagnosis.
 *
 * @param error     the thrown error (or its message)
 * @param nodeType  the node type that failed, for context in the fix text
 * @param hasInput  whether the node received non-empty input (refines MISSING_INPUT)
 */
export function diagnose(
  error: unknown,
  nodeType?: string,
  hasInput?: boolean
): Diagnosis {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  const haystack = message || "(no error message)";

  // 1. An explicit `Category:` prefix wins outright.
  const prefix = /^\s*\[?([A-Za-z_][A-Za-z_ ]{0,30}?)\]?\s*:/.exec(haystack);
  if (prefix) {
    const token = prefix[1].trim().toLowerCase().replace(/\s+/g, "_");
    const code = PREFIX_MAP[token];
    if (code) return fromCode(code, nodeType);
  }

  // 2. Otherwise match the most specific known failure signature.
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return {
        code: rule.code,
        title: rule.title,
        cause: rule.cause,
        fix: rule.fix,
        severity: rule.severity ?? "error",
        retryable: rule.retryable,
        nodeType,
      };
    }
  }

  // Refine the generic case: a node with no input at all is usually a wiring bug.
  if (hasInput === false) {
    return {
      code: "MISSING_INPUT",
      title: "The node received no input",
      cause: "The upstream branch did not deliver data to this node.",
      fix: "Confirm the previous node's branch condition actually routes here, and that it returned a value.",
      severity: "error",
      retryable: false,
      nodeType,
    };
  }

  return {
    code: FALLBACK.code,
    title: FALLBACK.title,
    cause: FALLBACK.cause,
    fix: FALLBACK.fix,
    severity: FALLBACK.severity ?? "error",
    retryable: FALLBACK.retryable,
    nodeType,
  };
}

/** Short label used by compact UI surfaces (badges, tables). */
export function diagnosisLabel(d: Diagnosis | undefined): string {
  if (!d) return "—";
  return `${d.code}`;
}

/** All codes, in a stable order, for the diagnostics reference page. */
export const DIAGNOSIS_CODES: DiagnosisCode[] = [
  "TIMEOUT",
  "NETWORK",
  "HTTP_STATUS",
  "AUTH",
  "RATE_LIMIT",
  "INVALID_URL",
  "VALIDATION",
  "CODE_SYNTAX",
  "CODE_RUNTIME",
  "EXPRESSION",
  "FILE_WRITE",
  "MISSING_INPUT",
  "INJECTED",
  "UNKNOWN",
];

/** Reference table for the in-app diagnostics documentation. */
export function diagnosisReference(): Diagnosis[] {
  return DIAGNOSIS_CODES.map((code) => {
    const rule = RULES.find((r) => r.code === code);
    if (rule) {
      return {
        code,
        title: rule.title,
        cause: rule.cause,
        fix: rule.fix,
        severity: rule.severity ?? "error",
        retryable: rule.retryable,
      };
    }
    return {
      code,
      title: FALLBACK.title,
      cause: FALLBACK.cause,
      fix: FALLBACK.fix,
      severity: FALLBACK.severity ?? "error",
      retryable: FALLBACK.retryable,
    };
  });
}
