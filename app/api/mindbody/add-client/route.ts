import { NextResponse } from "next/server";
import { addClient, checkCallerToken, loadConfigFromEnv, MindbodyError } from "@/lib/mindbody";
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
  if (!body?.FirstName || !body?.LastName || !body?.Email) {
    return NextResponse.json(
      { ok: false, correlationId, error: "FirstName, LastName, and Email are required" },
      { status: 400 },
    );
  }

  try {
    const cfg = loadConfigFromEnv();
    const client = await addClient(cfg, log, {
      FirstName: body.FirstName,
      LastName: body.LastName,
      Email: body.Email,
      BirthDate: body.BirthDate,
      MobilePhone: body.MobilePhone,
    });
    return NextResponse.json({ ok: true, correlationId, writeMode: cfg.writeMode, client });
  } catch (e) {
    const payload = e instanceof MindbodyError ? e.toJSON() : e instanceof Error ? { message: e.message } : e;
    return NextResponse.json(
      { ok: false, correlationId, error: payload },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}
