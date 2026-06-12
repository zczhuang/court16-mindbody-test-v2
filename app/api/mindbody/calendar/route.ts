import { NextRequest, NextResponse } from "next/server";
import { authedMindbodyGet } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { LOCATIONS, getLocationById } from "@/config/locations";
import { maxBookableDateStr } from "@/config/trial-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// YYYY-MM-DD
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/mindbody/calendar?locationId=brooklyn&startDate=2026-04-15&endDate=2026-04-30
 *     [&intent=kid_trial|adult_intro]
 *
 * Pulls the MindBody classes for a given location + date range and returns
 * the raw { Classes: [...] } shape the UI expects (same shape the reference
 * enrollment tool exposed, so components port without changes).
 *
 * The optional `intent` param narrows the MindBody pull server-side. With
 * `intent=kid_trial`, we pass the location's `kidTrialProgramId` (set by
 * the studio admin when they create a dedicated "Kid's Trials" MindBody
 * Program). Per Ibtissam May 21: Ridge Hill is Program 61, served by
 * the $0 SKU "Kid's Trial" (service 100328) — so the trial form should
 * only surface those curated trial occurrences, not all recurring kid
 * classes. If `kidTrialProgramId` is unset for the location, the route
 * falls back to the unfiltered behavior and the UI's `filterChildrenOnly`
 * post-filter takes over (legacy path for sites that haven't set up
 * Kid's Trials yet).
 */
export async function GET(request: NextRequest) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const intent = searchParams.get("intent");

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

  // Booking window (Ibtissam Jun 11): for kid trials, never return classes
  // beyond today + TRIAL_MAX_ADVANCE_DAYS — server-side authority so a
  // hand-crafted query can't see (and then book) slots weeks out.
  let effectiveEndDate = endDate;
  if (intent === "kid_trial") {
    const maxDate = maxBookableDateStr(loc.timezone);
    if (startDate > maxDate) {
      return NextResponse.json({
        classes: [],
        correlationId,
        siteId: String(loc.siteId),
        filteredByProgramId: null,
        clampedToBookingWindow: true,
      });
    }
    if (endDate > maxDate) effectiveEndDate = maxDate;
  }

  // Dev escape hatch: if the dev Api-Key isn't authorized against Court 16's
  // real site IDs yet, flip MINDBODY_USE_SANDBOX_FALLBACK=true to route all
  // calendar queries at the MINDBODY_SITE_ID env var (e.g. the -99 sandbox).
  // Proves the wiring works without blocking on Anthony's per-site authorize.
  const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
  const siteId = useSandbox ? process.env.MINDBODY_SITE_ID! : String(loc.siteId);

  // Server-side narrowing for kid_trial intent — only return classes
  // scheduled in the location's Kid's Trials program. Drops all the
  // regular recurring kid classes (Little Freshman / Junior / etc.)
  // that aren't trial-eligible. Other intents pass through unfiltered.
  const programIds =
    intent === "kid_trial" && loc.kidTrialProgramId
      ? String(loc.kidTrialProgramId)
      : undefined;

  try {
    const result = await authedMindbodyGet<{ Classes?: unknown[] }>(log, {
      siteIdOverride: siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${startDate}T00:00:00`,
        EndDateTime: `${effectiveEndDate}T23:59:59`,
        ProgramIds: programIds,
        Limit: 200,
      },
      // staffMode: attach a Source-Credentials-issued Bearer so v6 returns
      // classes that MindBody admin has flagged "hidden" (consumer mode
      // silently filters those out — empirically verified May 22 that
      // Ridge Hill Program 61 has 24 hidden trial occurrences invisible
      // without this Bearer). Falls back to consumer mode automatically
      // if MINDBODY_SOURCE_PASSWORD is unset, so the calendar still
      // renders for sites that haven't flipped on staff-token access.
      staffMode: true,
    });
    // Drop cancelled occurrences server-side. MindBody keeps returning
    // them with IsAvailable=true, and the kid_trial Program-filtered path
    // skips the legacy filterChildrenOnly() that used to weed them out —
    // which let a parent-facing calendar offer a cancelled class (verified
    // live Jun 12: class 15680 was cancelled overnight, still bookable,
    // staff confirm then failed with "Class is cancelled").
    const classes = (result.Classes ?? []).filter(
      (c) => !(c as { IsCanceled?: boolean }).IsCanceled,
    );
    return NextResponse.json({
      classes,
      correlationId,
      siteId,
      filteredByProgramId: programIds ? Number(programIds) : null,
    });
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
