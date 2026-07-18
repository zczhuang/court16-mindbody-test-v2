import { NextResponse } from "next/server";
import {
  addClient,
  authedMindbodyGet,
  buildAdultCartUrl,
  checkCallerToken,
  getClientsByEmail,
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
import { buildStaffUrl, signToken } from "@/lib/staff-tokens";
import { classifyIntent } from "@/lib/intent";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { formatClassDayTime, siteLocalToUtcIso } from "@/lib/class-utils";
import { getLocationById } from "@/config/locations";
import {
  getOffer,
  isAdultOfferReadyAtLocation,
  isAdultProgram,
} from "@/config/adult-config";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import { consumeSignupRateLimit } from "@/lib/request-rate-limit";
import type { MindBodyClass } from "@/lib/trial-types";
import { tryAcquireLocalActionLock } from "@/lib/action-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WAIVER_VERSION = "v1.0";

interface IntroBody {
  locationId: string;
  offerKey: string;
  adult: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    birthDate: string; // required for adults
  };
  classScheduleId: number;
  /** Per-occurrence MindBody ClassId (Bug E fix — see trial route). */
  classId: number;
  className: string;
  classDay: string;
  classTime: string;
  /** ISO 8601 start datetime (from MindBody StartDateTime). Drives HubSpot Deal `class_date`. */
  classStartsAt?: string;
  coachName: string;
  notes?: string;
  waiverVersion?: string;
  /** HubSpot attribution context captured client-side (see trial route). */
  hsContext?: { hutk?: string; pageUri?: string; pageName?: string };
}

