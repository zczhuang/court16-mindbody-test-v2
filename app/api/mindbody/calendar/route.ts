import { NextRequest, NextResponse } from "next/server";
import { authedMindbodyGet } from "@/lib/mindbody";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { LOCATIONS, getLocationById } from "@/config/locations";
import { maxBookableDateStr, todayStrInTz, TRIAL_CONFIG } from "@/config/trial-config";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import { filterConfiguredKidsSchedule } from "@/lib/kids-calendar";
import { toCalendarClassDto } from "@/lib/calendar-dto";
import { isAdultProgram } from "@/config/adult-config";
import type { MindBodyClass } from "@/lib/trial-types";
import {
  resolveMindbodyPaginationPage,
  type MindbodyPaginationMetadata,
} from "@/lib/mindbody-pagination";
import {
  getKidsTrialCalendarPreviewReadiness,
  getKidsTrialReadiness,
  type KidsTrialCalendarPreviewScope,
} from "@/config/kids-trial-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// YYYY-MM-DD
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_LIMIT = 200;
const MAX_PAGES_PER_PROGRAM = 20;
const ADULT_CALENDAR_MAX_DAYS = 31;
const PREVIEW_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

type CalendarIntent = "kid_trial" | "adult_intro";

interface MindbodyClassesResponse {
  Classes?: MindBodyClass[];
  PaginationResponse?: MindbodyPaginationMetadata;
}

function calendarSuccess(body: Record<string, unknown>, cachePreview: boolean) {
  return NextResponse.json(
    body,
    cachePreview ? { headers: { "Cache-Control": PREVIEW_CACHE_CONTROL } } : undefined,
  );
}

function parseCalendarDate(value: string): number | null {
  if (!DATE_REGEX.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2100) return null;
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
}

function isCalendarIntent(value: string | null): value is CalendarIntent {
  return value === "kid_trial" || value === "adult_intro";
}

/**
 * Mindbody does not accept this client's comma-joined ProgramIds as a
 * multi-program filter. Read one explicit Program at a time, paginate it to
 * completion, then let the caller merge and validate the rows.
 */
