/**
 * Single source of truth for the outbound links shown in the product.
 *
 * The Round 1 repository and deployment were deleted, so a hard-coded URL
 * would be a dead link. Instead these are build-time configurable and every
 * consumer degrades gracefully: when no repository URL is configured the
 * "Source" affordances point at the in-app evidence pages, which always work.
 *
 * Set these in `.env.local` (or in the Vercel project settings) before the
 * final build:
 *
 *   NEXT_PUBLIC_REPO_URL=https://github.com/<owner>/<repo>
 *   NEXT_PUBLIC_DEPLOY_URL=https://<your-deployment>.vercel.app
 */

const REPO = (process.env.NEXT_PUBLIC_REPO_URL || "").trim();
const DEPLOY = (process.env.NEXT_PUBLIC_DEPLOY_URL || "").trim();

/** The public repository, or null when it has not been configured. */
export const REPO_URL: string | null = REPO || null;

/** The public deployment, or null when it has not been configured. */
export const DEPLOY_URL: string | null = DEPLOY || null;

/**
 * Where a "Source" link should go. Falls back to the in-app conformance
 * report, so the button is never a dead link.
 */
export const SOURCE_HREF: string = REPO || "/health";

/** Whether the source link points off-site (needs target=_blank). */
export const SOURCE_IS_EXTERNAL: boolean = REPO.startsWith("http");

/** Label for the source affordance. */
export const SOURCE_LABEL: string = REPO ? "Source" : "Conformance";

/**
 * Every place the product shows its own health. Used by the landing page so a
 * visitor can see the evidence without trusting a badge.
 */
export const EVIDENCE_LINKS = [
  { href: "/health", label: "Conformance" },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/runs", label: "Runs" },
  { href: "/analytics", label: "Analytics" },
] as const;
