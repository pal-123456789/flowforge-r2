import { NextRequest, NextResponse } from "next/server";
import { executeWorkflow } from "@/lib/engine";
import { saveRun, getWorkflow } from "@/lib/server/store";
import { loadSecrets } from "@/lib/secrets";
import {
  authMode,
  firstSignatureHeader,
  isTimestampFresh,
  signPayload,
  TIMESTAMP_HEADER,
  verifySignature,
  webhookSecret,
} from "@/lib/webhookAuth";

export const dynamic = "force-dynamic";

/**
 * Inbound webhook for a workflow.
 *
 *   POST /api/webhook/<workflowId>      JSON body becomes the trigger input
 *   GET  /api/webhook/<workflowId>      query params become the trigger input
 *
 * Security model:
 *  - `FF_WEBHOOK_SECRET` set → the request MUST carry a valid HMAC-SHA256
 *    signature over the raw body (`sha256=<hex>`). Bad/missing = 401.
 *  - not set → the request is accepted but the response reports
 *    `"authMode": "unsigned"` so the gap is always visible.
 */
async function handle(req: NextRequest, id: string) {
  const wf = await getWorkflow(id);
  if (!wf) return NextResponse.json({ error: "workflow not found" }, { status: 404 });

  const secret = webhookSecret();
  const mode = secret ? "signed" : "unsigned";
  const headers = Object.fromEntries(req.headers.entries());
  const signature = firstSignatureHeader(headers);

  /* ------------------------------ raw body ------------------------------ */
  let rawBody = "";
  if (req.method !== "GET") {
    rawBody = await req.text();
  }

  /* ------------------------------- auth --------------------------------- */
  if (mode === "signed" && req.method !== "GET") {
    if (!signature) {
      return NextResponse.json(
        {
          error: "missing signature",
          hint: `Send header 'x-flowforge-signature: ${signPayload(rawBody, secret!)}' (computed over the raw request body)`,
          authMode: mode,
        },
        { status: 401 }
      );
    }
    if (!verifySignature(rawBody, signature, secret!)) {
      return NextResponse.json(
        { error: "invalid signature", authMode: mode },
        { status: 401 }
      );
    }
    const ts = headers[TIMESTAMP_HEADER];
    if (!isTimestampFresh(ts)) {
      return NextResponse.json(
        {
          error: "stale timestamp",
          hint: `${TIMESTAMP_HEADER} must be within 300 seconds of now`,
          authMode: mode,
        },
        { status: 401 }
      );
    }
  }
  if (mode === "signed" && req.method === "GET" && signature) {
    // A GET may still be signed; verify it when a signature is supplied.
    if (!verifySignature(rawBody, signature, secret!)) {
      return NextResponse.json(
        { error: "invalid signature", authMode: mode },
        { status: 401 }
      );
    }
  }

  /* ------------------------------ payload ------------------------------- */
  let input: unknown = {};
  try {
    if (req.method !== "GET") {
      input = rawBody.trim() ? JSON.parse(rawBody) : {};
    } else {
      input = Object.fromEntries(req.nextUrl.searchParams.entries());
    }
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", authMode: mode },
      { status: 400 }
    );
  }

  /* -------------------------------- run --------------------------------- */
  const record = await executeWorkflow(
    wf.nodes,
    wf.edges,
    { workflowId: wf.id, workflowName: wf.name },
    { trigger: "webhook", initialInput: input, secrets: loadSecrets() }
  );
  await saveRun(record).catch(() => {});

  return NextResponse.json({
    ok: record.status === "success",
    authMode: mode,
    runId: record.id,
    status: record.status,
    durationMs: record.durationMs,
    toleratedCount: record.toleratedCount ?? 0,
    anySimulated: record.anySimulated ?? false,
    pendingApproval: record.pendingApproval
      ? { nodeId: record.pendingApproval.nodeId, request: record.pendingApproval.request }
      : null,
    output: record.results[record.results.length - 1]?.output ?? null,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(req, params.id);
}
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(req, params.id);
}