async function fetchProgramClasses(
  log: ReturnType<typeof createLogger>,
  input: {
    siteId: string;
    startDate: string;
    endDate: string;
    programId: number;
    includeHidden: boolean;
  },
): Promise<MindBodyClass[]> {
  const classes: MindBodyClass[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES_PER_PROGRAM; page++) {
    const result = await authedMindbodyGet<MindbodyClassesResponse>(log, {
      siteIdOverride: input.siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${input.startDate}T00:00:00`,
        EndDateTime: `${input.endDate}T23:59:59`,
        ProgramIds: String(input.programId),
        Limit: PAGE_LIMIT,
        Offset: offset,
      },
      ...(input.includeHidden ? { staffMode: true } : { consumerMode: true }),
    });

    const pageClasses = result.Classes ?? [];
    classes.push(...pageClasses);
    const decision = resolveMindbodyPaginationPage({
      currentOffset: offset,
      requestedLimit: PAGE_LIMIT,
      pageLength: pageClasses.length,
      pagination: result.PaginationResponse,
    });
    if (decision.complete) return classes;
    offset = decision.nextOffset;
  }

  throw new Error(`Mindbody pagination exceeded its safety cap for Program ${input.programId}`);
}

/**
 * GET /api/mindbody/calendar?locationId=brooklyn&startDate=2026-04-15&endDate=2026-04-30
 *     &intent=kid_trial|adult_intro
 *
 * Pulls Mindbody classes for a bounded location/date/intent query and returns
 * a narrow parent-facing calendar projection.
 *
 * The required `intent` param narrows the Mindbody pull server-side. A fully
 * ready trial flow or a dedicated trial preview reads only `kidTrialProgramId`.
 * An authorized preview without a dedicated Program may read only the site's
 * explicit `kidsCalendarProgramIds`, is labeled as a regular-kids schedule,
 * uses public consumer visibility, and can never initiate a booking.
 */
export async function GET(request: NextRequest) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const intent = searchParams.get("intent");

  if (!locationId || !startDate || !endDate || !intent) {
    return NextResponse.json(
      { error: "Missing required params: locationId, startDate, endDate, intent" },
      { status: 400 },
    );
  }
  if (!isCalendarIntent(intent)) {
    return NextResponse.json(
      { error: "Invalid intent. Use kid_trial or adult_intro" },
      { status: 400 },
    );
  }
  if (!LOCATIONS.some((l) => l.id === locationId)) {
    return NextResponse.json({ error: "Invalid locationId" }, { status: 400 });
  }
  const startTimestamp = parseCalendarDate(startDate);
  const endTimestamp = parseCalendarDate(endDate);
  if (startTimestamp == null || endTimestamp == null || startTimestamp > endTimestamp) {
    return NextResponse.json(
      { error: "Invalid calendar window. Use real YYYY-MM-DD dates with startDate <= endDate" },
      { status: 400 },
    );
  }

  const loc = getLocationById(locationId)!;
  if (intent === "kid_trial") {
    const today = todayStrInTz(loc.timezone);
    const maxDate = maxBookableDateStr(loc.timezone);
    if (startDate < today || endDate > maxDate) {
      return NextResponse.json(
        { error: `Kids calendar dates must stay between ${today} and ${maxDate}` },
        { status: 400 },
      );
    }
  } else {
    const inclusiveDays = Math.floor((endTimestamp - startTimestamp) / 86_400_000) + 1;
    if (inclusiveDays > ADULT_CALENDAR_MAX_DAYS) {
      return NextResponse.json(
        { error: `Adult calendar requests are limited to ${ADULT_CALENDAR_MAX_DAYS} days` },
        { status: 400 },
      );
    }
  }

  const trialReadiness =
    intent === "kid_trial"
      ? getKidsTrialReadiness({
          location: loc,
          trialConfig: TRIAL_CONFIG[loc.id],
          pipeline: getDealPipeline(loc.id),
          preferredLocation: getHubspotPreferredLocation(loc.id),
        })
      : null;

  let calendarScope: KidsTrialCalendarPreviewScope | null = null;
  let previewOnly = false;
  let programIds: number[] = [];
  if (trialReadiness) {
    if (trialReadiness.ready) {
      calendarScope = "trial_program";
      programIds = [trialReadiness.programId];
    } else {
      // Browse-only escape hatch. It never relaxes booking: the intake route
      // still enforces complete public readiness on every submission.
      const preview = getKidsTrialCalendarPreviewReadiness({
        location: loc,
      });
      if (!preview.ready) {
        log.warn("calendar.trial-location.not-ready", {
          locationId: loc.id,
          missing: trialReadiness.missing,
          previewMissing: preview.missing,
        });
        return NextResponse.json(
          {
            error: "Kids trial scheduling is not yet available for this club.",
            code: "trial_location_not_ready",
            locationId: loc.id,
          },
          { status: 409 },
        );
      }
      previewOnly = true;
      calendarScope = preview.scope;
      programIds = preview.programIds;
      log.info("calendar.trial-location.preview-only", {
        locationId: loc.id,
        calendarScope,
        programIds,
      });
    }
  }

  // Dev escape hatch: if the dev Api-Key isn't authorized against Court 16's
  // real site IDs yet, flip MINDBODY_USE_SANDBOX_FALLBACK=true to route all
  // calendar queries at the MINDBODY_SITE_ID env var (e.g. the -99 sandbox).
  // Proves the wiring works without blocking on Anthony's per-site authorize.
  const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
  const siteId = useSandbox ? process.env.MINDBODY_SITE_ID! : String(loc.siteId);

  try {
    let classes: MindBodyClass[];
    if (intent === "kid_trial") {
      // An empty configured allowlist is an honest empty preview. Never turn
      // it into an unfiltered class request.
      if (programIds.length === 0) {
        return calendarSuccess(
          {
            classes: [],
            siteId,
            filteredByProgramId: null,
            filteredByProgramIds: [],
            calendarScope,
            previewOnly,
            inventoryConfigured: false,
          },
          true,
        );
      }

      const merged: MindBodyClass[] = [];
      for (const programId of programIds) {
        merged.push(
          ...(await fetchProgramClasses(log, {
            siteId,
            startDate,
            endDate,
            programId,
            // Dedicated trial Programs may be hidden by Mindbody. Regular
            // kids schedules deliberately use public visibility only.
            includeHidden: calendarScope === "trial_program",
          })),
        );
      }

      const unique = Array.from(new Map(merged.map((c) => [c.Id, c])).values());
      classes =
        calendarScope === "kids_schedule"
          ? filterConfiguredKidsSchedule(unique, programIds)
          : unique.filter(
              (c) =>
                !c.IsCanceled &&
                programIds.includes(c.ClassDescription?.Program?.Id),
            );
    } else {
      // Adult intro is public consumer inventory only. The strict Program-name
      // boundary prevents kids, rentals, and unknown programs from leaving the
      // route; hidden staff classes are never requested.
      const result = await authedMindbodyGet<MindbodyClassesResponse>(log, {
        siteIdOverride: siteId,
        path: "/class/classes",
        query: {
          StartDateTime: `${startDate}T00:00:00`,
          EndDateTime: `${endDate}T23:59:59`,
          Limit: PAGE_LIMIT,
        },
        consumerMode: true,
      });
      classes = (result.Classes ?? []).filter(
        (c) => !c.IsCanceled && isAdultProgram(c.ClassDescription?.Program?.Name),
      );
    }

    return calendarSuccess(
      {
        classes: classes.map(toCalendarClassDto),
        ...(!previewOnly ? { correlationId } : {}),
        siteId,
        filteredByProgramId: programIds.length === 1 ? programIds[0] : null,
        filteredByProgramIds: programIds,
        calendarScope,
        previewOnly,
        inventoryConfigured: intent !== "kid_trial" || programIds.length > 0,
      },
      previewOnly,
    );
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
