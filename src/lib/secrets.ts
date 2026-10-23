/**
 * FlowForge secrets.
 *
 * Secrets are read from the process environment and referenced in node config
 * as `{{secrets.NAME}}`. They are substituted into a *copy* of the node config
 * at execution time — so the secret value never enters the workflow JSON that is
 * stored, exported, shared, or shown in a run's input/output panels.
 *
 * Environment convention:
 *   FF_SECRET_STRIPE_KEY=sk_live_…   →   {{secrets.STRIPE_KEY}}
 *   FF_SECRET_SMTP_URL=smtp://…      →   {{secrets.SMTP_URL}}
 *
 * In the browser there is no environment, so no secrets resolve — nodes that
 * need one fail with a clear AUTH diagnosis instead of silently sending nothing.
 */

export const SECRET_PREFIX = "FF_SECRET_";
export const SECRET_PATTERN = /\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

export type SecretMap = Record<string, string>;

/** Read all `FF_SECRET_*` variables into a name → value map. */
export function loadSecrets(): SecretMap {
  const out: SecretMap = {};
  if (typeof process === "undefined" || !process.env) return out;
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(SECRET_PREFIX)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    out[key.slice(SECRET_PREFIX.length)] = value;
  }
  return out;
}

/** Names only — safe to expose to the UI to power autocomplete. */
export function secretNames(secrets: SecretMap = loadSecrets()): string[] {
  return Object.keys(secrets).sort();
}

/** Collect every `{{secrets.X}}` reference inside an arbitrary config value. */
export function findSecretRefs(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(SECRET_PATTERN)) acc.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) findSecretRefs(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      findSecretRefs(v, acc);
    }
  }
  return acc;
}

export interface ResolveResult<T> {
  value: T;
  /** names that were substituted */
  resolved: string[];
  /** names referenced but not present in the environment */
  missing: string[];
}

/**
 * Deep-clone `value`, substituting every `{{secrets.NAME}}` with its value.
 * Reports which were resolved and which were missing, so the engine can log
 * (and diagnose) accurately without ever printing a secret.
 */
export function resolveSecretsDeep<T>(value: T, secrets: SecretMap): ResolveResult<T> {
  const resolved = new Set<string>();
  const missing = new Set<string>();

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(SECRET_PATTERN, (_m, name: string) => {
        const secret = secrets[name];
        if (secret === undefined) {
          missing.add(name);
          return "";
        }
        resolved.add(name);
        return secret;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };

  return {
    value: walk(value) as T,
    resolved: [...resolved],
    missing: [...missing],
  };
}

/** Replace any occurrence of a secret value in a string with a redaction marker. */
export function redact(text: string, secrets: SecretMap): string {
  let out = text;
  for (const value of Object.values(secrets)) {
    if (!value || value.length < 4) continue;
    out = out.split(value).join("«redacted»");
  }
  return out;
}

/**
 * Redact `{{secrets.X}}` references down to just the name for display, so a
 * config preview can show *that* a secret is used without leaking it.
 */
export function maskSecretRefs(text: string): string {
  return text.replace(SECRET_PATTERN, (_m, name: string) => `{{secrets.${name}}}`);
}
