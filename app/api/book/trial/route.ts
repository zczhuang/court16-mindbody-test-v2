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
  HubspotError,
  loadHubspotConfig,
  submitTrialForm,
  upsertContactByEmail,
} from "@/lib/hubspot";
import { buildStaffUrl } from "@/lib/staff-tokens";
import { classifyIntent } from "@/lib/intent";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import {
  ageFromDob,
  formatClassDayTime,
  parseAgeRangeFromTitle,
  siteLocalToUtcIso,
} from "@/lib/class-utils";
import { getLocationById } from "@/config/locations";
import { maxBookableDateStr, TRIAL_CONFIG, TRIAL_MAX_ADVANCE_DAYS } from "@/config/trial-config";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import { getKidsTrialReadiness } from "@/config/kids-trial-readiness";
import type { MindBodyClass, TrialRequest } from "@/lib/trial-types";
import { consumeSignupRateLimit } from "@/lib/request-rate-limit";
import { tryAcquireLocalActionLock } from "@/lib/action-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WAIVER_VERSION = "v1.0";

// HubSpot's form has required fields we don't collect in the slim UI.
// Fill silently; staff completes at the trial.
const HUBSPOT_DEFAULTS = {
  child_1___playing_level: "New to Tennis",
  school: "—",
  lead_source: "Other",
} as const;

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
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

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

  const releaseSignupLock = tryAcquireLocalActionLock(
    `kid-trial:${body.parentEmail.trim().toLowerCase()}`,
  );
  if (!releaseSignupLock) {
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

  const location = getLocationById(body.locationId);
  if (!location) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown locationId: ${body.locationId}` },
      { status: 400 },
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
  const { preferredLocation, programId, trialConfig } = trialReadiness;

  let mbCfg;
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

  // For Track 1 we process the first child only; multi-child is Track 2.
  const primaryKid = body.children[0] ?? {
    firstName: body.childFirstName,
    lastName: body.childLastName,
    age: body.childAge,
    birthDate: body.childBirthDate,
  };
  // validate() guarantees these — real values per Ibtissam's review (Jun 11):
  // no more "-" last name or Jan-1 synthesized DOB on the MindBody record.
  const childLastName = primaryKid.lastName ?? body.childLastName ?? "";
  const childDob = primaryKid.birthDate ?? body.childBirthDate ?? "";
  const childAge = ageFromDob(childDob);
  const ageBand = ageToBand(childAge);

  // Booking window: reject requests beyond today + TRIAL_MAX_ADVANCE_DAYS
  // (server-side authority — the calendar UI/API only hide far-out slots).
  if (body.classStartsAt) {
    const maxDate = maxBookableDateStr(location.timezone);
    if (body.classStartsAt.slice(0, 10) > maxDate) {
      return NextResponse.json(
        {
          ok: false,
          correlationId,
          error: `Trials can be booked at most ${TRIAL_MAX_ADVANCE_DAYS} days ahead (latest bookable date: ${maxDate})`,
        },
        { status: 400 },
      );
    }
  }

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
    const spotsRemaining = liveClass
      ? typeof liveClass.WebCapacity === "number"
        ? Number(liveClass.WebCapacity) - Number(liveClass.WebBooked ?? 0)
        : Number(liveClass.MaxCapacity) - Number(liveClass.TotalBooked)
      : 0;
    if (
      !liveClass ||
      liveProgramId !== programId ||
      liveClass.StartDateTime !== body.classStartsAt ||
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
          return NextResponse.json(
            {
              ok: false,
              correlationId,
              code: "active_trial_request_exists",
              error:
                "A trial or intro request is already active for this email. Court 16 staff will follow up; please do not submit another request.",
            },
            { status: 409 },
          );
        }
        const knownIds = [
          contact?.properties?.court16_mindbody_parent_id,
          contact?.properties?.court16_mindbody_child_id,
        ].filter((v): v is string => typeof v === "string" && v.length > 0);
        if (knownIds.length > 0) {
          existing = await getClientsByIds(mbCfg, log, knownIds);
          idGuardAmbiguous = existing.length === 0;
          trace.push({
            step: "idFirstGuard",
            status: "ok",
            data: { knownIds, verified: existing.length, ambiguous: idGuardAmbiguous },
          });
        } else {
          trace.push({
            step: "idFirstGuard",
            status: "skipped",
            data: { reason: contact ? "contact has no stored MindBody ids" : "no HubSpot contact" },
          });
        }
      } catch (e) {
        // Duplicate detection is a write-safety boundary. If HubSpot or the
        // stored-ID verification read fails, stop before creating records.
        log.error("trial.idguard.fail", { error: serialize(e) });
        trace.push({ step: "idFirstGuard", status: "error", error: serialize(e) });
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

    // Establish a durable, per-booking HubSpot Deal before any AddClient
    // write. If HubSpot is unavailable, stop here so the parent can retry
    // without leaving orphan Mindbody records or triggering claim emails.
    const intakeDealCreated = await createDealSafely(
      hsCfg,
      log,
      {
        email: body.parentEmail,
        correlationId,
        locationId: location.id,
        contactProperties: {
          firstname: body.parentFirstName,
          lastname: body.parentLastName,
          phone: body.parentPhone,
          preferred_location: preferredLocation,
        },
        classStartsAt: classStartsAtUtc,
        dealName: `${primaryKid.firstName} ${childLastName} - ${body.parentEmail}`,
        amount: 0,
      },
      trace,
    );
    if (!intakeDealCreated) return hubspotWorkItemFailure(correlationId);

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
      const dealCreated = await createDealSafely(
        hsCfg,
        log,
        {
          email: body.parentEmail,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName: `${primaryKid.firstName} ${childLastName} - ${body.parentEmail} (softwall)`,
          amount: 0,
        },
        trace,
      );
      if (!dealCreated) return durableManualReviewResponse(correlationId);
      return NextResponse.json({ ok: true, correlationId, status: "duplicate_email_softwall" });
    }

    // If getClientsByEmail already failed above, skip straight to the
    // manual_review degrade-out at the bottom of this block.
    let parent: Awaited<ReturnType<typeof addClient>> | null = null;
    let child: Awaited<ReturnType<typeof addClient>> | null = null;
    if (!mbDegraded) {
      try {
        // Defaults that satisfy site 5748154's RequiredClientFields config
        // in Consumer Mode (probe via GET /client/requiredclientfields).
        // The form doesn't collect home address / gender / emergency contact
        // yet — staff updates these at the trial intake. Studio address is
        // used as the address placeholder so the client at least geocodes
        // to a reasonable spot.
        const addressDefaults = {
          AddressLine1: location.address,
          City: location.city,
          State: location.state,
          PostalCode: location.postalCode,
        };
        // Gender: site 5748154 only accepts the built-in options
        // ("Male" / "Female") in consumer mode — custom genders return
        // InvalidPermissionConfiguration. Default to "Female" so the
        // booking goes through; staff updates at first visit.
        const GENDER_PLACEHOLDER = "Female";

        parent = await addClient(mbCfg, log, {
          FirstName: body.parentFirstName,
          LastName: body.parentLastName,
          Email: body.parentEmail,
          MobilePhone: body.parentPhone,
          BirthDate: body.parentBirthDate,
          ReferredBy: "Online",
          Gender: GENDER_PLACEHOLDER,
          ...addressDefaults,
          // Self-as-emergency-contact placeholder. Trial staff collects
          // the real emergency contact at intake. Required by RH config
          // (all 4 EmergencyContactInfo* subfields must be present or
          // MindBody flags the bundle as missing).
          EmergencyContactInfoName: `${body.parentFirstName} ${body.parentLastName}`,
          EmergencyContactInfoPhone: body.parentPhone,
          EmergencyContactInfoEmail: body.parentEmail,
          EmergencyContactInfoRelationship: "Self (placeholder)",
          // Opt new Client into MindBody's transactional emails so the
          // "Add Court 16 to your Mindbody account" auto-link email actually
          // fires. MindBody defaults SendAccountEmails to false if omitted,
          // silently suppressing the canonical Mindbody Account setup CTA.
          SendAccountEmails: true,
          SendScheduleEmails: true,
        });
        trace.push({ step: "addClient (parent)", status: "ok", data: { id: parent.Id } });

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
        child = await addClient(mbCfg, log, {
          FirstName: primaryKid.firstName,
          LastName: childLastName,
          Email: body.parentEmail,
          BirthDate: childDob,
          MobilePhone: body.parentPhone, // parent's phone is the kid's contact
          ReferredBy: "Online",
          Gender: GENDER_PLACEHOLDER,
          ...addressDefaults,
          // Emergency contact is the parent — semantically correct for kids.
          EmergencyContactInfoName: `${body.parentFirstName} ${body.parentLastName}`,
          EmergencyContactInfoPhone: body.parentPhone,
          EmergencyContactInfoEmail: body.parentEmail,
          EmergencyContactInfoRelationship: "Parent",
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
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (manual_review)", hsContext);
      const dealCreated = await createDealSafely(
        hsCfg,
        log,
        {
          email: body.parentEmail,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName: `${primaryKid.firstName} ${childLastName} - ${body.parentEmail} (manual review)`,
          amount: 0,
        },
        trace,
      );
      if (!dealCreated) return durableManualReviewResponse(correlationId);
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
      baseUrl,
    });
    await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm", hsContext);
    const dealCreated = await createDealSafely(
      hsCfg,
      log,
      {
        email: body.parentEmail,
        correlationId,
        locationId: location.id,
        contactProperties: contactPropertiesFromFields(fields),
        classStartsAt: classStartsAtUtc,
        // Deal-name house convention (Ibtissam Jun 11): child's full name +
        // parent's email — matches the legacy workflow-created deals.
        dealName: `${primaryKid.firstName} ${childLastName} - ${body.parentEmail}`,
        amount: 0,
      },
      trace,
    );
    if (!dealCreated) return durableManualReviewResponse(correlationId);

    log.info("trial.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      status: "pending_staff",
    });
  } catch (e) {
    log.error("trial.fail", { error: serialize(e) });
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
    releaseSignupLock();
  }
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
  baseUrl: string;
}
function buildFormFields(args: BuildFieldsArgs) {
  const { correlationId, body, primaryKid, childDob, ageBand, location, status, parentMbId, childMbId, baseUrl } = args;

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
    child_1___playing_level: HUBSPOT_DEFAULTS.child_1___playing_level,
    school: HUBSPOT_DEFAULTS.school,
    lead_source: HUBSPOT_DEFAULTS.lead_source,
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
    court16_staff_confirm_url: buildStaffUrl({ action: "confirm", correlationId, baseUrl }),
    court16_staff_reassign_url: buildStaffUrl({ action: "reassign", correlationId, baseUrl }),
    court16_staff_deny_url: buildStaffUrl({ action: "deny", correlationId, baseUrl }),
  };
}

/**
 * Subset of buildFormFields output that maps cleanly to HubSpot Contact
 * CRM properties (vs. form-specific fields like `child_name` that only
 * exist on the form, not the Contact). Used by createDealSafely below
 * to upsert the Contact in parallel with the form submit — gives us a
 * synchronous Contact ID for the Deal association.
 */
function contactPropertiesFromFields(fields: ReturnType<typeof buildFormFields>): Record<string, string | undefined> {
  return {
    firstname: fields.firstname,
    lastname: fields.lastname,
    phone: fields.phone,
    preferred_location: fields.preferred_location,
    // Child identity must ride the synchronous CRM upsert, not just the
    // async Forms API submit: the staff-notification workflow enrolls on
    // the booking-status flip in this same upsert and renders its email
    // immediately — form-only fields lose that race (verified Jun 11:
    // notification email showed a blank Child line).
    child_name: fields.child_name,
    child_1___last_name: fields.child_1___last_name,
    court16_correlation_id: fields.court16_correlation_id,
    court16_intent: fields.court16_intent,
    court16_booking_status: fields.court16_booking_status,
    court16_class_id: fields.court16_class_id,
    court16_location_slug: fields.court16_location_slug,
    court16_class_name: fields.court16_class_name,
    court16_class_day_time: fields.court16_class_day_time,
    court16_coach_name: fields.court16_coach_name,
    court16_location_full: fields.court16_location_full,
    court16_waiver_version: fields.court16_waiver_version,
    court16_mindbody_parent_id: fields.court16_mindbody_parent_id,
    court16_mindbody_child_id: fields.court16_mindbody_child_id,
    court16_staff_confirm_url: fields.court16_staff_confirm_url,
    court16_staff_reassign_url: fields.court16_staff_reassign_url,
    court16_staff_deny_url: fields.court16_staff_deny_url,
  };
}

/**
 * Upsert the Contact via CRM (gets us an ID synchronously, immune to
 * reCAPTCHA blocking the public form endpoint) and create a Deal in
 * the location-specific Trials pipeline. Idempotent on correlation
 * ID. Soft-failure: never throws — degraded result lands in trace.
 */
async function createDealSafely(
  hsCfg: ReturnType<typeof loadHubspotConfig>,
  log: ReturnType<typeof createLogger>,
  args: {
    email: string;
    correlationId: string;
    locationId: string;
    contactProperties: Record<string, string | undefined>;
    dealName: string;
    amount: number;
    classStartsAt?: string;
  },
  trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }>,
): Promise<boolean> {
  if (!hsCfg) {
    trace.push({ step: "hubspot.createTrialDeal", status: "skipped", data: { reason: "HubSpot not configured" } });
    return false;
  }
  const pipeline = getDealPipeline(args.locationId);
  if (!pipeline) {
    trace.push({
      step: "hubspot.createTrialDeal",
      status: "skipped",
      data: { reason: `no pipeline mapped for location ${args.locationId}` },
    });
    return false;
  }
  try {
    const contact = await upsertContactByEmail(hsCfg, log, args.email, args.contactProperties);
    const deal = await createTrialDeal(hsCfg, log, {
      contactId: contact.id,
      correlationId: args.correlationId,
      pipelineId: pipeline.pipelineId,
      stageId: pipeline.stages.requested,
      dealName: args.dealName,
      amount: args.amount,
      classStartsAt: args.classStartsAt,
    });
    trace.push({
      step: "hubspot.createTrialDeal",
      status: "ok",
      data: {
        contactId: contact.id,
        dealId: deal.id,
        cached: deal.cached,
        pipeline: pipeline.pipelineId,
      },
    });
    return true;
  } catch (e) {
    log.warn("trial.deal.fail", { error: serialize(e) });
    trace.push({ step: "hubspot.createTrialDeal", status: "error", error: serialize(e) });
    return false;
  }
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
  if (!body.parentFirstName) errors.push("parentFirstName is required");
  if (!body.parentLastName) errors.push("parentLastName is required");
  if (!/^\S+@\S+\.\S+$/.test(body.parentEmail ?? "")) errors.push("parentEmail is invalid");
  if (!body.parentPhone || body.parentPhone.replace(/\D/g, "").length < 7)
    errors.push("parentPhone is required");

  // Adult DOB is required (Ibtissam review Jun 11) and must belong to an
  // adult — keeps the MindBody parent record real, no placeholder fallback.
  if (!body.parentBirthDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.parentBirthDate)) {
    errors.push('parentBirthDate is required ("YYYY-MM-DD")');
  } else if (ageFromDob(body.parentBirthDate) < 18) {
    errors.push("parentBirthDate must be an adult's date of birth (18+)");
  }

  if (!body.childFirstName && (!body.children || body.children.length === 0))
    errors.push("childFirstName or children[] is required");

  // Child last name + DOB required (Ibtissam review Jun 11) — they drive
  // the real MindBody profile, the HubSpot form fields, and the deal name.
  const primaryLastName = body.children?.[0]?.lastName ?? body.childLastName;
  if (!primaryLastName) errors.push("child lastName is required");
  const primaryDob = body.children?.[0]?.birthDate ?? body.childBirthDate;
  if (!primaryDob || !/^\d{4}-\d{2}-\d{2}$/.test(primaryDob)) {
    errors.push('child birthDate is required ("YYYY-MM-DD")');
  } else {
    const age = ageFromDob(primaryDob);
    if (age < 0 || age > 17) errors.push(`child birthDate gives age ${age} — trials are for kids under 18`);
  }

  if (!body.locationId) errors.push("locationId is required");
  if (typeof body.classScheduleId !== "number") errors.push("classScheduleId must be a number");
  if (typeof body.classId !== "number") errors.push("classId must be a number");
  // Required for the booking-window check and HubSpot Deal class_date.
  if (!body.classStartsAt) errors.push("classStartsAt is required");

  // Age-range check: reject bookings where a child's age falls outside the
  // class's eligible band. Range is parsed from the class title itself
  // (Court 16 titles encode the true range explicitly, e.g. "7 - 12.9yo").
  // Permissive — skipped when the title doesn't include a parseable range.
  // Ages derive from DOB when present (the source of truth post-Jun-11);
  // the client-sent integer age is the fallback for older payloads.
  errors.push(...validateClassAge(body, body.className));

  return errors;
}

function validateClassAge(body: TrialRequest, className: string | undefined): string[] {
  const errors: string[] = [];
  const range = className ? parseAgeRangeFromTitle(className) : null;
  if (range) {
    const ages = (body.children ?? []).map((c) =>
      c.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(c.birthDate) ? ageFromDob(c.birthDate) : c.age,
    );
    if (ages.length === 0 && body.childAge) ages.push(body.childAge);
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

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof HubspotError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
