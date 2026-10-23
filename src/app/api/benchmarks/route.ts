import { NextRequest, NextResponse } from "next/server";
import { runBenchmarks } from "@/lib/benchmark";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run the Benchmark Lab and return percentiles plus reliability guarantees.
 *
 *   GET /api/benchmarks               → 20 iterations per workload
 *   GET /api/benchmarks?iterations=50 → more samples (capped at 200)
 */
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("iterations") ?? 20);
  const iterations = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 200) : 20;
  const report = await runBenchmarks({ iterations });
  return NextResponse.json(report);
}
