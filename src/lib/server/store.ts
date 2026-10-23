import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { Workflow, RunRecord } from "../types";

/*
 * FlowForge storage.
 *
 * Durability is *discovered*, not assumed. On first use we probe the backends
 * in order of preference and report exactly which one won — the UI shows this
 * as a live "storage mode" badge so nobody is misled about whether their work
 * survives a redeploy:
 *
 *   1. Remote KV (Upstash / Vercel KV REST)  → durable across instances
 *   2. <project>/data (writable)             → durable on a VM / container
 *   3. <tmp>/flowforge-data                  → ephemeral, per-instance
 *   4. in-process memory                     → ephemeral, lost on restart
 *
 * Backend 4 exists so the product degrades instead of crashing. Every mode is
 * fully functional for create / save / run / delete; only durability differs.
 */

export type StorageBackend = "kv" | "filesystem" | "memory";

export interface StorageInfo {
  backend: StorageBackend;
  /** true when data survives a restart or redeploy */
  durable: boolean;
  label: string;
  root: string;
  /** plain-English explanation, shown in the UI badge tooltip */
  reason: string;
}

const BUNDLED_DIR = path.join(process.cwd(), "data");
const KV_PREFIX = "flowforge";

/* ------------------------------ remote KV ---------------------------------- */

function kvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { url: url.replace(/\/+$/, ""), token };
  return null;
}

/** Issue one Upstash-REST command. */
async function kvCmd(cmd: string, body?: string): Promise<unknown> {
  const c = kvConfig();
  if (!c) throw new Error("KV is not configured");
  const res = await fetch(`${c.url}/${cmd}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      ...(body === undefined ? {} : { "Content-Type": "text/plain" }),
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV responded ${res.status}`);
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}

const kvKey = (kind: "workflows" | "runs", id: string) =>
  `${KV_PREFIX}:${kind}:${id}`;

/* ------------------------------ memory ------------------------------------- */

const memory: { workflows: Map<string, unknown>; runs: Map<string, unknown> } = {
  workflows: new Map(),
  runs: new Map(),
};

/* ---------------------------- fs root probing ------------------------------- */

let info: StorageInfo | null = null;
let fsRoot: string | null = null;
let seeded = false;

interface ProbeOutcome {
  info: StorageInfo | null;
  /** why the probe failed — surfaced to the user instead of hiding the fallback */
  error: string | null;
}

/**
 * Prove a directory is writable by actually writing to it.
 *
 * Two details matter for reliability: the probe file name is unique (so
 * concurrent probes cannot collide), and cleanup is *best effort*. On Windows a
 * freshly written file can be briefly locked by an indexer or scanner, making
 * `unlink` fail — if that were treated as a probe failure we would wrongly
 * demote durable storage to the ephemeral temp directory. The write itself is
 * the proof; the unlink is only hygiene.
 */
async function probe(
  root: string,
  candidate: Omit<StorageInfo, "root">
): Promise<ProbeOutcome> {
  const probeFile = path.join(root, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(probeFile, "ok", "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return {
      info: null,
      error: `${err.code ? `${err.code}: ` : ""}${err.message} (${root})`,
    };
  }
  await fs.unlink(probeFile).catch(() => {
    /* locked by an external scanner — irrelevant to writability */
  });
  return { info: { ...candidate, root }, error: null };
}

async function resolveStorage(): Promise<StorageInfo> {
  if (info) return info;

  // 1. remote KV
  if (kvConfig()) {
    try {
      await kvCmd("ping");
      info = {
        backend: "kv",
        durable: true,
        label: "Remote KV",
        root: "upstash-rest",
        reason:
          "Workflows and runs are stored in a remote key-value store, so they survive redeploys and are shared across instances.",
      };
      return info;
    } catch {
      /* fall through to local storage */
    }
  }

  // 2/3. filesystem — project dir first (durable), then temp (ephemeral)
  const project = await probe(BUNDLED_DIR, {
    backend: "filesystem",
    durable: true,
    label: "Project data/",
    reason:
      "Workflows and runs are written to the project's data/ directory, which persists across restarts on this host.",
  });
  if (project.info) {
    info = project.info;
    fsRoot = project.info.root;
    return info;
  }
  const projectFailure = project.error ?? "unknown error";

  const tmp = await probe(path.join(os.tmpdir(), "flowforge-data"), {
    backend: "filesystem",
    durable: false,
    label: "Temp dir (ephemeral)",
    reason:
      `The project data/ directory is not writable here (${projectFailure}), so data is kept in the OS ` +
      "temp directory. It survives page reloads but is lost when the instance recycles.",
  });
  if (tmp.info) {
    info = tmp.info;
    fsRoot = tmp.info.root;
    return info;
  }

  const tmpFailure = tmp.error ?? "unknown error";

  // 4. memory
  info = {
    backend: "memory",
    durable: false,
    label: "In-memory (ephemeral)",
    root: "(memory)",
    reason:
      `No writable location was available (project: ${projectFailure}; temp: ${tmpFailure}), so data is held ` +
      "in process memory only. Everything still works, but it is lost on restart.",
  };
  return info;
}

