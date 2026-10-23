import { BenchmarksPage } from "@/components/evidence/BenchmarksPage";

export const metadata = {
  title: "Benchmarks — FlowForge",
  description:
    "The Benchmark Lab: deterministic offline workloads reported as latency percentiles, plus hard reliability guarantees.",
};

export default function Benchmarks() {
  return <BenchmarksPage />;
}