export async function POST(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  let body: IntroBody;
  try {
    body = (await req.json()) as IntroBody;
  } catch {
    return NextResponse.json({ ok: false, correlationId, error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validate(body);
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, correlationId, errors }, { status: 400 });
  }

  const rateLimit = consumeSignupRateLimit(req, "adult-intro", body.adult.email);
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
    `adult-intro:${body.adult.email.trim().toLowerCase()}`,
  );
  if (!releaseSignupLock) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "request_in_progress",
        error: "An intro request for this email is already being processed. Please wait.",
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
  if (!location.publicBookingEnabled) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "location_not_ready",
        error: "Online booking is not yet available for this club.",
      },
      { status: 409 },
    );
  }

  const offer = getOffer(body.offerKey);
  if (!offer) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown offerKey: ${body.offerKey}` },
      { status: 400 },
    );
  }
  if (!isAdultOfferReadyAtLocation(offer, location.id)) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "offer_location_not_ready",
        error: "That offer's checkout is not yet available for this club.",
      },
      { status: 409 },
    );
  }

  // MindBody returns `StartDateTime` as site-local wall-clock without a TZ
  // suffix. Convert to absolute UTC ISO so HubSpot Deal `class_date` (and
  // downstream the 24h-reminder workflow) fire at the right instant.
  // Caught by smoke #2 v2 (Bug D).
  const classStartsAtUtc = body.classStartsAt
    ? siteLocalToUtcIso(body.classStartsAt, location.timezone)
    : undefined;

  let mbCfg;
  try {
    const base = loadConfigFromEnv();
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
        error: "Intro requests are temporarily unavailable. Please contact Court 16.",
      },
      { status: 503 },
    );
  }
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const hsContext = sanitizeHsContext(body.hsContext);

  try {
    const classDate = body.classStartsAt!.slice(0, 10);
    const result = await authedMindbodyGet<{ Classes?: MindBodyClass[] }>(log, {
      siteIdOverride: mbCfg.siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${classDate}T00:00:00`,
        EndDateTime: `${classDate}T23:59:59`,
        Limit: 200,
      },
      staffMode: true,
    });
    const liveClass = (result.Classes ?? []).find(
      (candidate) =>
        Number(candidate.Id) === body.classId &&
        Number(candidate.ClassScheduleId) === body.classScheduleId,
    );
    const spotsRemaining = liveClass
      ? typeof liveClass.WebCapacity === "number"
        ? Number(liveClass.WebCapacity) - Number(liveClass.WebBooked ?? 0)
        : Number(liveClass.MaxCapacity) - Number(liveClass.TotalBooked)
      : 0;
    if (
      !liveClass ||
      liveClass.StartDateTime !== body.classStartsAt ||
      liveClass.IsCanceled ||
      !liveClass.IsAvailable ||
      spotsRemaining <= 0 ||
      !isAdultProgram(liveClass.ClassDescription?.Program?.Name)
    ) {
      return NextResponse.json(
        {
          ok: false,
          correlationId,
          code: "intro_class_not_available",
          error: "That adult class is no longer available. Please refresh and choose another time.",
        },
        { status: 409 },
      );
    }
    body = {
      ...body,
      className: liveClass.ClassDescription?.Name || liveClass.ClassName || body.className,
      classStartsAt: liveClass.StartDateTime,
      coachName:
        liveClass.Staff?.DisplayName ||
        [liveClass.Staff?.FirstName, liveClass.Staff?.LastName].filter(Boolean).join(" ") ||
        body.coachName,
    };
  } catch (e) {
    log.error("intro.class.verify-failed", { error: serialize(e) });
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "intro_class_verification_failed",
        error: "We could not safely verify that class. Please try again shortly.",
      },
      { status: 502 },
    );
  }

  log.info("intro.start", {
    writeMode: mbCfg.writeMode,
    location: location.id,
    offer: offer.key,
    classScheduleId: body.classScheduleId,
  });

  const trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }> = [];

  // Degraded-mode flag: when MindBody token issue is failing (sandbox
  // outage, Go-Live pending, creds rotated), we skip MindBody entirely
  // and capture the lead in HubSpot with status=manual_review so parents
  // still get a confirmation instead of a 502.
  let mbDegraded = false;

  try {
    let hubspotContact: Awaited<ReturnType<typeof findContactByEmail>>;
    try {
      hubspotContact = await findContactByEmail(hsCfg, log, body.adult.email, [
        "court16_booking_status",
        "court16_correlation_id",
      ]);
    } catch (e) {
      log.error("intro.hubspot-contact-lookup.fail", { error: serialize(e) });
      return NextResponse.json(
        {
          ok: false,
          correlationId,
          code: "hubspot_lookup_failed",
          error: "We could not safely start this request. Please try again shortly.",
        },
        { status: 502 },
      );
    }
    const activeStatuses = new Set([
      "pending_staff",
      "manual_review",
      "duplicate_email_softwall",
      "pending_payment",
      "pending_staff_assist",
    ]);
    const activeStatus = hubspotContact?.properties.court16_booking_status;
    if (activeStatus && activeStatuses.has(activeStatus)) {
      return NextResponse.json(
        {
          ok: false,
          correlationId,
          code: "active_booking_request_exists",
          error:
            "A trial or intro request is already active for this email. Court 16 staff will follow up; please do not submit another request.",
        },
        { status: 409 },
      );
    }

    const intakeDealCreated = await createDealSafely(
      hsCfg,
      log,
      {
        email: body.adult.email,
        correlationId,
        locationId: location.id,
        contactProperties: {
          firstname: body.adult.firstName,
          lastname: body.adult.lastName,
          phone: body.adult.phone,
          preferred_location: getHubspotPreferredLocation(location.id) ?? location.fullName,
        },
        classStartsAt: classStartsAtUtc,
        dealName: `Adult intro · ${offer.displayName} · ${location.fullName}`,
        amount: offer.priceUsd,
      },
      trace,
    );
    if (!intakeDealCreated) return introWorkItemFailure(correlationId);

    let existing: Awaited<ReturnType<typeof getClientsByEmail>>;
    try {
      existing = await getClientsByEmail(mbCfg, log, body.adult.email);
    } catch (e) {
      log.warn("intro.mindbody.degraded", { step: "getClientsByEmail", error: serialize(e) });
      mbDegraded = true;
      existing = [];
      trace.push({ step: "getClientsByEmail", status: "error", error: serialize(e) });
    }
    if (!mbDegraded) {
      trace.push({ step: "getClientsByEmail", status: "ok", data: { matched: existing.length } });
    }

    const intent = classifyIntent({
      bookingFor: "adult",
      mindbodyClientExists: existing.length > 0,
    });

    if (intent === "existing_user_softwall") {
      // Kids-trial families share the parent's email across parent AND child
      // records, so the email search can return the booker's kid — reference
      // the adult record, not whichever match came back first.
      const existingAdult = pickAdultClient(existing);
      const fields = buildFormFields({
        correlationId,
        body,
        offer,
        location,
        status: "duplicate_email_softwall",
        adultMbId: existingAdult?.Id != null ? String(existingAdult.Id) : undefined,
        baseUrl,
      });
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (softwall)", hsContext);
      const synced = await createDealSafely(
        hsCfg,
        log,
        {
          email: body.adult.email,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName:`Adult intro (softwall) · ${offer.displayName} · ${location.fullName}`,
          amount: 0,
        },
        trace,
      );
      if (!synced) return introDurableManualReview(correlationId);
      return NextResponse.json({ ok: true, correlationId, status: "duplicate_email_softwall" });
    }

    let adult: Awaited<ReturnType<typeof addClient>> | null = null;
    if (!mbDegraded) {
      try {
        // RH-required Consumer-Mode field set (probe via
        // GET /client/requiredclientfields on site 5748154). Defaults from
        // the location config for address; placeholders for fields the
        // intro form doesn't collect — staff updates at first visit.
        adult = await addClient(mbCfg, log, {
          FirstName: body.adult.firstName,
          LastName: body.adult.lastName,
          Email: body.adult.email,
          MobilePhone: body.adult.phone,
          BirthDate: body.adult.birthDate,
          ReferredBy: "Online",
          // Site 5748154 only accepts built-in genders in consumer mode;
          // custom genders return InvalidPermissionConfiguration. Default
          // to "Female" so the booking goes through; staff updates intake.
          Gender: "Female",
          AddressLine1: location.address,
          City: location.city,
          State: location.state,
          PostalCode: location.postalCode,
          // Self-as-emergency-contact placeholder. All 4 EmergencyContactInfo*
          // subfields are required by RH config or MindBody flags
          // EmergencyContact as missing.
          EmergencyContactInfoName: `${body.adult.firstName} ${body.adult.lastName}`,
          EmergencyContactInfoPhone: body.adult.phone,
          EmergencyContactInfoEmail: body.adult.email,
          EmergencyContactInfoRelationship: "Self (placeholder)",
          // Opt new Client into MindBody's transactional emails so the
          // "Add Court 16 to your Mindbody account" auto-link email actually
          // fires. MindBody defaults SendAccountEmails to false if omitted,
          // silently suppressing the canonical Mindbody Account setup CTA.
          SendAccountEmails: true,
          SendScheduleEmails: true,
        });
        trace.push({ step: "addClient (adult)", status: "ok", data: { id: adult.Id } });
      } catch (e) {
        log.warn("intro.mindbody.degraded", { step: "addClient", error: serialize(e) });
        mbDegraded = true;
        trace.push({ step: "addClient (adult)", status: "error", error: serialize(e) });
      }
    }

    // Degraded path: MindBody is down. Log to HubSpot as manual_review
    // so staff can call the parent and book manually, and return a
    // confirmation that the app can display as a soft "we'll reach out".
    if (mbDegraded || !adult) {
      const fields = buildFormFields({
        correlationId,
        body,
        offer,
        location,
        status: "manual_review",
        adultMbId: adult?.Id != null ? String(adult.Id) : undefined,
        baseUrl,
      });
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (manual_review)", hsContext);
      const synced = await createDealSafely(
        hsCfg,
        log,
        {
          email: body.adult.email,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName:`Adult intro (manual review) · ${offer.displayName} · ${location.fullName}`,
          amount: 0,
        },
        trace,
      );
      if (!synced) return introDurableManualReview(correlationId);
      log.info("intro.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })), degraded: true });
      return NextResponse.json({
        ok: true,
        correlationId,
        status: "manual_review",
        cartUrl: null,
      });
    }

    // Staff-assist flow (e.g. Pickleball BOGO): no cart, no payment.
    // Lead lands in HubSpot for staff follow-up; they coordinate the slot
    // manually and trigger the booking via the existing staff/confirm URL.
    if (offer.flow === "staff_assist") {
      // TODO(Package A): await notifyStaffForBogo({ correlationId, adultId: adult.Id, offerKey: offer.key, location: location.id })
      //   Wire Slack / email transport here once Package A lands the helper.
      const fields = buildFormFields({
        correlationId,
        body,
        offer,
        location,
        status: "pending_staff_assist",
        adultMbId: adult.Id ? String(adult.Id) : undefined,
        baseUrl,
      });
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (staff_assist)", hsContext);
      const synced = await createDealSafely(
        hsCfg,
        log,
        {
          email: body.adult.email,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName:`Adult intro (staff assist) · ${offer.displayName} · ${location.fullName}`,
          amount: 0,
        },
        trace,
      );
      if (!synced) return introDurableManualReview(correlationId);

      log.info("intro.done", {
        trace: trace.map((t) => ({ step: t.step, status: t.status })),
        staffAssist: true,
      });

      return NextResponse.json({
        ok: true,
        correlationId,
        status: "pending_staff_assist",
        cartUrl: null,
      });
    }

    // Payment flow (default): cart URL redirect, booked on payment confirm.
    // Per-location service ID when configured, else MindBody's cart shows
    // the service picker.
    const serviceId = offer.serviceIdByLocation[location.id]!;
    const cartUrl = buildAdultCartUrl({
      siteId: mbCfg.siteId,
      serviceId,
      clientId: adult.Id ?? undefined,
    });
    trace.push({ step: "buildCartUrl", status: "ok", data: { cartUrl } });

    const fields = buildFormFields({
      correlationId,
      body,
      offer,
      location,
      status: "pending_payment",
      adultMbId: adult.Id ? String(adult.Id) : undefined,
      baseUrl,
    });
    await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm", hsContext);
    const synced = await createDealSafely(
      hsCfg,
      log,
      {
        email: body.adult.email,
        correlationId,
        locationId: location.id,
        contactProperties: contactPropertiesFromFields(fields),
        dealName: `Adult intro · ${offer.displayName} · ${location.fullName}`,
        amount: offer.priceUsd,
      },
      trace,
    );
    if (!synced) return introDurableManualReview(correlationId);

    log.info("intro.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      status: "pending_payment",
      cartUrl,
      confirmationToken: signToken({
        action: "intro_payment_confirm",
        correlationId,
        ttlHours: 6,
      }),
    });
  } catch (e) {
    log.error("intro.fail", { error: serialize(e) });
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        code: "intro_request_failed",
        error: "We could not complete this request safely. Please contact Court 16.",
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
  body: IntroBody;
  offer: NonNullable<ReturnType<typeof getOffer>>;
  location: NonNullable<ReturnType<typeof getLocationById>>;
  status:
    | "pending_payment"
    | "pending_staff_assist"
    | "duplicate_email_softwall"
    | "confirmed"
    | "manual_review";
  adultMbId?: string;
  baseUrl: string;
}
function buildFormFields(args: BuildFieldsArgs) {
  const { correlationId, body, offer, location, status, adultMbId, baseUrl } = args;
  const adultDob = body.adult.birthDate;

  return {
    firstname: body.adult.firstName,
    lastname: body.adult.lastName,
    email: body.adult.email,
    phone: body.adult.phone,

    // Court 16's HubSpot dropdown has portal-baked option strings — must
    // match exactly. Fall back to fullName if the location isn't mapped.
    preferred_location: getHubspotPreferredLocation(location.id) ?? location.fullName,
    // Reuse the shared Contact schema for adults so current reporting and the
    // optional legacy form remain compatible. Workflows split on intent.
    child_name: body.adult.firstName,
    child_1___last_name: body.adult.lastName,
    childage: "15 and older",
    // Single un-suffixed field (HubSpot form rejects the 3-part split).
    child_date_of_birth: adultDob,
    child_1___playing_level: "New to Tennis",
    school: "—",
    lead_source: "Other",
    any_question_just_let_us_know: body.notes,

    court16_correlation_id: correlationId,
    court16_intent: "adult_intro" as const,
    court16_booking_status: status,
    // Per-occurrence MindBody ClassId (Bug E fix — see trial route).
    court16_class_id: String(body.classId),
    court16_location_slug: location.id,
    // Human-readable companions to court16_class_id / court16_location_slug.
    // Added May 22 — see trial route for the rationale.
    court16_class_name: body.className,
    court16_class_day_time: body.classStartsAt
      ? formatClassDayTime(body.classStartsAt, location.timezone)
      : `${body.classDay} ${body.classTime}`,
    court16_coach_name: body.coachName,
    court16_location_full: location.fullName,
    court16_offer_key: offer.key,
    court16_waiver_version: body.waiverVersion ?? WAIVER_VERSION,
    court16_mindbody_parent_id: adultMbId,
    court16_staff_confirm_url: buildStaffUrl({ action: "confirm", correlationId, baseUrl }),
    court16_staff_reassign_url: buildStaffUrl({ action: "reassign", correlationId, baseUrl }),
    court16_staff_deny_url: buildStaffUrl({ action: "deny", correlationId, baseUrl }),
  };
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
    log.info("intro.hubspot.skipped", { reason: "HubSpot not configured" });
    trace.push({ step: label, status: "skipped", data: { reason: "HubSpot not configured" } });
    return;
  }
  if (!hsCfg.submitLegacyTrialForm) {
    log.info("intro.hubspot.legacy-form.skipped", {
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
    log.warn("intro.hubspot.fail", { error: serialize(e) });
    trace.push({ step: label, status: "error", error: serialize(e) });
  }
}

/**
 * Same hutk/pageUri sanitation as the trial route — a malformed hutk gets
 * the whole Forms API submission rejected, so validate before forwarding.
 */
function sanitizeHsContext(
  ctx: IntroBody["hsContext"],
): { hutk?: string; pageUri?: string; pageName?: string } | undefined {
  if (!ctx) return undefined;
  const out: { hutk?: string; pageUri?: string; pageName?: string } = {};
  if (typeof ctx.hutk === "string" && /^[a-f0-9]{32}$/i.test(ctx.hutk)) out.hutk = ctx.hutk;
  if (typeof ctx.pageUri === "string" && /^https?:\/\//.test(ctx.pageUri))
    out.pageUri = ctx.pageUri.slice(0, 500);
  if (typeof ctx.pageName === "string" && ctx.pageName) out.pageName = ctx.pageName.slice(0, 200);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Subset of buildFormFields output that maps to real Contact CRM props. */
function contactPropertiesFromFields(fields: ReturnType<typeof buildFormFields>): Record<string, string | undefined> {
  return {
    firstname: fields.firstname,
    lastname: fields.lastname,
    phone: fields.phone,
    preferred_location: fields.preferred_location,
    child_name: fields.child_name,
    child_1___last_name: fields.child_1___last_name,
    childage: fields.childage,
    child_date_of_birth: fields.child_date_of_birth,
    child_1___playing_level: fields.child_1___playing_level,
    school: fields.school,
    lead_source: fields.lead_source,
    any_question_just_let_us_know: fields.any_question_just_let_us_know,
    court16_correlation_id: fields.court16_correlation_id,
    court16_intent: fields.court16_intent,
    court16_booking_status: fields.court16_booking_status,
    court16_class_id: fields.court16_class_id,
    court16_location_slug: fields.court16_location_slug,
    court16_class_name: fields.court16_class_name,
    court16_class_day_time: fields.court16_class_day_time,
    court16_coach_name: fields.court16_coach_name,
    court16_location_full: fields.court16_location_full,
    court16_offer_key: fields.court16_offer_key,
    court16_waiver_version: fields.court16_waiver_version,
    court16_mindbody_parent_id: fields.court16_mindbody_parent_id,
    court16_staff_confirm_url: fields.court16_staff_confirm_url,
    court16_staff_reassign_url: fields.court16_staff_reassign_url,
    court16_staff_deny_url: fields.court16_staff_deny_url,
  };
}

/**
 * Upsert the Contact + create a Deal in the location-specific Trials
 * pipeline. Soft-failure: never throws. Mirrors the helper of the same
 * name in app/api/book/trial/route.ts (adult variant differs only in
 * the contact-property subset shape).
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
      data: { contactId: contact.id, dealId: deal.id, cached: deal.cached, pipeline: pipeline.pipelineId },
    });
    return true;
  } catch (e) {
    log.warn("intro.deal.fail", { error: serialize(e) });
    trace.push({ step: "hubspot.createTrialDeal", status: "error", error: serialize(e) });
    return false;
  }
}

function introWorkItemFailure(correlationId: string) {
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

function introDurableManualReview(correlationId: string) {
  return NextResponse.json(
    {
      ok: true,
      correlationId,
      status: "manual_review",
      cartUrl: null,
      warning:
        "Your request is in the staff queue, but account setup needs review. Do not submit again.",
    },
    { status: 202 },
  );
}

function validate(body: IntroBody | undefined): string[] {
  if (!body) return ["Body is required"];
  const errors: string[] = [];
  if (!body.locationId) errors.push("locationId is required");
  if (!body.offerKey) errors.push("offerKey is required");
  if (!body.adult) errors.push("adult is required");
  if (body.adult) {
    if (!body.adult.firstName) errors.push("adult.firstName is required");
    if (!body.adult.lastName) errors.push("adult.lastName is required");
    if (!/^\S+@\S+\.\S+$/.test(body.adult.email ?? "")) errors.push("adult.email is invalid");
    if (!body.adult.phone || body.adult.phone.replace(/\D/g, "").length < 7)
      errors.push("adult.phone is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.adult.birthDate ?? ""))
      errors.push('adult.birthDate must be "YYYY-MM-DD"');
  }
  if (typeof body.classScheduleId !== "number")
    errors.push("classScheduleId must be a number");
  if (typeof body.classId !== "number") errors.push("classId must be a number");
  if (!body.classStartsAt) errors.push("classStartsAt is required");
  return errors;
}

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof HubspotError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
