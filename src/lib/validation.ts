/**
 * FlowForge configuration validation.
 *
 * Validation is *registry-driven*: each node field can declare `required`,
 * `format`, `min`, and `max`, and this module enforces them. That keeps the
 * "single source of truth" property — add a field constraint in the registry and
 * the editor's validation panel, the API, and the pre-run gate all learn it.
 */

import type { FlowNode, FieldSchema } from "./types";
import { getNodeDef } from "./nodeRegistry";

export type IssueLevel = "error" | "warning";

export interface ConfigIssue {
  level: IssueLevel;
  code: string;
  field?: string;
  message: string;
}

/* --------------------------------- formats --------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function isHttpUrl(v: string): boolean {
  const s = v.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Standard 5- or 6-field cron (we accept the common aliases too). */
export function isCron(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  const aliases = ["@hourly", "@daily", "@weekly", "@monthly", "@yearly", "@annually"];
  if (aliases.includes(s.toLowerCase())) return true;
  const parts = s.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return false;
  return parts.every((p) => /^[\d*/,\-?LW#]+$/i.test(p));
}

export function isFilename(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (/[\\/]/.test(s)) return false; // no path traversal
  if (s === "." || s === "..") return false;
  return /^[\w.\- (){}]+$/.test(s);
}

/** Does the string contain a well-formed set of {{ }} blocks? */
export function balancedExpressions(v: string): boolean {
  const opens = (v.match(/\{\{/g) || []).length;
  const closes = (v.match(/\}\}/g) || []).length;
  return opens === closes;
}

/* ------------------------------- field checks ------------------------------- */

function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Validate one field value against its schema. Returns the issues found. */
export function validateField(field: FieldSchema, raw: unknown): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const push = (level: IssueLevel, code: string, message: string) =>
    issues.push({ level, code, field: field.key, message });

  // Respect showIf: a hidden field is not required.
  if (field.showIf) return issues;

  const value = raw ?? field.default;

  if (field.required && isBlank(value)) {
    push("error", "REQUIRED", `"${field.label}" is required.`);
    return issues;
  }
  if (isBlank(value)) return issues;

  const str = typeof value === "string" ? value : String(value);

  // Skip semantic-format checks when the value is still an unresolved expression
  // — {{...}} placeholders are validated at run time instead.
  const hasExpr = /\{\{[\s\S]*?\}\}/.test(str);

  switch (field.format) {
    case "email":
      if (!hasExpr && !isEmail(str)) {
        push("error", "FORMAT_EMAIL", `"${field.label}" must be a valid email address.`);
      }
      break;
    case "url":
      if (!hasExpr && !isHttpUrl(str)) {
        push(
          "error",
          "FORMAT_URL",
          `"${field.label}" must be an absolute http(s) URL.`
        );
      }
      break;
    case "cron":
      if (!isCron(str)) {
        push(
          "error",
          "FORMAT_CRON",
          `"${field.label}" must be a 5-field cron expression (e.g. */5 * * * *).`
        );
      }
      break;
    case "filename":
      if (!hasExpr && !isFilename(str)) {
        push(
          "error",
          "FORMAT_FILENAME",
          `"${field.label}" must be a plain file name with no slashes.`
        );
      }
      break;
    case "json": {
      if (!hasExpr) {
        try {
          JSON.parse(str);
        } catch {
          push("error", "FORMAT_JSON", `"${field.label}" is not valid JSON.`);
        }
      }
      break;
    }
    case "positiveNumber": {
      const n = Number(str);
      if (!Number.isFinite(n) || n <= 0) {
        push("error", "FORMAT_NUMBER", `"${field.label}" must be a positive number.`);
      }
      break;
    }
    case "port": {
      const n = Number(str);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        push("error", "FORMAT_PORT", `"${field.label}" must be a port between 1 and 65535.`);
      }
      break;
    }
    default:
      break;
  }

  if (field.type === "number" && !field.format) {
    const n = Number(str);
    if (!Number.isFinite(n)) {
      push("error", "FORMAT_NUMBER", `"${field.label}" must be a number.`);
    } else {
      if (field.min !== undefined && n < field.min) {
        push("error", "RANGE_MIN", `"${field.label}" must be at least ${field.min}.`);
      }
      if (field.max !== undefined && n > field.max) {
        push("error", "RANGE_MAX", `"${field.label}" must be at most ${field.max}.`);
      }
    }
  }

  // Unbalanced {{ }} is always a mistake worth surfacing.
  if (typeof value === "string" && !balancedExpressions(value)) {
    push(
      "warning",
      "EXPR_UNBALANCED",
      `"${field.label}" has an unbalanced {{ expression }}.`
    );
  }

  return issues;
}

/* ------------------------------- node checks ------------------------------- */

export interface NodeConfigIssue extends ConfigIssue {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
}

/** Validate a single node instance against its registry definition. */
export function validateNodeConfig(node: FlowNode): ConfigIssue[] {
  const def = getNodeDef(node.data.type);
  if (!def) {
    return [
      {
        level: "error",
        code: "UNKNOWN_TYPE",
        message: `Unknown node type "${node.data.type}".`,
      },
    ];
  }
  const config = node.data.config || {};
  const issues: ConfigIssue[] = [];
  for (const field of def.fields) {
    issues.push(...validateField(field, config[field.key]));
  }

  // Policy sanity: an injected failure would make a "production" run fail.
  const policy = node.data.policy;
  if (policy?.injectFailure && policy.injectFailure !== "none") {
    issues.push({
      level: "warning",
      code: "INJECTED_FAILURE",
      message: `Failure injection is ON (${policy.injectFailure}) — this node will fail by design.`,
    });
  }

  return issues;
}

/** Validate every node in a graph, tagging issues with their owner. */
export function validateAllNodes(nodes: FlowNode[]): NodeConfigIssue[] {
  const out: NodeConfigIssue[] = [];
  for (const node of nodes) {
    for (const issue of validateNodeConfig(node)) {
      out.push({
        ...issue,
        nodeId: node.id,
        nodeLabel: node.data.label,
        nodeType: node.data.type,
      });
    }
  }
  return out;
}

/** Count of blocking issues in a set of config issues. */
export function errorCount(issues: ConfigIssue[]): number {
  return issues.filter((i) => i.level === "error").length;
}
