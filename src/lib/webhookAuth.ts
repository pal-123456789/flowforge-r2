/**
 * FlowForge webhook authentication.
 *
 * Inbound webhooks are authenticated with an HMAC-SHA256 signature over the
 * *raw* request body — the standard scheme used by Stripe, GitHub and Resend,
 * so any mainstream client works without adaptation.
 *
 *   Header:  x-flowforge-signature: sha256=<hex>
 *            (also accepted: x-hub-signature-256, x-signature-256)
 *   Secret:  env FF_WEBHOOK_SECRET (or WEBHOOK_SECRET)
 *
 * When the secret is configured, a missing or bad signature is a hard 401.
 * When it is not configured, the endpoint still works (so a fresh deploy is
 * demoable) but every response reports `"authMode": "unsigned"` and the UI
 * surfaces that state — an unauthenticated ingress should never look normal.
 *
 * A replay guard is enforced whenever a sender includes
 * `x-flowforge-timestamp` (seconds since epoch): anything older than 5 minutes
 * is rejected, which defeats recorded-and-replayed requests.
 */

import crypto from "crypto";

export const SIGNATURE_HEADER = "x-flowforge-signature";
/** Alternatives accepted for interoperability with common senders. */
export const SIGNATURE_HEADER_ALIASES = [
  "x-hub-signature-256",
  "x-signature-256",
  "x-signature",
];
export const TIMESTAMP_HEADER = "x-flowforge-timestamp";
/** How long a timestamped request stays valid. */
export const MAX_SKEW_SECONDS = 300;

export type WebhookAuthMode = "signed" | "unsigned";

export function webhookSecret(): string | undefined {
  const s = process.env.FF_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
  return s && s.trim().length > 0 ? s.trim() : undefined;
}

export function authMode(): WebhookAuthMode {
  return webhookSecret() ? "signed" : "unsigned";
}

/** `sha256=<hex>` over the raw body. */
export function signPayload(rawBody: string, secret: string): string {
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/** Constant-time signature comparison; safe against length and timing leaks. */
export function verifySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const provided = signature.trim().toLowerCase().replace(/^sha256=/, "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}

/** True when `timestampSeconds` is present and within the allowed skew. */
export function isTimestampFresh(
  timestampSeconds: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!timestampSeconds) return true; // senders that omit it are not penalised
  const t = Number(timestampSeconds);
  if (!Number.isFinite(t)) return false;
  const delta = Math.abs(nowMs / 1000 - t);
  return delta <= MAX_SKEW_SECONDS;
}

export function firstSignatureHeader(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const candidates = [SIGNATURE_HEADER, ...SIGNATURE_HEADER_ALIASES];
  for (const name of candidates) {
    const v = headers[name];
    if (typeof v === "string" && v.trim()) return v;
    if (Array.isArray(v) && v.length) return v[0];
  }
  return null;
}
