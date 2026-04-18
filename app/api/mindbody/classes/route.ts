import { NextResponse } from "next/server";
import { checkCallerToken, getClasses, loadConfigFromEnv } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mindbody/classes?startDateTime=2026-04-18&endDateTime=2026-04-25&limit=20
 * Handy when you need a real ClassId to plug into /happy-path.
 */
export async function GET(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const startDateTime = url.searchParams.get("startDateTime") ?? undefined;
  const endDateTime = url.searchParams.get("endDateTime") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const cfg = loadConfigFromEnv();
    const classes = await getClasses(cfg, log, { startDateTime, endDateTime, limit });
    return NextResponse.json({ ok: true, correlationId, count: classes.length, classes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 500 });
  }
}
