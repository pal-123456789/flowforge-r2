import { ConformancePage } from "@/components/evidence/ConformancePage";

export const metadata = {
  title: "Conformance — FlowForge",
  description:
    "The Node Conformance Suite: FlowForge testing its own 21 node types against registry, schema, executor and behaviour contracts.",
};

export default function HealthPage() {
  return <ConformancePage />;
}
