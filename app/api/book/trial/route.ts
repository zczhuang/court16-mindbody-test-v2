import { NextResponse } from "next/server";
import {
  addClient,
  checkCallerToken,
  getClientsByEmail,
  loadConfigFromEnv,
  MindbodyError,
  PAYS_FOR_RELATIONSHIP,
} from "@/lib/mindbody";
import {
  createTrialDeal,
  HubspotError,
  loadHubspotConfig,
  submitTrialForm,
  upsertContactByEmail,
} from "@/lib/hubspot";
import { buildStaffUrl } from "@/lib/staff-tokens";
import { classifyIntent } from "@/lib/intent";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { formatClassDayTime, parseAgeRangeFromTitle, siteLocalToUtcIso } from "@/lib/class-utils";
import { getLocationById } from "@/config/locations";
import { getDealPipeline, getHubspotPreferredLocation } from "@/config/hubspot-deals";
import type { TrialRequest } from "@/lib/trial-types";

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

// MindBody's -99 sandbox requires BirthDate; prod sites may not.
const PARENT_DOB_PLACEHOLDER = "1985-01-01";

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

/** Compute a placeholder child DOB from an integer age, Jan 1 of the year they'd be that age. */
function dobFromAge(age: number): string {
  const year = new Date().getFullYear() - Math.max(0, age);
  return `${year}-01-01`;
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

  const location = getLocationById(body.locationId);
  if (!location) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown locationId: ${body.locationId}` },
      { status: 400 },
    );
  }

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
  const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:3000`;

  // For Track 1 we process the first child only; multi-child is Track 2.
  const primaryKid = body.children[0] ?? {
    firstName: body.childFirstName,
    age: body.childAge,
  };
  const childDob = dobFromAge(primaryKid.age);
  const ageBand = ageToBand(primaryKid.age);

  // MindBody returns `StartDateTime` as site-local wall-clock without a TZ
  // suffix. Convert to absolute UTC ISO here so HubSpot Deal `class_date`
  // (and downstream the 24h-reminder workflow) fire at the right instant.
  // Caught by smoke #2 v2 (Bug D).
  const classStartsAtUtc = body.classStartsAt
    ? siteLocalToUtcIso(body.classStartsAt, location.timezone)
    : undefined;

  log.info("trial.start", {
    writeMode: mbCfg.writeMode,
    parentEmail: body.parentEmail,
    childName: primaryKid.firstName,
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
    try {
      existing = await getClientsByEmail(mbCfg, log, body.parentEmail);
      trace.push({ step: "getClientsByEmail", status: "ok", data: { matched: existing.length } });
    } catch (e) {
      log.warn("trial.mindbody.degraded", { step: "getClientsByEmail", error: serialize(e) });
      mbDegraded = true;
      trace.push({ step: "getClientsByEmail", status: "error", error: serialize(e) });
    }

    const intent = classifyIntent({
      bookingFor: "kid",
      mindbodyClientExists: existing.length > 0,
    });

    if (intent === "existing_user_softwall") {
      const fields = buildFormFields({
        correlationId,
        body,
        primaryKid,
        childDob,
        ageBand,
        location,
        status: "duplicate_email_softwall",
        parentMbId: existing[0]?.Id != null ? String(existing[0].Id) : undefined,
        childMbId: undefined,
        baseUrl,
      });
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (softwall)");
      await createDealSafely(
        hsCfg,
        log,
        {
          email: body.parentEmail,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName: `Kids trial (softwall) — ${primaryKid.firstName} · ${location.fullName}`,
          amount: 0,
        },
        trace,
      );
      return NextResponse.json({ ok: true, correlationId, status: "duplicate_email_softwall", trace });
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
          BirthDate: body.parentBirthDate || PARENT_DOB_PLACEHOLDER,
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

        // Child AddClient with INLINE Pays For relationship to parent —
        // saves the round-trip and works in consumer mode (the standalone
        // addClientRelationship via UpdateClient returns
        // InvalidPermissionConfiguration without a staff token).
        const childEmail = `kid+${correlationId}@court16-test.invalid`;
        child = await addClient(mbCfg, log, {
          FirstName: primaryKid.firstName,
          LastName: "-",
          Email: childEmail,
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
          // Inline "Pays For" relationship: parent (related) pays for this
          // child (current AddClient). MindBody's Family Account UX
          // surfaces the kid under the parent's dashboard automatically.
          ClientRelationships: [
            {
              RelatedClientId: String(parent.Id),
              RelationshipName: PAYS_FOR_RELATIONSHIP.RelationshipName2, // "Pays For"
              Relationship: { ...PAYS_FOR_RELATIONSHIP },
            },
          ],
        });
        trace.push({ step: "addClient (child + inline Pays For)", status: "ok", data: { id: child.Id } });
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
        parentMbId: undefined,
        childMbId: undefined,
        baseUrl,
      });
      await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm (manual_review)");
      await createDealSafely(
        hsCfg,
        log,
        {
          email: body.parentEmail,
          correlationId,
          locationId: location.id,
          contactProperties: contactPropertiesFromFields(fields),
          classStartsAt: classStartsAtUtc,
          dealName: `Kids trial (manual review) — ${primaryKid.firstName} · ${location.fullName}`,
          amount: 0,
        },
        trace,
      );
      return NextResponse.json({
        ok: true,
        correlationId,
        writeMode: mbCfg.writeMode,
        status: "manual_review",
        parentId: null,
        childId: null,
        trace,
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
    await submitFormSafely(hsCfg, log, fields, trace, "hubspot.submitTrialForm");
    await createDealSafely(
      hsCfg,
      log,
      {
        email: body.parentEmail,
        correlationId,
        locationId: location.id,
        contactProperties: contactPropertiesFromFields(fields),
        classStartsAt: classStartsAtUtc,
        dealName: `Kids trial — ${primaryKid.firstName} · ${location.fullName}`,
        amount: 0,
      },
      trace,
    );

    log.info("trial.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      writeMode: mbCfg.writeMode,
      status: "pending_staff",
      parentId: parent.Id ?? null,
      childId: child.Id ?? null,
      trace,
    });
  } catch (e) {
    log.error("trial.fail", { error: serialize(e) });
    return NextResponse.json(
      { ok: false, correlationId, trace, error: serialize(e) },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}

interface BuildFieldsArgs {
  correlationId: string;
  body: TrialRequest;
  primaryKid: { firstName: string; age: number };
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
    child_1___last_name: "-",
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
    court16_admin_retry_url: buildStaffUrl({ action: "retry", correlationId, baseUrl }),
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
    court16_admin_retry_url: fields.court16_admin_retry_url,
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
): Promise<void> {
  if (!hsCfg) {
    trace.push({ step: "hubspot.createTrialDeal", status: "skipped", data: { reason: "HubSpot not configured" } });
    return;
  }
  const pipeline = getDealPipeline(args.locationId);
  if (!pipeline) {
    trace.push({
      step: "hubspot.createTrialDeal",
      status: "skipped",
      data: { reason: `no pipeline mapped for location ${args.locationId}` },
    });
    return;
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
  } catch (e) {
    log.warn("trial.deal.fail", { error: serialize(e) });
    trace.push({ step: "hubspot.createTrialDeal", status: "error", error: serialize(e) });
  }
}

async function submitFormSafely(
  hsCfg: ReturnType<typeof loadHubspotConfig>,
  log: ReturnType<typeof createLogger>,
  fields: ReturnType<typeof buildFormFields>,
  trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }>,
  label: string,
): Promise<void> {
  if (!hsCfg) {
    log.info("trial.hubspot.skipped", { reason: "HubSpot not configured" });
    trace.push({ step: label, status: "skipped", data: { reason: "HubSpot not configured" } });
    return;
  }
  try {
    await submitTrialForm(hsCfg, log, fields);
    trace.push({ step: label, status: "ok" });
  } catch (e) {
    log.warn("trial.hubspot.fail", { error: serialize(e) });
    trace.push({ step: label, status: "error", error: serialize(e) });
  }
}

function validate(body: TrialRequest | undefined): string[] {
  if (!body) return ["Body is required"];
  const errors: string[] = [];
  if (!body.parentFirstName) errors.push("parentFirstName is required");
  if (!body.parentLastName) errors.push("parentLastName is required");
  if (!/^\S+@\S+\.\S+$/.test(body.parentEmail ?? "")) errors.push("parentEmail is invalid");
  if (!body.parentPhone || body.parentPhone.replace(/\D/g, "").length < 7)
    errors.push("parentPhone is required");
  if (body.parentBirthDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.parentBirthDate))
    errors.push('parentBirthDate must be "YYYY-MM-DD"');
  if (!body.childFirstName && (!body.children || body.children.length === 0))
    errors.push("childFirstName or children[] is required");
  if (!body.locationId) errors.push("locationId is required");
  if (typeof body.classScheduleId !== "number") errors.push("classScheduleId must be a number");
  if (typeof body.classId !== "number") errors.push("classId must be a number");

  // Age-range check: reject bookings where a child's age falls outside the
  // class's eligible band. Range is parsed from the class title itself
  // (Court 16 titles encode the true range explicitly, e.g. "7 - 12.9yo").
  // Permissive — skipped when the title doesn't include a parseable range.
  const range = body.className ? parseAgeRangeFromTitle(body.className) : null;
  if (range) {
    const ages = (body.children ?? []).map((c) => c.age);
    if (body.childAge && !ages.includes(body.childAge)) ages.push(body.childAge);
    for (const age of ages) {
      if (age < range.ageMin || age > range.ageMax) {
        errors.push(
          `child age ${age} is outside eligible range ${range.ageMin}–${range.ageMax} for "${body.className}"`,
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
