import { NextResponse } from "next/server";
import {
  addClient,
  authedMindbodyGet,
  checkCallerToken,
  getClientsByEmail,
  getClientsByIds,
  loadConfigFromEnv,
  MindbodyError,
  pickAdultClient,
} from "@/lib/mindbody";
import {
  createTrialDeal,
  findContactByEmail,
  findOtherActiveBookingDealsByParentEmail,
  findRecordedMindbodyIdsFromDealHistory,
  getContactById,
  getDealByActiveParentKey,
  getDealByBookingKey,
  HubspotActiveBookingConflictError,
  HubspotError,
  loadHubspotConfig,
  submitTrialForm,
  updateContact,
  updateDealProperties,
  upsertContactByEmail,
  type DealRecord,
} from "@/lib/hubspot";
import { buildStaffUrl } from "@/lib/staff-tokens";
import { buildActiveParentKey } from "@/lib/booking-identity";
import { classifyIntent } from "@/lib/intent";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import {
  ageFromDob,
  formatClassDayTime,
  parseAgeRangeFromTitle,
  siteLocalToUtcIso,
} from "@/lib/class-utils";
import { getLocationById } from "@/config/locations";
import {
  TRIAL_SMOKE_TEST_HEADER,
  getTrialSmokeTest,
  trialSmokeTestCommunicationFlags,
} from "@/lib/trial-smoke-test";
import { TRIAL_CONFIG } from "@/config/trial-config";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import { getKidsTrialReadiness } from "@/config/kids-trial-readiness";
import type { MindBodyClass, TrialRequest } from "@/lib/trial-types";
import { consumeSignupRateLimit } from "@/lib/request-rate-limit";
import {
  acquireDistributedActionLock,
  DistributedActionLockError,
  type DistributedActionLockHandle,
} from "@/lib/distributed-action-lock";
import { getMindbodyWriteGuard } from "@/lib/mindbody-write-guard";
import {
  buildBookingDealProperties,
  parseBookingDealLedger,
  type BookingDealLedgerPatch,
  type FamilyProvisioningStatus,
} from "@/lib/hubspot-deal-ledger";
import {
  MAX_KIDS_TRIAL_AGE,
  MIN_KIDS_TRIAL_AGE,
  buildMindbodyHouseholdAddress,
  buildMindbodyParentEmergencyContact,
  isValidIsoDate,
  normalizeMindbodyProfileDetails,
  validateMindbodyProfileDetails,
  validateSingleTrialChildPayload,
} from "@/lib/trial-intake";
import {
  buildHubspotTrialReportingFields,
} from "@/lib/trial-reporting";
import {
  getTrialBookingWindowState,
  isValidMindbodyClassStart,
  TRIAL_BOOKING_WINDOW_DAYS,
  TRIAL_MIN_BOOKING_NOTICE_HOURS,
} from "@/lib/trial-booking-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WAIVER_VERSION = "v1.0";

function bookingWindowFailure(
  classStartsAt: string,
  timezone: string,
  correlationId: string,
): NextResponse | null {
  if (!isValidMindbodyClassStart(classStartsAt)) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_class_start_invalid",
        error: "The selected class start time is invalid. Please refresh and choose again.",
      },
      { status: 400 },
    );
  }
  let classStartsAtUtc: string;
  try {
    classStartsAtUtc = siteLocalToUtcIso(classStartsAt, timezone);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_class_start_invalid",
        error: "The selected class start time is invalid. Please refresh and choose again.",
      },
      { status: 400 },
    );
  }

  const state = getTrialBookingWindowState(classStartsAtUtc);
  if (state.status === "open") return null;
  if (state.status === "not_open") {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_booking_not_open",
        error: `Trial booking opens ${TRIAL_BOOKING_WINDOW_DAYS} days before class. Please check back closer to the class date.`,
      },
      { status: 409 },
    );
  }
  if (state.status === "closed") {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_booking_closed",
        error: `Online trial booking requires at least ${TRIAL_MIN_BOOKING_NOTICE_HOURS} hours' notice. Please choose another class.`,
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      correlationId,
      code: "trial_class_start_invalid",
      error: "The selected class start time is invalid. Please refresh and choose again.",
    },
    { status: 400 },
  );
}

/** Map an integer age to the closest HubSpot `childage` band value. */
function ageToBand(age: number): string {
  if (age <= 3) return "2.5 - 3 yo";
  if (age === 4) return "3 - 4 yo";
  if (age <= 6) return "5 - 6 yo";
  if (age <= 8) return "7 - 8 yo";
  if (age <= 11) return "9 - 11 yo";
  if (age <= 15) return "12 yo or older";
  return "15 and older";
}