/** Current storage mode, resolved once. */
export async function storageInfo(): Promise<StorageInfo> {
  return resolveStorage();
}

/** Synchronous accessor — null until the first storage operation resolves it. */
export function storageInfoSync(): StorageInfo | null {
  return info;
}

/* ------------------------------ fs seeding --------------------------------- */

async function copySeed(subdir: string, targetDir: string) {
  const src = path.join(BUNDLED_DIR, subdir);
  try {
    const files = await fs.readdir(src);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(src, f), "utf8");
        await fs.writeFile(path.join(targetDir, f), raw, "utf8");
      } catch {
        /* skip unreadable seed file */
      }
    }
  } catch {
    /* no bundled seed data — fine */
  }
}

async function fsDirs(): Promise<{ wf: string; runs: string }> {
  const s = await resolveStorage();
  const root = fsRoot ?? s.root;
  const wf = path.join(root, "workflows");
  const runs = path.join(root, "runs");
  await fs.mkdir(wf, { recursive: true });
  await fs.mkdir(runs, { recursive: true });
  // Seed the ephemeral temp dir once from the read-only bundle so the deployed
  // demo opens with content instead of an empty list.
  if (!s.durable && !seeded && root !== BUNDLED_DIR) {
    seeded = true;
    await copySeed("workflows", wf);
    await copySeed("runs", runs);
  }
  return { wf, runs };
}

/* ------------------------- backend-agnostic CRUD --------------------------- */

async function readAll<T>(kind: "workflows" | "runs"): Promise<T[]> {
  const s = await resolveStorage();

  if (s.backend === "kv") {
    const keys = (await kvCmd(`keys/${KV_PREFIX}:${kind}:*`)) as string[] | null;
    if (!keys || keys.length === 0) return [];
    const out: T[] = [];
    for (const k of keys) {
      const raw = (await kvCmd(`get/${encodeURIComponent(k)}`)) as string | null;
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as T);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  if (s.backend === "memory") {
    return [...memory[kind].values()] as T[];
  }

  const { wf, runs } = await fsDirs();
  const dir = kind === "workflows" ? wf : runs;
  const files = await fs.readdir(dir);
  const out: T[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as T);
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

async function readOne<T>(
  kind: "workflows" | "runs",
  id: string
): Promise<T | null> {
  const s = await resolveStorage();

  if (s.backend === "kv") {
    const raw = (await kvCmd(`get/${encodeURIComponent(kvKey(kind, id))}`)) as
      | string
      | null;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  if (s.backend === "memory") {
    return (memory[kind].get(id) as T) ?? null;
  }

  const { wf, runs } = await fsDirs();
  const dir = kind === "workflows" ? wf : runs;
  try {
    return JSON.parse(
      await fs.readFile(path.join(dir, `${id}.json`), "utf8")
    ) as T;
  } catch {
    return null;
  }
}

async function writeOne(
  kind: "workflows" | "runs",
  id: string,
  value: unknown
): Promise<void> {
  const s = await resolveStorage();

  if (s.backend === "kv") {
    await kvCmd(`set/${encodeURIComponent(kvKey(kind, id))}`, JSON.stringify(value));
    return;
  }

  if (s.backend === "memory") {
    memory[kind].set(id, value);
    return;
  }

  const { wf, runs } = await fsDirs();
  const dir = kind === "workflows" ? wf : runs;
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

async function deleteOne(kind: "workflows" | "runs", id: string): Promise<void> {
  const s = await resolveStorage();

  if (s.backend === "kv") {
    await kvCmd(`del/${encodeURIComponent(kvKey(kind, id))}`);
    return;
  }

  if (s.backend === "memory") {
    memory[kind].delete(id);
    return;
  }

  const { wf, runs } = await fsDirs();
  const dir = kind === "workflows" ? wf : runs;
  try {
    await fs.unlink(path.join(dir, `${id}.json`));
  } catch {
    /* already gone */
  }
}

/* ------------------------------- workflows ------------------------------- */

export async function listWorkflows(): Promise<Workflow[]> {
  const out = await readAll<Workflow>("workflows");
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  return readOne<Workflow>("workflows", id);
}

export async function saveWorkflow(wf: Workflow): Promise<Workflow> {
  wf.updatedAt = new Date().toISOString();
  if (!wf.createdAt) wf.createdAt = wf.updatedAt;
  await writeOne("workflows", wf.id, wf);
  return wf;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await deleteOne("workflows", id);
}

/* --------------------------------- runs ---------------------------------- */

export async function saveRun(run: RunRecord): Promise<void> {
  await writeOne("runs", run.id, run);
}

export async function listRuns(workflowId?: string): Promise<RunRecord[]> {
  const all = await readAll<RunRecord>("runs");
  const out = workflowId ? all.filter((r) => r.workflowId === workflowId) : all;
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out.slice(0, 100);
}

export async function getRun(id: string): Promise<RunRecord | null> {
  return readOne<RunRecord>("runs", id);
}

/** Counts for the health/diagnostics surfaces. */
export async function storageStats(): Promise<{
  workflows: number;
  runs: number;
}> {
  const [wfs, runs] = await Promise.all([listWorkflows(), listRuns()]);
  return { workflows: wfs.length, runs: runs.length };
}
