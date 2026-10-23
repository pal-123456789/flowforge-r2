"use client";

import { createElement } from "react";
import type { LucideProps } from "lucide-react";
import { ICONS } from "./iconMap";

/**
 * Render a lucide icon by its string name (from the node registry).
 * Falls back to a neutral box so a missing icon never crashes the canvas.
 */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = ICONS[name];
  if (!Cmp) return createElement(ICONS.Box, props);
  return createElement(Cmp, props);
}