export async function POST(req: Request) {
  let correlationId = makeCorrelationId();
  let log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  let body: TrialRequest;
  try {
    body = (await req.json()) as TrialRequest;
  } catch {
    return NextResponse.json({ ok: false, correlationId, error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validate(body);
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, correlationId, errors }, { status: 400 });
  }
  body = normalizeValidatedRequest(body);
  correlationId = body.submissionId;
  log = createLogger(correlationId);

  // Reject preview-only or unknown locations before touching the rate-limit
  // bucket or distributed lock. A forced POST from the production form
  // preview must not touch shared mutable booking state.
  const location = getLocationById(body.locationId);
  if (!location) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown locationId: ${body.locationId}` },
      { status: 400 },
    );
  }

  // Resolve smoke-test intent as soon as the club is known, before readiness,
  // Mindbody, HubSpot, the distributed lock, or any other side effect. A
  // request that declared smoke intent but failed to qualify must abort here,
  // never continue as a normal booking: Mindbody has no client-delete API, so
  // a real family record for a fake child would be permanent.
  const smokeTest = getTrialSmokeTest(
    location.siteId,
    req.headers.get(TRIAL_SMOKE_TEST_HEADER),
  );
  if (smokeTest.mode === "rejected") {
    log.warn("trial.smoke-test.rejected", {
      locationId: location.id,
      siteId: location.siteId,
      reason: smokeTest.reason,
    });
    // The reason is deliberately server-side only; the client is not told
    // whether this deployment has a smoke lane or which check failed.
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_request_not_authorized",
        error: "This request could not be authorized.",
      },
      { status: 403 },
    );
  }

  const trialReadiness = getKidsTrialReadiness({
    location,
    trialConfig: TRIAL_CONFIG[location.id],
    pipeline: getDealPipeline(location.id),
    preferredLocation: getHubspotPreferredLocation(location.id),
  });
  if (!trialReadiness.ready) {
    log.warn("trial.location.not-ready", {
      locationId: location.id,
      missing: trialReadiness.missing,
    });
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_location_not_ready",
        error: "Kids trial scheduling is not yet available for this club.",
      },
      { status: 409 },
    );
  }

  // Reject classes outside the approved 7-day-to-48-hour window before any
  // rate-limit, lock, or vendor state is touched. The canonical Mindbody
  // occurrence is checked again below before writes begin.
  const requestedWindowFailure = bookingWindowFailure(
    body.classStartsAt!,
    location.timezone,
    correlationId,
  );
  if (requestedWindowFailure) return requestedWindowFailure;

  const rateLimit = consumeSignupRateLimit(req, "kid-trial", body.parentEmail);
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "rate_limited",
        error: "Too many requests. Please wait before trying again.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) },
      },
    );
  }

  let signupLock: DistributedActionLockHandle | null;
  try {
    signupLock = await acquireDistributedActionLock(
      `kid-trial:${body.parentEmail.trim().toLowerCase()}`,
    );
  } catch (error) {
    log.error("trial.distributed-lock.unavailable", {
      code: error instanceof DistributedActionLockError ? error.code : "unknown",
    });
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "mutation_lock_unavailable",
        error: "Trial requests are temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
  if (!signupLock) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "request_in_progress",
        error: "A trial request for this email is already being processed. Please wait.",
      },
      { status: 409 },
    );
  }

  try {

  if (process.env.HUBSPOT_DEAL_LEDGER_ENABLED !== "true") {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "hubspot_deal_ledger_not_enabled",
        error: "Trial requests are not enabled until the booking ledger is verified.",
      },
      { status: 503 },
    );
  }
  if (process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM === "true") {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "hubspot_legacy_form_conflict",
        error:
          "Trial requests are disabled while the legacy HubSpot form workflow is enabled. Disable it before using the Deal ledger.",
      },
      { status: 503 },
    );
  }
  const { preferredLocation, programId, trialConfig } = trialReadiness;
  const siteProfileErrors = validateMindbodyProfileDetails(
    body,
    trialConfig.mindbodyGenderOptions,
  );
  if (siteProfileErrors.length > 0) {
    return NextResponse.json(
      { ok: false, correlationId, errors: siteProfileErrors },
      { status: 400 },
    );
  }

  let mbCfg;
  let verifiedMindbodyLocationId: number | undefined;
  try {
    const base = loadConfigFromEnv();
    // Match /api/mindbody/calendar: in sandbox-fallback mode use the -99
    // env SiteId, otherwise use the per-location production SiteId.
    const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
    mbCfg = { ...base, siteId: useSandbox ? base.siteId : String(location.siteId) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 500 });
  }
  const writeGuard = getMindbodyWriteGuard(mbCfg.siteId);
  if (!writeGuard.allowed) {
    log.warn("trial.mindbody-writes.blocked", {
      locationId: location.id,
      siteId: mbCfg.siteId,
      reason: writeGuard.reason,
    });
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "mindbody_writes_not_authorized",
        error: "Trial account setup is not yet authorized for this club.",
      },
      { status: 503 },
    );
  }
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "hubspot_not_configured",
        error: "Trial requests are temporarily unavailable. Please contact Court 16.",
      },
      { status: 503 },
    );
  }
  const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:3000`;
  const hsContext = sanitizeHsContext(body.hsContext);

  // Track 1 accepts exactly one validated child; multi-child is Track 2.
  const primaryKid = body.children[0];
  // validate() guarantees these — real values per Ibtissam's review (Jun 11):
  // no more "-" last name or Jan-1 synthesized DOB on the MindBody record.
  const childLastName = primaryKid.lastName;
  const childDob = primaryKid.birthDate;
  const childAge = ageFromDob(childDob);
  const ageBand = ageToBand(childAge);
  const mindbodyProfile = normalizeMindbodyProfileDetails(body);

  // Re-read the selected occurrence directly from Mindbody before creating
  // any client or HubSpot record. Browser-supplied IDs are only a selection
  // hint; without this check a hand-crafted request could target a regular
  // class, another program, a cancelled occurrence, or a full class.
  try {
    const classDate = body.classStartsAt!.slice(0, 10);
    const result = await authedMindbodyGet<{ Classes?: MindBodyClass[] }>(log, {
      siteIdOverride: mbCfg.siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${classDate}T00:00:00`,
        EndDateTime: `${classDate}T23:59:59`,
        ProgramIds: String(programId),
        Limit: 200,
      },
      staffMode: true,
    });
    const liveClass = (result.Classes ?? []).find(
      (candidate) =>
        Number(candidate.Id) === body.classId &&
        Number(candidate.ClassScheduleId) === body.classScheduleId,
    );
    const liveProgramId = Number(liveClass?.ClassDescription?.Program?.Id);
    const liveLocationId = Number(liveClass?.Location?.Id);
    const liveSiteId = Number(liveClass?.Location?.SiteID);
    const expectedLiveSiteId = Number(mbCfg.siteId);
    const locationMatches =
      Number.isInteger(liveLocationId) &&
      liveLocationId > 0 &&
      liveSiteId === expectedLiveSiteId;
    const spotsRemaining = liveClass
      ? typeof liveClass.WebCapacity === "number"
        ? Number(liveClass.WebCapacity) - Number(liveClass.WebBooked ?? 0)
        : Number(liveClass.MaxCapacity) - Number(liveClass.TotalBooked)
      : 0;
    if (
      !liveClass ||
      liveProgramId !== programId ||
      liveClass.StartDateTime !== body.classStartsAt ||
      !locationMatches ||
      liveClass.IsCanceled ||
      !liveClass.IsAvailable ||
      spotsRemaining <= 0
    ) {
      log.warn("trial.class.not-available", {
        locationId: location.id,
        classId: body.classId,
        classScheduleId: body.classScheduleId,
        found: Boolean(liveClass),
        programMatches: liveProgramId === programId,
        expectedSiteId: expectedLiveSiteId,
        liveSiteId: Number.isFinite(liveSiteId) ? liveSiteId : null,
        liveLocationId: Number.isFinite(liveLocationId) ? liveLocationId : null,
        locationMatches,
        startMatches: liveClass?.StartDateTime === body.classStartsAt,
        canceled: liveClass?.IsCanceled ?? null,
        available: liveClass?.IsAvailable ?? null,
        spotsRemaining,
      });
      return NextResponse.json(
        {
          ok: false,
          correlationId,
          code: "trial_class_not_available",
          error: "That trial class is no longer available. Please refresh and choose another time.",
        },
        { status: 409 },
      );
    }

    const canonicalClassName =
      liveClass.ClassDescription?.Name || liveClass.ClassName || body.className;
    verifiedMindbodyLocationId = liveLocationId;
    const canonicalAgeErrors = validateClassAge(body, canonicalClassName);
    if (canonicalAgeErrors.length > 0) {
      return NextResponse.json(
        { ok: false, correlationId, errors: canonicalAgeErrors },
        { status: 400 },
      );
    }
    // Use only Mindbody-owned occurrence metadata in HubSpot/logging. The
    // client continues to provide parent/child form data, never class facts.
    body = {
      ...body,
      className: canonicalClassName,
      classStartsAt: liveClass.StartDateTime,
      coachName:
        liveClass.Staff?.DisplayName ||
        [liveClass.Staff?.FirstName, liveClass.Staff?.LastName].filter(Boolean).join(" ") ||
        body.coachName,
    };
  } catch (e) {
    log.error("trial.class.verify-failed", { error: serialize(e) });
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_class_verification_failed",
        error: "We could not safely verify that trial class. Please try again shortly.",
      },
      { status: 502 },
    );
  }

  // MindBody returns `StartDateTime` as site-local wall-clock without a TZ
  // suffix. Convert to absolute UTC ISO here so HubSpot Deal `class_date`
  // (and downstream the 24h-reminder workflow) fire at the right instant.
  // Caught by smoke #2 v2 (Bug D).
  const classStartsAtUtc = body.classStartsAt
    ? siteLocalToUtcIso(body.classStartsAt, location.timezone)
    : undefined;
  const canonicalWindowFailure = bookingWindowFailure(
    body.classStartsAt!,
    location.timezone,
    correlationId,
  );
  if (canonicalWindowFailure) return canonicalWindowFailure;

  const bookingLedgerBase: Omit<BookingDealLedgerPatch, "bookingStatus"> = {
    correlationId,
    activeParentKey: buildActiveParentKey(body.parentEmail),
    intent: "kid_trial",
    locationSlug: location.id,
    mindbodySiteId: mbCfg.siteId,
    mindbodyLocationId: verifiedMindbodyLocationId,
    mindbodyProgramId: programId,
    mindbodyServiceId: trialConfig.trialServiceId,
    mindbodyServiceName: trialConfig.trialServiceName,
    classId: body.classId,
    classScheduleId: body.classScheduleId,
    className: body.className,
    classDayTime: body.classStartsAt
      ? formatClassDayTime(body.classStartsAt, location.timezone)
      : `${body.classDay} ${body.classTime}`,
    coachName: body.coachName,
    parentEmail: body.parentEmail,
    childFirstName: primaryKid.firstName,
    childLastName,
    childBirthDate: childDob,
    waiverVersion: WAIVER_VERSION,
    staffConfirmUrl: buildStaffUrl({ action: "confirm", correlationId, baseUrl }),
    staffReassignUrl: buildStaffUrl({ action: "reassign", correlationId, baseUrl }),
    staffDenyUrl: buildStaffUrl({ action: "deny", correlationId, baseUrl }),
  };

  log.info("trial.start", {
    writeMode: mbCfg.writeMode,
    location: location.id,
    classScheduleId: body.classScheduleId,
  });

  const trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }> = [];

  // Degraded mode: if MindBody is down (token 500, Go-Live pending),
  // still capture the lead in HubSpot with status=manual_review so the
  // parent doesn't see a 502 and staff can follow up by hand.
  let mbDegraded = false;

  // Contact-scoped Mindbody IDs are a temporary ownership cache, not a
  // cross-site identity. Preserve their original site pairing when a parent
  // requests a different club or when legacy data has no owning site.
  let protectedMindbodyOwnership: {
    locationSlug?: string;
    parentId?: string;
    childId?: string;
  } | null = null;

  // Create the immutable Deal work item before any Mindbody write. A browser
  // retry carries the same submission UUID, so a cached Deal is a read-only
  // replay signal: never repeat AddClient from that request.
  const intakeResult = await createIntakeDealSafely(
    hsCfg,
    log,
    {
      email: body.parentEmail,
      correlationId,
      locationId: location.id,
      classStartsAt: classStartsAtUtc,
      dealProperties: buildBookingDealProperties({
        ...bookingLedgerBase,
        bookingStatus: "intake_started",
        enrollmentStatus: "not_started",
        mindbodyMutationStatus: "not_started",
        familyProvisioningStatus: "not_started",
      }),
      dealName: `${primaryKid.firstName} ${childLastName} - ${body.parentEmail}`,
      amount: 0,
    },
    trace,
  );
  if (!intakeResult) return hubspotWorkItemFailure(correlationId);
  if ("activeDeal" in intakeResult) {
    return activeBookingConflictResponse(correlationId);
  }
  const intakeWorkItem = intakeResult;
  if (intakeWorkItem.cached) {
    return handleCachedBookingSafely(
      hsCfg,
      log,
      intakeWorkItem,
      bookingLedgerBase,
      correlationId,
    );
  }

  // A browser can generate a different submission UUID for the same parent.
  // Guard the normalized email against all other active Deal work items before
  // any Mindbody mutation. Search ambiguity is a hard stop: preserve the new
  // Deal for staff review instead of guessing that no prior request exists.
  try {
    const otherActiveDeals = await findOtherActiveBookingDealsByParentEmail(
      hsCfg,
      log,
      body.parentEmail,
      intakeWorkItem.dealId,
    );
    trace.push({
      step: "hubspot.activeBookingGuard",
      status: "ok",
      data: {
        excludedDealId: intakeWorkItem.dealId,
        otherDealIds: otherActiveDeals.map((deal) => deal.id),
      },
    });
    if (otherActiveDeals.length > 0) {
      log.warn("trial.active-deal.exists", {
        dealId: intakeWorkItem.dealId,
        otherDeals: otherActiveDeals.map((deal) => ({
          id: deal.id,
          status: deal.properties.court16_booking_status,
          bookingKey: deal.properties.court16_booking_key,
        })),
      });
      const recorded = await markWorkItemManualSafely(
        hsCfg,
        log,
        intakeWorkItem.dealId,
        bookingLedgerBase,
        `Another active booking Deal exists for this parent (${otherActiveDeals
          .map((deal) => deal.id)
          .join(", ")}); no Mindbody write was attempted.`,
      );
      return recorded
        ? durableManualReviewResponse(correlationId)
        : hubspotWorkItemFailure(correlationId);
    }
  } catch (e) {
    log.error("trial.active-deal.guard-failed", { error: serialize(e) });
    trace.push({
      step: "hubspot.activeBookingGuard",
      status: "error",
      error: serialize(e),
    });
    const recorded = await markWorkItemManualSafely(
      hsCfg,
      log,
      intakeWorkItem.dealId,
      bookingLedgerBase,
      `The active booking Deal check was unavailable or ambiguous; no Mindbody write was attempted. ${
        e instanceof Error ? e.message : String(e)
      }`.slice(0, 4000),
    );
    return recorded
      ? durableManualReviewResponse(correlationId)
      : hubspotWorkItemFailure(correlationId);
  }

  try {
    let existing: Awaited<ReturnType<typeof getClientsByEmail>> = [];

    // ID-first duplicate guard (Jul 10): MindBody's email search misses
    // existing records even in staff mode, so a repeat booking could
    // silently create a second parent+child. Past bookings stamp the
    // MindBody ids on the HubSpot contact — trust those first, verified
    // by direct ID lookup (which is reliable where SearchText is not).
    let idGuardAmbiguous = false;
    if (hsCfg) {
      try {
        const contact = await findContactByEmail(hsCfg, log, body.parentEmail, [
          "court16_mindbody_parent_id",
          "court16_mindbody_child_id",
          "court16_booking_status",
          "court16_correlation_id",
          "court16_location_slug",
        ]);
        const activeStatuses = new Set([
          "pending_staff",
          "manual_review",
          "duplicate_email_softwall",
          "pending_payment",
          "pending_staff_assist",
        ]);
        const activeStatus = contact?.properties?.court16_booking_status;
        if (activeStatus && activeStatuses.has(activeStatus)) {
          log.warn("trial.active-request.exists", {
            contactId: contact.id,
            activeStatus,
            activeCorrelationId: contact.properties.court16_correlation_id ?? null,
          });
          const recorded = await markWorkItemManualSafely(
            hsCfg,
            log,
            intakeWorkItem.dealId,
            bookingLedgerBase,
            "Another active request exists on the shared Contact; review the per-request Deals before any Mindbody write.",
          );
          return recorded
            ? durableManualReviewResponse(correlationId)
            : hubspotWorkItemFailure(correlationId);
        }
        const storedLocationSlug = contact?.properties?.court16_location_slug?.trim() || undefined;
        const storedIdsBelongToThisSite = storedLocationSlug === location.id;
        const storedParentId =
          contact?.properties?.court16_mindbody_parent_id?.trim() || undefined;
        const storedChildId = contact?.properties?.court16_mindbody_child_id?.trim() || undefined;
        const storedIds = [storedParentId, storedChildId].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        // Ledger Deals — including terminal denied/failed/confirmed ones the
        // active-parent fence no longer covers — are the durable record of the
        // Mindbody IDs this club already created for this parent. Without this
        // lookup a family created under ledger v1 becomes invisible to the ID
        // guard after staff denial, and a resubmission would rely only on
        // Mindbody's unreliable email search (the BLINK duplicate failure).
        // A throw here falls through to the fail-closed catch below.
        const dealHistory = await findRecordedMindbodyIdsFromDealHistory(
          hsCfg,
          log,
          body.parentEmail,
          location.id,
          String(location.siteId),
        );
        trace.push({
          step: "dealHistoryGuard",
          status: "ok",
          data: { dealCount: dealHistory.dealCount, recordedIds: dealHistory.ids.length },
        });
        const knownIds = [
          ...new Set([...(storedIdsBelongToThisSite ? storedIds : []), ...dealHistory.ids]),
        ];
        if (knownIds.length > 0) {
          existing = await getClientsByIds(mbCfg, log, knownIds);
          idGuardAmbiguous = existing.length === 0;
          trace.push({
            step: "idFirstGuard",
            status: "ok",
            data: { knownIds, verified: existing.length, ambiguous: idGuardAmbiguous },
          });
        } else if (storedIds.length > 0 && !storedIdsBelongToThisSite) {
          // A Mindbody Client.Id is site-scoped. Until the per-booking Deal
          // ledger stores one ID pair per site, never auto-create or reuse a
          // family when the Contact's only known IDs belong to another club
          // or came from legacy data with no owning-site slug.
          idGuardAmbiguous = true;
          protectedMindbodyOwnership = {
            locationSlug: storedLocationSlug,
            parentId: storedParentId,
            childId: storedChildId,
          };
          trace.push({
            step: "idFirstGuard",
            status: "skipped",
            data: {
              reason: storedLocationSlug
                ? "stored MindBody ids belong to another site; manual review required"
                : "stored MindBody ids have no owning site; manual review required",
              storedLocationSlug: storedLocationSlug ?? null,
              requestLocationSlug: location.id,
            },
          });
        } else {
          trace.push({
            step: "idFirstGuard",
            status: "skipped",
            data: {
              reason: !contact
                ? "no HubSpot contact"
                : "contact has no site-scoped MindBody ids",
              storedLocationSlug: storedLocationSlug ?? null,
              requestLocationSlug: location.id,
            },
          });
        }
      } catch (e) {
        // Duplicate detection is a write-safety boundary. If HubSpot or the
        // stored-ID verification read fails, stop before creating records.
        log.error("trial.idguard.fail", { error: serialize(e) });
        trace.push({ step: "idFirstGuard", status: "error", error: serialize(e) });
        await markWorkItemManualSafely(
          hsCfg,
          log,
          intakeWorkItem.dealId,
          bookingLedgerBase,
          "The duplicate-family safety check failed before any Mindbody write.",
        );
        return NextResponse.json(
          {
            ok: false,
            correlationId,
            code: "duplicate_check_failed",
            error: "We could not safely check for an existing family account. Please try again shortly.",
          },
          { status: 502 },
        );
      }
    }

    if (idGuardAmbiguous) {
      // HubSpot says this family already has MindBody records, but the
      // direct ID lookup can't see them (merged? deleted?). Creating new
      // records here risks a duplicate family — degrade to manual review
      // and create nothing.
      mbDegraded = true;
      trace.push({ step: "getClientsByEmail", status: "skipped", data: { reason: "id guard ambiguous" } });
    } else if (existing.length === 0) {
      try {
        existing = await getClientsByEmail(mbCfg, log, body.parentEmail);
        trace.push({ step: "getClientsByEmail", status: "ok", data: { matched: existing.length } });
      } catch (e) {
        log.warn("trial.mindbody.degraded", { step: "getClientsByEmail", error: serialize(e) });
        mbDegraded = true;
        trace.push({ step: "getClientsByEmail", status: "error", error: serialize(e) });
      }
    }

    const intent = classifyIntent({
      bookingFor: "kid",
      mindbodyClientExists: existing.length > 0,
    });

    if (intent === "existing_user_softwall") {
      // The family shares one email, so `existing` can contain both the
      // parent and the child — reference the adult, not whichever record
      // the search happened to return first.
      const existingParent = pickAdultClient(existing);
      const fields = buildFormFields({
        correlationId,
        body,
        primaryKid,
        childDob,
        ageBand,
        location,
        status: "duplicate_email_softwall",
        parentMbId: existingParent?.Id != null ? String(existingParent.Id) : undefined,
        childMbId: undefined,
        baseUrl,
      });
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (softwall)", hsContext);
      const finalized = await finalizeWorkItemSafely(
        hsCfg,
        log,
        intakeWorkItem,
        {
          contactProperties: contactPropertiesFromFields(fields),
          dealProperties: buildBookingDealProperties({
            ...bookingLedgerBase,
            bookingStatus: "duplicate_email_softwall",
            enrollmentStatus: "not_started",
            mindbodyMutationStatus: "not_started",
            familyProvisioningStatus: "not_started",
            mindbodyParentId: existingParent?.Id,
            familyAccountStatus: "manual_review",
            failureReason: "Existing Mindbody email requires staff to resolve the original child record.",
          }),
        },
        trace,
      );
      if (!finalized.dealUpdated) {
        return durableManualReviewResponse(correlationId);
      }
      return NextResponse.json({ ok: true, correlationId, status: "duplicate_email_softwall" });
    }

    // If getClientsByEmail already failed above, skip straight to the
    // manual_review degrade-out at the bottom of this block.
    let parent: Awaited<ReturnType<typeof addClient>> | null = null;
    let child: Awaited<ReturnType<typeof addClient>> | null = null;
    let familyProvisioningStartedAt: Date | undefined;
    let familyProvisioningAttempted = false;
    if (!mbDegraded) {
      try {
        // Production AddClient runs in consumer mode. Its live field readback
        // requires a truthful household address and emergency contact at all
        // seven Court 16 sites; never substitute a studio address or
        // self/placeholder contact.
        const householdAddress = buildMindbodyHouseholdAddress(mindbodyProfile);
        const parentEmergencyContact =
          buildMindbodyParentEmergencyContact(mindbodyProfile);

        familyProvisioningStartedAt = new Date();
        familyProvisioningAttempted = true;
        await persistFamilyProvisioningMarker(
          hsCfg,
          log,
          intakeWorkItem.dealId,
          {
            status: "parent_create_started",
            startedAt: familyProvisioningStartedAt,
          },
        );

        parent = await addClient(mbCfg, log, {
          FirstName: body.parentFirstName,
          LastName: body.parentLastName,
          Email: body.parentEmail,
          MobilePhone: body.parentPhone,
          BirthDate: body.parentBirthDate,
          ReferredBy: "Online",
          Gender: mindbodyProfile.parentGender,
          ...householdAddress,
          ...parentEmergencyContact,
          // Opt new Client into MindBody's transactional emails so the
          // "Add Court 16 to your Mindbody account" auto-link email actually
          // fires. MindBody defaults SendAccountEmails to false if omitted,
          // silently suppressing the canonical Mindbody Account setup CTA.
          // A smoke run is the only case that flips these to false. The helper
          // throws rather than answering for a rejected request, so this line
          // cannot silently emit production defaults for one.
          ...trialSmokeTestCommunicationFlags(smokeTest),
        });
        trace.push({ step: "addClient (parent)", status: "ok", data: { id: parent.Id } });
        await persistFamilyProvisioningMarker(
          hsCfg,
          log,
          intakeWorkItem.dealId,
          {
            status: "parent_created",
            startedAt: familyProvisioningStartedAt,
            parentId: parent.Id,
          },
        );

        // Child AddClient with INLINE Parent/Guardian relationship to parent
        // — saves the round-trip and works in consumer mode (the standalone
        // addClientRelationship via UpdateClient returns
        // InvalidPermissionConfiguration without a staff token).
        //
        // Email: intentionally the PARENT'S email on the child record —
        // validated with MindBody's Family Accounts team (case 05463499,
        // Jul 7): the shared email is what lets MindBody's account-claim
        // flow assemble a true family account from these existing records
        // ("both can be claimed"), and mailing-list/report pulls for the
        // child's enrollments carry the parent's reachable address. The
        // Parent/Guardian relationship below links the two records; the
        // account-claim flow means no duplicate profiles are ever created.
        await persistFamilyProvisioningMarker(
          hsCfg,
          log,
          intakeWorkItem.dealId,
          {
            status: "child_create_started",
            startedAt: familyProvisioningStartedAt,
            parentId: parent.Id,
          },
        );
        child = await addClient(mbCfg, log, {
          FirstName: primaryKid.firstName,
          LastName: childLastName,
          Email: body.parentEmail,
          BirthDate: childDob,
          MobilePhone: body.parentPhone, // parent's phone is the kid's contact
          ReferredBy: "Online",
          Gender: mindbodyProfile.childGender,
          ...householdAddress,
          // The registering parent is a real, already-collected emergency
          // contact for the child. Only the adult profile needs the alternate
          // contact requested on panel two.
          EmergencyContactInfoName:
            `${body.parentFirstName} ${body.parentLastName}`.trim(),
          EmergencyContactInfoPhone: body.parentPhone,
          EmergencyContactInfoEmail: body.parentEmail,
          EmergencyContactInfoRelationship: "Parent/Guardian",
          // Inline Parent/Guardian → Child relationship: links this child
          // (current AddClient) to the parent (RelatedClientId). This is the
          // correct familial link in MindBody's catalog; -4 "Pays For" was a
          // billing relationship. Add PAYS_FOR back to this array if billing
          // attribution is ever needed for paid bookings.
          ClientRelationships: [
            {
              RelatedClientId: String(parent!.Id),
              RelationshipName: trialConfig.parentGuardianRelationship.RelationshipName2,
              Relationship: { ...trialConfig.parentGuardianRelationship },
            },
          ],
        });
        trace.push({
          step: "addClient (child + inline Parent/Guardian)",
          status: "ok",
          data: { id: child.Id, email: "parent" },
        });
        await persistFamilyProvisioningMarker(
          hsCfg,
          log,
          intakeWorkItem.dealId,
          {
            status: "child_created",
            startedAt: familyProvisioningStartedAt,
            parentId: parent.Id,
            childId: child.Id,
          },
        );
      } catch (e) {
        log.warn("trial.mindbody.degraded", { step: "addClient", error: serialize(e) });
        mbDegraded = true;
        trace.push({ step: "addClient", status: "error", error: serialize(e) });
      }
    }

    // Degraded path — capture the lead in HubSpot, return a manual_review
    // confirmation so the parent still gets a success screen and staff
    // gets a work item.
    if (mbDegraded || !parent || !child) {
      const fields = buildFormFields({
        correlationId,
        body,
        primaryKid,
        childDob,
        ageBand,
        location,
        status: "manual_review",
        parentMbId: parent?.Id != null ? String(parent.Id) : undefined,
        childMbId: child?.Id != null ? String(child.Id) : undefined,
        baseUrl,
      });
      const safeFields = protectedMindbodyOwnership
        ? {
            ...fields,
            // Never pair IDs from one Mindbody site with another site's slug.
            // Empty action URLs also prevent a staff click from attempting a
            // cross-site enrollment before the family is reviewed manually.
            court16_location_slug: protectedMindbodyOwnership.locationSlug ?? "",
            court16_mindbody_parent_id: protectedMindbodyOwnership.parentId,
            court16_mindbody_child_id: protectedMindbodyOwnership.childId,
            court16_staff_confirm_url: "",
            court16_staff_reassign_url: "",
            court16_staff_deny_url: "",
          }
        : fields;
      await submitFormSafely(
        hsCfg,
        log,
        safeFields,
        trace,
        "hubspot.submitTrialForm (manual_review)",
        hsContext,
      );
      const contactProperties = contactPropertiesFromFields(safeFields);
      const manualFailureReason = protectedMindbodyOwnership
        ? protectedMindbodyOwnership.locationSlug
          ? `[cross_site_request] Requested ${location.id}; stored Mindbody IDs remain owned by ${protectedMindbodyOwnership.locationSlug}. Manual review required.`
          : `[mindbody_site_unknown] Requested ${location.id}; stored Mindbody IDs have no owning-site slug. Manual review required.`
        : "Mindbody intake needs staff review.";
      const finalized = await finalizeWorkItemSafely(
        hsCfg,
        log,
        intakeWorkItem,
        {
          contactProperties,
          dealProperties: buildBookingDealProperties({
            ...bookingLedgerBase,
            bookingStatus: "manual_review",
            enrollmentStatus: "not_started",
            // Intake never runs checkout/enrollment; the AddClient write state
            // lives in familyProvisioningStatus below. Stamping the confirm-
            // stage status "manual_review" here would block the Deny link for
            // Deals whose family records were never touched (see
            // hasUnsafeMindbodyStateForDeny).
            mindbodyMutationStatus: "not_started",
            familyProvisioningStatus: familyProvisioningAttempted
              ? "reconciliation_required"
              : "not_started",
            familyProvisioningStartedAt,
            mindbodyParentId: protectedMindbodyOwnership ? undefined : parent?.Id,
            mindbodyChildId: protectedMindbodyOwnership ? undefined : child?.Id,
            familyAccountStatus: "manual_review",
            failureReason: manualFailureReason,
          }),
        },
        trace,
      );
      if (!finalized.dealUpdated) {
        return durableManualReviewResponse(correlationId);
      }
      return NextResponse.json({
        ok: true,
        correlationId,
        status: "manual_review",
      });
    }

    // Relationship is established inline on the child AddClient above —
    // no separate standalone call needed. Standalone addClientRelationship
    // (UpdateClient-based) is reserved for retroactive linking of
    // pre-existing clients and requires a staff token, which we
    // intentionally don't issue.

    const fields = buildFormFields({
      correlationId,
      body,
      primaryKid,
      childDob,
      ageBand,
      location,
      status: "pending_staff",
      parentMbId: parent.Id ? String(parent.Id) : undefined,
      childMbId: child.Id ? String(child.Id) : undefined,
      // This is the only family state the native-email path can establish
      // automatically. Later states require verified OAuth readback or an
      // explicit staff check of the original Mindbody client IDs.
      familyAccountStatus: "parent_claim_pending",
      baseUrl,
    });
    await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm", hsContext);
    const finalized = await finalizeWorkItemSafely(
      hsCfg,
      log,
      intakeWorkItem,
      {
        contactProperties: contactPropertiesFromFields(fields),
        dealProperties: buildBookingDealProperties({
          ...bookingLedgerBase,
          bookingStatus: "pending_staff",
          enrollmentStatus: "not_started",
          mindbodyMutationStatus: "not_started",
          familyProvisioningStatus: "child_created",
          familyProvisioningStartedAt,
          mindbodyParentId: parent.Id,
          mindbodyChildId: child.Id,
          familyAccountStatus: "parent_claim_pending",
        }),
      },
      trace,
    );
    if (!finalized.dealUpdated) {
      return durableManualReviewResponse(correlationId);
    }

    log.info("trial.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      status: "pending_staff",
    });
  } catch (e) {
    log.error("trial.fail", { error: serialize(e) });
    const recorded = await markWorkItemManualSafely(
      hsCfg,
      log,
      intakeWorkItem.dealId,
      bookingLedgerBase,
      `Unexpected intake failure: ${e instanceof Error ? e.message : String(e)}`.slice(0, 4000),
    );
    if (recorded) return durableManualReviewResponse(correlationId);
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "trial_request_failed",
        error: "We could not complete this request safely. Please try again or contact Court 16.",
      },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
  } finally {
    try {
      await signupLock.release();
    } catch (error) {
      log.error("trial.distributed-lock.release-failed", {
        code: error instanceof DistributedActionLockError ? error.code : "unknown",
      });
    }
  }
}

async function markWorkItemManualSafely(
  hsCfg: NonNullable<ReturnType<typeof loadHubspotConfig>>,
  log: ReturnType<typeof createLogger>,
  dealId: string,
  ledgerBase: Omit<BookingDealLedgerPatch, "bookingStatus">,
  failureReason: string,
  options: { familyProvisioningStatus?: FamilyProvisioningStatus } = {},
): Promise<boolean> {
  try {
    // Intake never runs checkout or class enrollment, so the confirm-stage
    // mutation status stays "not_started"; the AddClient write state lives in
    // court16_family_provisioning_status. Stamping "manual_review" here would
    // make hasUnsafeMindbodyStateForDeny block the staff Deny link for Deals
    // whose own failure reason says no Mindbody write was attempted.
    await updateDealProperties(hsCfg, log, dealId, {
      ...buildBookingDealProperties({
        ...ledgerBase,
        bookingStatus: "manual_review",
        enrollmentStatus: "not_started",
        mindbodyMutationStatus: "not_started",
        familyAccountStatus: "manual_review",
        familyProvisioningStatus: options.familyProvisioningStatus,
        failureReason,
      }),
    });
    return true;
  } catch (e) {
    log.error("trial.deal.manual-review.fail", { dealId, error: serialize(e) });
    return false;
  }
}

async function persistFamilyProvisioningMarker(
  hsCfg: NonNullable<ReturnType<typeof loadHubspotConfig>>,
  log: ReturnType<typeof createLogger>,
  dealId: string,
  args: {
    status: FamilyProvisioningStatus;
    startedAt: Date;
    parentId?: string | number;
    childId?: string | number;
  },
): Promise<void> {
  await updateDealProperties(hsCfg, log, dealId, {
    court16_family_provisioning_status: args.status,
    court16_family_provisioning_started_at: String(args.startedAt.getTime()),
    court16_mindbody_parent_id:
      args.parentId === undefined ? undefined : String(args.parentId),
    court16_mindbody_child_id:
      args.childId === undefined ? undefined : String(args.childId),
  });
}

interface BuildFieldsArgs {
  correlationId: string;
  body: TrialRequest;
  primaryKid: { firstName: string; lastName?: string; age: number };
  childDob: string;
  ageBand: string;
  location: NonNullable<ReturnType<typeof getLocationById>>;
  status: "pending_staff" | "duplicate_email_softwall" | "pending_payment" | "manual_review";
  parentMbId?: string;
  childMbId?: string;
  familyAccountStatus?: "parent_claim_pending";
  baseUrl: string;
}
function buildFormFields(args: BuildFieldsArgs) {
  const {
    correlationId,
    body,
    primaryKid,
    childDob,
    ageBand,
    location,
    status,
    parentMbId,
    childMbId,
    familyAccountStatus,
    baseUrl,
  } = args;
  const reportingFields = buildHubspotTrialReportingFields(body);

  return {
    firstname: body.parentFirstName,
    lastname: body.parentLastName,
    email: body.parentEmail,
    phone: body.parentPhone,

    // Court 16's HubSpot dropdown has portal-baked option strings — must
    // match exactly. Fall back to fullName if the location isn't mapped.
    preferred_location: getHubspotPreferredLocation(location.id) ?? location.fullName,
    child_name: primaryKid.firstName,
    child_1___last_name: primaryKid.lastName || "-",
    childage: ageBand,
    // Single un-suffixed field; HubSpot form rejects the 3-part split with
    // "Required field 'child_date_of_birth' is missing" (caught by smoke #2).
    child_date_of_birth: childDob,
    ...reportingFields,
    any_question_just_let_us_know: body.notes,

    court16_correlation_id: correlationId,
    court16_intent: "kid_trial" as const,
    court16_booking_status: status,
    // court16_class_id stores the per-occurrence MindBody ClassId — what
    // /class/addclienttoclass requires. Was ClassScheduleId pre-Bug-E
    // (caught by smoke #3); confirm route returned 502 InvalidClassId.
    court16_class_id: String(body.classId),
    court16_location_slug: location.id,
    // Human-readable companions to court16_class_id / court16_location_slug
    // — let staff read the class slot in HubSpot without bouncing to
    // MindBody admin. Added May 22 after smoke #M3 surfaced the gap.
    court16_class_name: body.className,
    court16_class_day_time: body.classStartsAt
      ? formatClassDayTime(body.classStartsAt, location.timezone)
      : `${body.classDay} ${body.classTime}`,
    court16_coach_name: body.coachName,
    court16_location_full: location.fullName,
    court16_waiver_version: WAIVER_VERSION,
    court16_mindbody_parent_id: parentMbId,
    court16_mindbody_child_id: childMbId,
    court16_family_account_status: familyAccountStatus,
    court16_staff_confirm_url: buildStaffUrl({ action: "confirm", correlationId, baseUrl }),
    court16_staff_reassign_url: buildStaffUrl({ action: "reassign", correlationId, baseUrl }),
    court16_staff_deny_url: buildStaffUrl({ action: "deny", correlationId, baseUrl }),
  };
}

/**
 * Person-scoped profile fields that are safe to refresh on a reused Contact.
 * Child, class, family-account, Mindbody, action-URL, and booking-state fields
 * stay exclusively on the request-scoped Deal so one sibling/request cannot
 * overwrite another. The optional legacy form path is disabled for ledger v1.
 */
function contactPropertiesFromFields(fields: ReturnType<typeof buildFormFields>): Record<string, string | undefined> {
  return {
    firstname: fields.firstname,
    lastname: fields.lastname,
    phone: fields.phone,
  };
}

/**
 * Upsert the Contact via CRM (gets us an ID synchronously, immune to
 * reCAPTCHA blocking the public form endpoint) and create a Deal in
 * the location-specific Trials pipeline. Idempotent on correlation
 * ID. Soft-failure: never throws — degraded result lands in trace.
 */
interface IntakeWorkItem {
  contactId: string;
  dealId: string;
  cached: boolean;
  existing?: DealRecord;
}

interface ActiveIntakeConflict {
  activeDeal: DealRecord;
}

async function createIntakeDealSafely(
  hsCfg: ReturnType<typeof loadHubspotConfig>,
  log: ReturnType<typeof createLogger>,
  args: {
    email: string;
    correlationId: string;
    locationId: string;
    dealName: string;
    amount: number;
    classStartsAt?: string;
    dealProperties: Record<string, string | undefined>;
  },
  trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }>,
): Promise<IntakeWorkItem | ActiveIntakeConflict | null> {
  if (!hsCfg) {
    trace.push({ step: "hubspot.createTrialDeal", status: "skipped", data: { reason: "HubSpot not configured" } });
    return null;
  }
  const pipeline = getDealPipeline(args.locationId);
  if (!pipeline) {
    trace.push({
      step: "hubspot.createTrialDeal",
      status: "skipped",
      data: { reason: `no pipeline mapped for location ${args.locationId}` },
    });
    return null;
  }
  try {
    const normalizedEmail = args.email.trim().toLowerCase();
    const bookingKeyDeal = await getDealByBookingKey(hsCfg, log, args.correlationId);
    const activeParentKey = args.dealProperties.court16_active_parent_key?.trim();
    const activeDeal = !bookingKeyDeal && activeParentKey
      ? await getDealByActiveParentKey(hsCfg, log, activeParentKey)
      : null;
    if (
      activeDeal &&
      activeDeal.properties.court16_booking_key !== args.correlationId
    ) {
      trace.push({
        step: "hubspot.activeBookingFence",
        status: "skipped",
        data: {
          reason: "another Deal holds the active parent key",
          activeDealId: activeDeal.id,
        },
      });
      return { activeDeal };
    }
    const replayDeal = bookingKeyDeal ?? activeDeal;
    let contactId: string;

    if (replayDeal) {
      if (replayDeal.associatedContactIds.length !== 1) {
        throw new Error(
          `HubSpot replay Deal ${replayDeal.id} must have exactly one associated Contact`,
        );
      }
      const replayContact = await getContactById(
        hsCfg,
        log,
        replayDeal.associatedContactIds[0],
      );
      if (
        !replayContact ||
        replayContact.properties.email?.trim().toLowerCase() !== normalizedEmail
      ) {
        throw new Error(
          `HubSpot replay Deal ${replayDeal.id} is not associated with the requested parent email`,
        );
      }
      contactId = replayContact.id;
    } else {
      // Avoid changing an existing shared Contact until this request has its
      // own Deal and has passed the Deal-history active-request guard. A new
      // Contact is created email-only because HubSpot requires an association
      // target when the immutable Deal work item is created.
      const existingContact = await findContactByEmail(hsCfg, log, normalizedEmail, ["email"]);
      if (
        existingContact &&
        existingContact.properties.email?.trim().toLowerCase() !== normalizedEmail
      ) {
        throw new Error("HubSpot email lookup returned a mismatched Contact");
      }
      contactId = existingContact
        ? existingContact.id
        : (await upsertContactByEmail(hsCfg, log, normalizedEmail, {})).id;
    }

    const deal = await createTrialDeal(hsCfg, log, {
      contactId,
      correlationId: args.correlationId,
      pipelineId: pipeline.pipelineId,
      stageId: pipeline.stages.requested,
      dealName: args.dealName,
      amount: args.amount,
      classStartsAt: args.classStartsAt,
      dealProperties: args.dealProperties,
    });
    trace.push({
      step: "hubspot.createTrialDeal",
      status: "ok",
      data: {
        contactId,
        dealId: deal.id,
        cached: deal.cached,
        pipeline: pipeline.pipelineId,
      },
    });
    return {
      contactId,
      dealId: deal.id,
      cached: deal.cached,
      existing: deal.existing,
    };
  } catch (e) {
    if (e instanceof HubspotActiveBookingConflictError) {
      trace.push({
        step: "hubspot.activeBookingFence",
        status: "skipped",
        data: {
          reason: "another Deal won the active parent key",
          activeDealId: e.existingDeal.id,
        },
      });
      return { activeDeal: e.existingDeal };
    }
    log.warn("trial.deal.fail", { error: serialize(e) });
    trace.push({ step: "hubspot.createTrialDeal", status: "error", error: serialize(e) });
    return null;
  }
}

async function finalizeWorkItemSafely(
  hsCfg: ReturnType<typeof loadHubspotConfig>,
  log: ReturnType<typeof createLogger>,
  workItem: IntakeWorkItem,
  args: {
    contactProperties: Record<string, string | undefined>;
    dealProperties: Record<string, string | undefined>;
  },
  trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }>,
): Promise<{ dealUpdated: boolean; contactProfileUpdated: boolean }> {
  if (!hsCfg) return { dealUpdated: false, contactProfileUpdated: false };
  try {
    await updateDealProperties(hsCfg, log, workItem.dealId, args.dealProperties);
    trace.push({
      step: "hubspot.updateTrialDeal",
      status: "ok",
      data: { dealId: workItem.dealId },
    });
  } catch (e) {
    log.warn("trial.deal.finalize.fail", { error: serialize(e), dealId: workItem.dealId });
    trace.push({ step: "hubspot.updateTrialDeal", status: "error", error: serialize(e) });
    return { dealUpdated: false, contactProfileUpdated: false };
  }

  try {
    await updateContact(hsCfg, log, workItem.contactId, args.contactProperties);
    trace.push({
      step: "hubspot.updateContactProfile",
      status: "ok",
      data: { contactId: workItem.contactId },
    });
    return { dealUpdated: true, contactProfileUpdated: true };
  } catch (e) {
    log.warn("trial.contact-profile.fail", {
      error: serialize(e),
      contactId: workItem.contactId,
      dealId: workItem.dealId,
    });
    trace.push({ step: "hubspot.updateContactProfile", status: "error", error: serialize(e) });
    return { dealUpdated: true, contactProfileUpdated: false };
  }
}

async function handleCachedBookingSafely(
  hsCfg: NonNullable<ReturnType<typeof loadHubspotConfig>>,
  log: ReturnType<typeof createLogger>,
  workItem: IntakeWorkItem,
  ledgerBase: Omit<BookingDealLedgerPatch, "bookingStatus">,
  correlationId: string,
) {
  const existing = workItem.existing;
  if (!existing) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "booking_retry_unverified",
        error: "The prior booking request could not be read back safely.",
      },
      { status: 409 },
    );
  }
  const parsed = parseBookingDealLedger(existing.properties);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "booking_ledger_incomplete",
        error: "The prior booking work item needs staff review; no Mindbody write was repeated.",
      },
      { status: 409 },
    );
  }
  if (parsed.value.bookingStatus === "intake_started") {
    // The email-scoped distributed lock was acquired before this read. No
    // concurrent intake can still own this Deal, so `intake_started` is an
    // abandoned work item, not a permanent "request in progress" response.
    // Never replay AddClient. If either create marker advanced, force explicit
    // reconciliation of the recorded Mindbody IDs.
    const familyProvisioningAdvanced =
      parsed.value.familyProvisioningStatus !== undefined &&
      parsed.value.familyProvisioningStatus !== "not_started";
    const recorded = await markWorkItemManualSafely(
      hsCfg,
      log,
      workItem.dealId,
      ledgerBase,
      familyProvisioningAdvanced
        ? "Recovered an abandoned intake after Mindbody family provisioning began. Do not repeat AddClient; reconcile the recorded parent and child IDs."
        : "Recovered an abandoned intake before Mindbody family provisioning began. No AddClient call was repeated.",
      {
        familyProvisioningStatus: familyProvisioningAdvanced
          ? "reconciliation_required"
          : "not_started",
      },
    );
    return recorded
      ? durableManualReviewResponse(correlationId)
      : hubspotWorkItemFailure(correlationId);
  }
  const accepted = new Set([
    "pending_staff",
    "pending_staff_assist",
    "pending_payment",
    "duplicate_email_softwall",
    "manual_review",
    "confirmed",
  ]);
  if (!accepted.has(parsed.value.bookingStatus)) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "booking_not_retryable",
        status: parsed.value.bookingStatus,
        error: "This request already reached a staff-managed state; no Mindbody write was repeated.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      correlationId,
      status: parsed.value.bookingStatus,
      cached: true,
    },
    { status: parsed.value.bookingStatus === "manual_review" ? 202 : 200 },
  );
}

function hubspotWorkItemFailure(correlationId: string) {
  return NextResponse.json(
    {
      ok: false,
      correlationId,
      code: "hubspot_work_item_failed",
      error:
        "Your request could not be added to the staff review queue. Please try again or contact Court 16 with the request reference.",
    },
    { status: 502 },
  );
}

function activeBookingConflictResponse(correlationId: string) {
  return NextResponse.json(
    {
      ok: false,
      correlationId,
      code: "active_trial_request_exists",
      error:
        "A trial request is already active for this email. Court 16 staff will follow up; please do not submit another request.",
    },
    { status: 409 },
  );
}

function durableManualReviewResponse(correlationId: string) {
  return NextResponse.json(
    {
      ok: true,
      correlationId,
      status: "manual_review",
      warning:
        "Your request is in the staff queue, but account setup needs review. Do not submit again; contact Court 16 with this request reference if you need help.",
    },
    { status: 202 },
  );
}

async function submitFormSafely(
  hsCfg: ReturnType<typeof loadHubspotConfig>,
  log: ReturnType<typeof createLogger>,
  fields: ReturnType<typeof buildFormFields>,
  trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }>,
  label: string,
  context?: { hutk?: string; pageUri?: string; pageName?: string },
): Promise<void> {
  if (!hsCfg) {
    log.info("trial.hubspot.skipped", { reason: "HubSpot not configured" });
    trace.push({ step: label, status: "skipped", data: { reason: "HubSpot not configured" } });
    return;
  }
  if (!hsCfg.submitLegacyTrialForm) {
    log.info("trial.hubspot.legacy-form.skipped", {
      reason: "HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM is not true",
    });
    trace.push({
      step: label,
      status: "skipped",
      data: { reason: "legacy HubSpot form compatibility is disabled" },
    });
    return;
  }
  try {
    await submitTrialForm(hsCfg, log, fields, context ? { context } : undefined);
    trace.push({ step: label, status: "ok" });
  } catch (e) {
    log.warn("trial.hubspot.fail", { error: serialize(e) });
    trace.push({ step: label, status: "error", error: serialize(e) });
  }
}

/**
 * Validate the client-supplied HubSpot attribution context before forwarding.
 * A malformed hutk gets the whole Forms API submission rejected, so only
 * pass it through when it looks like a real tracking cookie (32 hex chars).
 */
function sanitizeHsContext(
  ctx: TrialRequest["hsContext"],
): { hutk?: string; pageUri?: string; pageName?: string } | undefined {
  if (!ctx) return undefined;
  const out: { hutk?: string; pageUri?: string; pageName?: string } = {};
  if (typeof ctx.hutk === "string" && /^[a-f0-9]{32}$/i.test(ctx.hutk)) out.hutk = ctx.hutk;
  if (typeof ctx.pageUri === "string" && /^https?:\/\//.test(ctx.pageUri))
    out.pageUri = ctx.pageUri.slice(0, 500);
  if (typeof ctx.pageName === "string" && ctx.pageName) out.pageName = ctx.pageName.slice(0, 200);
  return Object.keys(out).length > 0 ? out : undefined;
}

function validate(body: TrialRequest | undefined): string[] {
  if (!body) return ["Body is required"];
  const errors: string[] = [];
  if (
    typeof body.submissionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.submissionId,
    )
  ) {
    errors.push("submissionId must be a UUID v4");
  }
  if (typeof body.parentFirstName !== "string" || body.parentFirstName.trim().length === 0) {
    errors.push("parentFirstName is required");
  }
  if (typeof body.parentLastName !== "string" || body.parentLastName.trim().length === 0) {
    errors.push("parentLastName is required");
  }
  if (typeof body.parentEmail !== "string" || !/^\S+@\S+\.\S+$/.test(body.parentEmail)) {
    errors.push("parentEmail is invalid");
  }
  if (
    typeof body.parentPhone !== "string" ||
    body.parentPhone.replace(/\D/g, "").length < 7
  ) {
    errors.push("parentPhone is required");
  }
  const removedOptionalFields = [
    "childPlayingLevel",
    "childSchool",
    "leadSource",
    "notes",
    "householdAddress2",
  ] as const;
  for (const field of removedOptionalFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      errors.push(`${field} is not accepted by the minimum Mindbody profile form`);
    }
  }
  errors.push(...validateMindbodyProfileDetails(body));

  // Adult DOB is required (Ibtissam review Jun 11) and must belong to an
  // adult — keeps the MindBody parent record real, no placeholder fallback.
  if (!isValidIsoDate(body.parentBirthDate)) {
    errors.push('parentBirthDate is required ("YYYY-MM-DD")');
  } else if (ageFromDob(body.parentBirthDate) < 18) {
    errors.push("parentBirthDate must be an adult's date of birth (18+)");
  }

  const rawChildren = (body as unknown as { children?: unknown }).children;
  const childPayloadErrors = validateSingleTrialChildPayload(rawChildren);
  errors.push(...childPayloadErrors);
  if (childPayloadErrors.length === 0) {
    const child = (rawChildren as Array<Record<string, unknown>>)[0];
    const age = ageFromDob(child.birthDate as string);
    if (age < MIN_KIDS_TRIAL_AGE || age > MAX_KIDS_TRIAL_AGE) {
      errors.push(
        `children[0].birthDate gives age ${age} — trials are for kids ages ${MIN_KIDS_TRIAL_AGE}–${MAX_KIDS_TRIAL_AGE}`,
      );
    }
  }

  if (typeof body.locationId !== "string" || body.locationId.trim().length === 0) {
    errors.push("locationId is required");
  }
  if (!Number.isInteger(body.classScheduleId)) {
    errors.push("classScheduleId must be an integer");
  }
  if (!Number.isInteger(body.classId)) errors.push("classId must be an integer");
  if (typeof body.className !== "string" || body.className.trim().length === 0) {
    errors.push("className is required");
  }
  // Required for the booking-window check and HubSpot Deal class_date.
  if (typeof body.classStartsAt !== "string" || body.classStartsAt.trim().length === 0) {
    errors.push("classStartsAt is required");
  }
  if (body.notes != null && typeof body.notes !== "string") {
    errors.push("notes must be a string");
  }

  // Age-range check: reject bookings where a child's age falls outside the
  // class's eligible band. Range is parsed from the class title itself
  // (Court 16 titles encode the true range explicitly, e.g. "7 - 12.9yo").
  // Permissive — skipped when the title doesn't include a parseable range.
  // Ages derive from DOB when present (the source of truth post-Jun-11);
  // the client-sent integer age is the fallback for older payloads.
  errors.push(
    ...validateClassAge(
      body,
      typeof body.className === "string" ? body.className : undefined,
    ),
  );

  return errors;
}

function validateClassAge(body: TrialRequest, className: string | undefined): string[] {
  const errors: string[] = [];
  const range = className ? parseAgeRangeFromTitle(className) : null;
  if (range) {
    const children = Array.isArray(body.children) ? body.children : [];
    const ages = children.flatMap((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const child = value as Record<string, unknown>;
      if (isValidIsoDate(child.birthDate)) return [ageFromDob(child.birthDate)];
      return typeof child.age === "number" && Number.isFinite(child.age) ? [child.age] : [];
    });
    if (ages.length === 0 && typeof body.childAge === "number" && Number.isFinite(body.childAge)) {
      ages.push(body.childAge);
    }
    for (const age of ages) {
      if (age < range.ageMin || age > range.ageMax) {
        errors.push(
          `child age ${age} is outside eligible range ${range.ageMin}–${range.ageMax} for "${className}"`,
        );
      }
    }
  }
  return errors;
}

function normalizeValidatedRequest(body: TrialRequest): TrialRequest {
  const child = body.children[0];
  const birthDate = child.birthDate;
  const age = ageFromDob(birthDate);
  const firstName = child.firstName.trim();
  const lastName = child.lastName.trim();

  return {
    ...body,
    parentFirstName: body.parentFirstName.trim(),
    parentLastName: body.parentLastName.trim(),
    parentEmail: body.parentEmail.trim(),
    parentPhone: body.parentPhone.trim(),
    childFirstName: firstName,
    childLastName: lastName,
    childBirthDate: birthDate,
    childAge: age,
    children: [{ firstName, lastName, birthDate, age }],
  };
}

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof HubspotError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
