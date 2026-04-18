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
  createBooking,
  HubspotError,
  loadHubspotConfig,
  upsertContact,
} from "@/lib/hubspot";
import { buildStaffUrl } from "@/lib/staff-tokens";
import { classifyIntent } from "@/lib/intent";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { COMFORT_LEVELS, getLocation, WAIVER_VERSION } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TrialBody {
  location: string;
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    mobilePhone?: string;
    birthDate: string;
  };
  child: {
    firstName: string;
    lastName: string;
    age: number;
    comfortLevel: string;
    birthDate: string;
  };
  classId: number;
  waiverVersion: string;
}

export async function POST(req: Request) {
  const correlationId = makeCorrelationId();
  const log = createLogger(correlationId);

  const auth = checkCallerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, correlationId, error: auth.reason }, { status: auth.status });
  }

  let body: TrialBody;
  try {
    body = (await req.json()) as TrialBody;
  } catch {
    return NextResponse.json({ ok: false, correlationId, error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validate(body);
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, correlationId, errors }, { status: 400 });
  }

  const location = getLocation(body.location);
  if (!location) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown location: ${body.location}` },
      { status: 400 },
    );
  }

  let mbCfg;
  try {
    mbCfg = { ...loadConfigFromEnv(), siteId: location.mindbodySiteId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 500 });
  }
  const hsCfg = loadHubspotConfig();
  const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:3000`;

  log.info("trial.start", {
    writeMode: mbCfg.writeMode,
    parentEmail: body.parent.email,
    childName: body.child.firstName,
    location: location.slug,
    classId: body.classId,
  });

  const trace: Array<{ step: string; status: "ok" | "skipped" | "error"; data?: unknown; error?: unknown }> = [];

  try {
    // 1. Identity resolution — MindBody first.
    const existing = await getClientsByEmail(mbCfg, log, body.parent.email);
    trace.push({ step: "getClientsByEmail", status: "ok", data: { matched: existing.length } });

    const intent = classifyIntent({
      bookingFor: "kid",
      mindbodyClientExists: existing.length > 0,
    });

    if (intent === "existing_user_softwall") {
      // Returning user — Track 1 doesn't have magic-link auth yet. Record
      // the intent in HubSpot so staff can reach out, but do NOT write to
      // MindBody.
      await writeSoftwallRecord(hsCfg, log, {
        correlationId,
        body,
        locationSlug: location.slug,
      });
      return NextResponse.json({
        ok: true,
        correlationId,
        status: "duplicate_email_softwall",
        trace,
      });
    }

    // 2. Create parent.
    const parent = await addClient(mbCfg, log, {
      FirstName: body.parent.firstName,
      LastName: body.parent.lastName,
      Email: body.parent.email,
      MobilePhone: body.parent.mobilePhone,
      BirthDate: body.parent.birthDate,
    });
    trace.push({ step: "addClient (parent)", status: "ok", data: { id: parent.Id } });

    // 3. Create child. Synthetic email because MindBody requires a unique
    // email per client; kids don't have their own.
    const childEmail = `kid+${correlationId}@court16-test.invalid`;
    const child = await addClient(mbCfg, log, {
      FirstName: body.child.firstName,
      LastName: body.child.lastName,
      Email: childEmail,
      BirthDate: body.child.birthDate,
    });
    trace.push({ step: "addClient (child)", status: "ok", data: { id: child.Id } });

    // 4. Link parent → child (Guardian). In Test mode this path is a
    // best-effort: the harness returns Id:null for test-created clients, so
    // there's no real ID to link. Skip gracefully in that case.
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
        // Non-fatal in Track 1 — staff can re-run relationship via admin retry.
        relationshipStatus = "error";
        relationshipError = serialize(e);
      }
    }
    trace.push({
      step: "addClientRelationship",
      status: relationshipStatus,
      error: relationshipError,
    });

    // 5. HubSpot Contact + Booking.
    let hsContactId: string | undefined;
    let hsBookingId: string | undefined;
    let hubspotStatus: "ok" | "skipped" | "error" = "skipped";

    if (hsCfg) {
      try {
        const contact = await upsertContact(hsCfg, log, {
          email: body.parent.email,
          firstname: body.parent.firstName,
          lastname: body.parent.lastName,
          phone: body.parent.mobilePhone,
          court16_intent: "kid_trial",
          court16_child_name: `${body.child.firstName} ${body.child.lastName}`,
          court16_child_age: String(body.child.age),
          court16_location: location.slug,
          court16_correlation_id: correlationId,
          court16_waiver_version: body.waiverVersion,
        });
        hsContactId = contact.id;

        const staffConfirmUrl = buildStaffUrl({ action: "confirm", correlationId, baseUrl });
        const staffReassignUrl = buildStaffUrl({ action: "reassign", correlationId, baseUrl });
        const adminRetryUrl = buildStaffUrl({ action: "retry", correlationId, baseUrl });

        const booking = await createBooking(
          hsCfg,
          log,
          {
            correlation_id: correlationId,
            intent: "kid_trial",
            status: "pending_staff",
            location_id: location.slug,
            class_id: String(body.classId),
            mindbody_parent_id: parent.Id ? String(parent.Id) : "",
            mindbody_child_id: child.Id ? String(child.Id) : "",
            waiver_version: body.waiverVersion,
            staff_confirm_url: staffConfirmUrl,
            staff_reassign_url: staffReassignUrl,
            admin_retry_url: adminRetryUrl,
            payload_json: JSON.stringify(body),
          },
          { contactId: hsContactId },
        );
        hsBookingId = booking.id;
        hubspotStatus = "ok";
      } catch (e) {
        // Non-fatal for Track 1 kickoff — MindBody writes already landed.
        // The admin retry path can re-emit the HubSpot write once the
        // custom object / workflows are configured.
        hubspotStatus = "error";
        log.warn("trial.hubspot.fail", { error: serialize(e) });
      }
    } else {
      log.info("trial.hubspot.skipped", {
        reason: "HUBSPOT_ACCESS_TOKEN or HUBSPOT_CUSTOM_OBJECT_TYPE_ID not set — staff notification will not fire until HubSpot is configured",
      });
    }
    trace.push({
      step: "hubspot.upsertContact + createBooking",
      status: hubspotStatus,
      data: { contactId: hsContactId, bookingId: hsBookingId },
    });

    log.info("trial.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      writeMode: mbCfg.writeMode,
      status: "pending_staff",
      parentId: parent.Id ?? null,
      childId: child.Id ?? null,
      hubspotContactId: hsContactId ?? null,
      hubspotBookingId: hsBookingId ?? null,
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

async function writeSoftwallRecord(
  hsCfg: ReturnType<typeof loadHubspotConfig>,
  log: ReturnType<typeof createLogger>,
  params: { correlationId: string; body: TrialBody; locationSlug: string },
): Promise<void> {
  if (!hsCfg) {
    log.info("trial.softwall.hubspot.skipped", { reason: "HubSpot not configured" });
    return;
  }
  try {
    const contact = await upsertContact(hsCfg, log, {
      email: params.body.parent.email,
      firstname: params.body.parent.firstName,
      lastname: params.body.parent.lastName,
      phone: params.body.parent.mobilePhone,
      court16_intent: "kid_trial",
      court16_child_name: `${params.body.child.firstName} ${params.body.child.lastName}`,
      court16_child_age: String(params.body.child.age),
      court16_location: params.locationSlug,
      court16_correlation_id: params.correlationId,
      court16_waiver_version: params.body.waiverVersion,
    });
    await createBooking(
      hsCfg,
      log,
      {
        correlation_id: params.correlationId,
        intent: "kid_trial",
        status: "duplicate_email_softwall",
        location_id: params.locationSlug,
        class_id: String(params.body.classId),
        waiver_version: params.body.waiverVersion,
        payload_json: JSON.stringify(params.body),
      },
      { contactId: contact.id },
    );
  } catch (e) {
    log.warn("trial.softwall.hubspot.fail", { error: serialize(e) });
  }
}

function validate(body: TrialBody | undefined): string[] {
  if (!body) return ["Body is required"];
  const errors: string[] = [];
  if (!body.location) errors.push("location is required");
  if (!body.parent) errors.push("parent is required");
  if (!body.child) errors.push("child is required");
  if (body.parent) {
    if (!body.parent.firstName) errors.push("parent.firstName is required");
    if (!body.parent.lastName) errors.push("parent.lastName is required");
    if (!/^\S+@\S+\.\S+$/.test(body.parent.email ?? "")) errors.push("parent.email is invalid");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.parent.birthDate ?? ""))
      errors.push('parent.birthDate must be "YYYY-MM-DD"');
  }
  if (body.child) {
    if (!body.child.firstName) errors.push("child.firstName is required");
    if (!body.child.lastName) errors.push("child.lastName is required");
    if (typeof body.child.age !== "number" || body.child.age < 3 || body.child.age > 18)
      errors.push("child.age must be between 3 and 18");
    if (!COMFORT_LEVELS.includes(body.child.comfortLevel as (typeof COMFORT_LEVELS)[number]))
      errors.push(`child.comfortLevel must be one of: ${COMFORT_LEVELS.join(", ")}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.child.birthDate ?? ""))
      errors.push('child.birthDate must be "YYYY-MM-DD"');
  }
  if (typeof body.classId !== "number") errors.push("classId must be a number");
  if (body.waiverVersion !== WAIVER_VERSION)
    errors.push(`waiverVersion must equal current version "${WAIVER_VERSION}"`);
  return errors;
}

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof HubspotError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
