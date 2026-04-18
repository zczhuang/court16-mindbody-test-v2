import { NextResponse } from "next/server";
import {
  addClient,
  addClientRelationship,
  checkCallerToken,
  getClientsByEmail,
  GUARDIAN_RELATIONSHIP,
  loadConfigFromEnv,
  MindbodyError,
} from "@/lib/mindbody";
import {
  HubspotError,
  loadHubspotConfig,
  submitTrialForm,
} from "@/lib/hubspot";
import { buildStaffUrl } from "@/lib/staff-tokens";
import { classifyIntent } from "@/lib/intent";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { getLocationById } from "@/config/locations";
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

  log.info("trial.start", {
    writeMode: mbCfg.writeMode,
    parentEmail: body.parentEmail,
    childName: primaryKid.firstName,
    location: location.id,
    classScheduleId: body.classScheduleId,
  });

  const trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }> = [];

  try {
    const existing = await getClientsByEmail(mbCfg, log, body.parentEmail);
    trace.push({ step: "getClientsByEmail", status: "ok", data: { matched: existing.length } });

    const intent = classifyIntent({
      bookingFor: "kid",
      mindbodyClientExists: existing.length > 0,
    });

    if (intent === "existing_user_softwall") {
      await submitFormSafely(
        hsCfg,
        log,
        buildFormFields({
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
        }),
        trace,
        "hubspot.submitTrialForm (softwall)",
      );
      return NextResponse.json({ ok: true, correlationId, status: "duplicate_email_softwall", trace });
    }

    const parent = await addClient(mbCfg, log, {
      FirstName: body.parentFirstName,
      LastName: "-", // HubSpot collects last name, MindBody needs non-empty
      Email: body.parentEmail,
      MobilePhone: body.parentPhone,
      BirthDate: PARENT_DOB_PLACEHOLDER,
    });
    trace.push({ step: "addClient (parent)", status: "ok", data: { id: parent.Id } });

    const childEmail = `kid+${correlationId}@court16-test.invalid`;
    const child = await addClient(mbCfg, log, {
      FirstName: primaryKid.firstName,
      LastName: "-",
      Email: childEmail,
      BirthDate: childDob,
    });
    trace.push({ step: "addClient (child)", status: "ok", data: { id: child.Id } });

    let relationshipStatus: "ok" | "skipped" | "error" = "skipped";
    let relationshipError: unknown = undefined;
    if (parent.Id && child.Id) {
      try {
        await addClientRelationship(mbCfg, log, {
          ClientId: parent.Id,
          RelatedClientId: child.Id,
          RelationshipId: GUARDIAN_RELATIONSHIP.Id,
        });
        relationshipStatus = "ok";
      } catch (e) {
        relationshipStatus = "error";
        relationshipError = serialize(e);
      }
    }
    trace.push({ step: "addClientRelationship", status: relationshipStatus, error: relationshipError });

    await submitFormSafely(
      hsCfg,
      log,
      buildFormFields({
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
      }),
      trace,
      "hubspot.submitTrialForm",
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
  status: "pending_staff" | "duplicate_email_softwall" | "pending_payment";
  parentMbId?: string;
  childMbId?: string;
  baseUrl: string;
}
function buildFormFields(args: BuildFieldsArgs) {
  const { correlationId, body, primaryKid, childDob, ageBand, location, status, parentMbId, childMbId, baseUrl } = args;
  const [yyyy, mm, dd] = childDob.split("-");

  return {
    firstname: body.parentFirstName,
    lastname: "-",
    email: body.parentEmail,
    phone: body.parentPhone,

    preferred_location: location.fullName,
    child_name: primaryKid.firstName,
    child_1___last_name: "-",
    childage: ageBand,
    child_date_of_birth__YYYY: yyyy,
    child_date_of_birth__MM: mm,
    child_date_of_birth__DD: dd,
    child_1___playing_level: HUBSPOT_DEFAULTS.child_1___playing_level,
    school: HUBSPOT_DEFAULTS.school,
    lead_source: HUBSPOT_DEFAULTS.lead_source,
    any_question_just_let_us_know: body.notes,

    court16_correlation_id: correlationId,
    court16_intent: "kid_trial" as const,
    court16_booking_status: status,
    court16_class_id: String(body.classScheduleId),
    court16_location_slug: location.id,
    court16_waiver_version: WAIVER_VERSION,
    court16_mindbody_parent_id: parentMbId,
    court16_mindbody_child_id: childMbId,
    court16_staff_confirm_url: buildStaffUrl({ action: "confirm", correlationId, baseUrl }),
    court16_staff_reassign_url: buildStaffUrl({ action: "reassign", correlationId, baseUrl }),
    court16_admin_retry_url: buildStaffUrl({ action: "retry", correlationId, baseUrl }),
  };
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
  if (!/^\S+@\S+\.\S+$/.test(body.parentEmail ?? "")) errors.push("parentEmail is invalid");
  if (!body.parentPhone || body.parentPhone.replace(/\D/g, "").length < 7)
    errors.push("parentPhone is required");
  if (!body.childFirstName && (!body.children || body.children.length === 0))
    errors.push("childFirstName or children[] is required");
  if (!body.locationId) errors.push("locationId is required");
  if (typeof body.classScheduleId !== "number") errors.push("classScheduleId must be a number");
  return errors;
}

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof HubspotError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
