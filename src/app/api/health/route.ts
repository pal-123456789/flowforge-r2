import { NextRequest, NextResponse } from "next/server";
import { runConformance } from "@/lib/conformance";
import { secretNames } from "@/lib/secrets";
import { storageInfo, storageStats } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * Machine-readable Node Conformance Suite result.
 *
 * Returns 200 when every conformance check passes, 503 when any fails — so it
 * is usable as a real readiness probe, not just a demo page.
 *
 *   GET /api/health              → full suite
 *   GET /api/health?only=a,b     → restrict to specific node types
 */
export async function GET(req: NextRequest) {
  const only = req.nextUrl.searchParams.get("only");
  const started = Date.now();

  const report = await runConformance({
    only: only ? only.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  });

  const [storage, stats] = await Promise.all([
    storageInfo(),
    storageStats().catch(() => ({ workflows: 0, runs: 0 })),
  ]);

  return NextResponse.json(
    {
      ...report,
      runtime: {
        node: process.version,
        platform: process.platform,
        executor: "server",
        secretsConfigured: secretNames().length,
        storage: {
          backend: storage.backend,
          durable: storage.durable,
          label: storage.label,
          reason: storage.reason,
        },
        counts: stats,
        checkedInMs: Date.now() - started,
      },
    },
    { status: report.ok ? 200 : 503 }
  );
}
