import { NextResponse } from "next/server";
import { addClientToClass, checkCallerToken, loadConfigFromEnv, MindbodyError } from "@/lib/mindbody";
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
  if (body?.ClientId === undefined || body?.ClassId === undefined) {
    return NextResponse.json(
      { ok: false, correlationId, error: "ClientId and ClassId are required" },
      { status: 400 },
    );
  }

  try {
    const cfg = loadConfigFromEnv();
    const result = await addClientToClass(cfg, log, {
      ClientId: body.ClientId,
      ClassId: body.ClassId,
      ClientServiceId: body.ClientServiceId,
      Waitlist: body.Waitlist,
      SendEmail: body.SendEmail,
    });
    return NextResponse.json({ ok: true, correlationId, writeMode: cfg.writeMode, result });
  } catch (e) {
    const payload = e instanceof MindbodyError ? e.toJSON() : e instanceof Error ? { message: e.message } : e;
    return NextResponse.json(
      { ok: false, correlationId, error: payload },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}
