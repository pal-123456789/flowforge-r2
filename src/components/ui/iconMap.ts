import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  Box,
  Play,
  Webhook,
  Clock,
  Timer,
  Globe,
  Mail,
  Terminal,
  Hourglass,
  FileText,
  GitBranch,
  Split,
  Filter,
  Merge,
  Repeat,
  PencilRuler,
  Shuffle,
  Braces,
  Type,
  Calculator,
  Sparkles,
  UserCheck,
  ShieldCheck,
  Activity,
  Gauge,
  Database,
  Table2,
  Layers,
  History,
  FlaskConical,
  KeyRound,
  AlertTriangle,
  LayoutGrid,
  FileSpreadsheet,
} from "lucide-react";

/**
 * Explicit icon registry (plain module, no "use client").
 *
 * We intentionally avoid `import * as Icons from "lucide-react"`: that barrel
 * import pulls every one of lucide's ~1500 icon modules into the dev compile
 * graph, adding thousands of modules and many seconds to each rebuild. Mapping
 * only the icons the node registry references keeps the bundle small.
 *
 * This lives outside the client component so the conformance suite can assert
 * that every node definition points at an icon that actually exists.
 */
export const ICONS: Record<string, ComponentType<LucideProps>> = {
  Box,
  Play,
  Webhook,
  Clock,
  Timer,
  Globe,
  Mail,
  Terminal,
  Hourglass,
  FileText,
  GitBranch,
  Split,
  Filter,
  Merge,
  Repeat,
  PencilRuler,
  Shuffle,
  Braces,
  Type,
  Calculator,
  Sparkles,
  UserCheck,
  ShieldCheck,
  Activity,
  Gauge,
  Database,
  Table2,
  Layers,
  History,
  FlaskConical,
  KeyRound,
  AlertTriangle,
  LayoutGrid,
  FileSpreadsheet,
};

export const ICON_NAMES: string[] = Object.keys(ICONS);
