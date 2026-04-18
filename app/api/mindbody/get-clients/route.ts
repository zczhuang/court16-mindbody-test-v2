import { NextResponse } from "next/server";
import { checkCallerToken, getClientsByEmail, loadConfigFromEnv } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mindbody/get-clients?email=foo@bar.com */
export async function GET(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ ok: false, correlationId, error: "email query param is required" }, { status: 400 });
  }

  try {
    const cfg = loadConfigFromEnv();
    const clients = await getClientsByEmail(cfg, log, email);
    return NextResponse.json({ ok: true, correlationId, count: clients.length, clients });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 500 });
  }
}
