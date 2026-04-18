import { NextResponse } from "next/server";
import { addClientRelationship, checkCallerToken, loadConfigFromEnv, MindbodyError } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, correlationId, error: "Invalid JSON body" }, { status: 400 });
  }
  if (body?.ClientId === undefined || body?.RelatedClientId === undefined) {
    return NextResponse.json(
      { ok: false, correlationId, error: "ClientId and RelatedClientId are required" },
      { status: 400 },
    );
  }

  try {
    const cfg = loadConfigFromEnv();
    const rel = await addClientRelationship(cfg, log, {
      ClientId: body.ClientId,
      RelatedClientId: body.RelatedClientId,
      RelationshipId: body.RelationshipId ?? 20, // 20 = Guardian in MindBody's default catalog
    });
    return NextResponse.json({ ok: true, correlationId, writeMode: cfg.writeMode, result: rel });
  } catch (e) {
    const payload = e instanceof MindbodyError ? e.toJSON() : e instanceof Error ? { message: e.message } : e;
    return NextResponse.json(
      { ok: false, correlationId, error: payload },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}
