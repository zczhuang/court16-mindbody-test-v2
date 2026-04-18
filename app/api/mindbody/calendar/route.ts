import { NextRequest, NextResponse } from "next/server";
import { authedMindbodyGet } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { LOCATIONS, getLocationById } from "@/config/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// YYYY-MM-DD
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/mindbody/calendar?locationId=brooklyn&startDate=2026-04-15&endDate=2026-04-30
 *
 * Pulls the MindBody classes for a given location + date range and returns
 * the raw { Classes: [...] } shape the UI expects (same shape the reference
 * enrollment tool exposed, so components port without changes).
 */
export async function GET(request: NextRequest) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!locationId || !startDate || !endDate) {
    return NextResponse.json(
      { error: "Missing required params: locationId, startDate, endDate" },
      { status: 400 },
    );
  }
  if (!LOCATIONS.some((l) => l.id === locationId)) {
    return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
  }
  if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
  }

  const loc = getLocationById(locationId)!;

  // Dev escape hatch: if the dev Api-Key isn't authorized against Court 16's
  // real site IDs yet, flip MINDBODY_USE_SANDBOX_FALLBACK=true to route all
  // calendar queries at the MINDBODY_SITE_ID env var (e.g. the -99 sandbox).
  // Proves the wiring works without blocking on Anthony's per-site authorize.
  const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
  const siteId = useSandbox ? process.env.MINDBODY_SITE_ID! : String(loc.siteId);

  try {
    const result = await authedMindbodyGet<{ Classes?: unknown[] }>(log, {
      siteIdOverride: siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${startDate}T00:00:00`,
        EndDateTime: `${endDate}T23:59:59`,
        Limit: 200,
      },
    });
    return NextResponse.json({ classes: result.Classes ?? [], correlationId, siteId });
  } catch (err) {
    log.error("calendar.fail", {
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return NextResponse.json(
      { error: "Failed to fetch classes from MindBody", correlationId },
      { status: 502 },
    );
  }
}
