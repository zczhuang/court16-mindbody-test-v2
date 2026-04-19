import { NextResponse } from "next/server";
import {
  addClient,
  buildAdultCartUrl,
  checkCallerToken,
  getClientsByEmail,
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
import { getOffer } from "@/config/adult-config";

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
  className: string;
  classDay: string;
  classTime: string;
  coachName: string;
  notes?: string;
  waiverVersion?: string;
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

  const location = getLocationById(body.locationId);
  if (!location) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown locationId: ${body.locationId}` },
      { status: 400 },
    );
  }

  const offer = getOffer(body.offerKey);
  if (!offer) {
    return NextResponse.json(
      { ok: false, correlationId, error: `unknown offerKey: ${body.offerKey}` },
      { status: 400 },
    );
  }

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
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  log.info("intro.start", {
    writeMode: mbCfg.writeMode,
    adultEmail: body.adult.email,
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
      await submitFormSafely(
        hsCfg,
        log,
        buildFormFields({
          correlationId,
          body,
          offer,
          location,
          status: "duplicate_email_softwall",
          adultMbId: existing[0]?.Id != null ? String(existing[0].Id) : undefined,
          baseUrl,
        }),
        trace,
        "hubspot.submitTrialForm (softwall)",
      );
      return NextResponse.json({ ok: true, correlationId, status: "duplicate_email_softwall", trace });
    }

    let adult: Awaited<ReturnType<typeof addClient>> | null = null;
    if (!mbDegraded) {
      try {
        adult = await addClient(mbCfg, log, {
          FirstName: body.adult.firstName,
          LastName: body.adult.lastName,
          Email: body.adult.email,
          MobilePhone: body.adult.phone,
          BirthDate: body.adult.birthDate,
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
      await submitFormSafely(
        hsCfg,
        log,
        buildFormFields({
          correlationId,
          body,
          offer,
          location,
          status: "manual_review",
          adultMbId: undefined,
          baseUrl,
        }),
        trace,
        "hubspot.submitTrialForm (manual_review)",
      );
      log.info("intro.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })), degraded: true });
      return NextResponse.json({
        ok: true,
        correlationId,
        writeMode: mbCfg.writeMode,
        status: "manual_review",
        adultId: null,
        cartUrl: null,
        trace,
      });
    }

    // Cart URL — uses per-location service ID when configured, else the
    // generic redirect works too.
    const serviceId =
      offer.serviceIdByLocation[location.id] ?? 0; // 0 = unconfigured; MindBody will show the service picker
    const cartUrl = buildAdultCartUrl({
      siteId: mbCfg.siteId,
      serviceId,
      clientId: adult.Id ?? undefined,
    });
    trace.push({ step: "buildCartUrl", status: "ok", data: { cartUrl } });

    await submitFormSafely(
      hsCfg,
      log,
      buildFormFields({
        correlationId,
        body,
        offer,
        location,
        status: "pending_payment",
        adultMbId: adult.Id ? String(adult.Id) : undefined,
        baseUrl,
      }),
      trace,
      "hubspot.submitTrialForm",
    );

    log.info("intro.done", { trace: trace.map((t) => ({ step: t.step, status: t.status })) });

    return NextResponse.json({
      ok: true,
      correlationId,
      writeMode: mbCfg.writeMode,
      status: "pending_payment",
      adultId: adult.Id ?? null,
      cartUrl,
      trace,
    });
  } catch (e) {
    log.error("intro.fail", { error: serialize(e) });
    return NextResponse.json(
      { ok: false, correlationId, trace, error: serialize(e) },
      { status: e instanceof MindbodyError ? 502 : 500 },
    );
  }
}

interface BuildFieldsArgs {
  correlationId: string;
  body: IntroBody;
  offer: NonNullable<ReturnType<typeof getOffer>>;
  location: NonNullable<ReturnType<typeof getLocationById>>;
  status: "pending_payment" | "duplicate_email_softwall" | "confirmed" | "manual_review";
  adultMbId?: string;
  baseUrl: string;
}
function buildFormFields(args: BuildFieldsArgs) {
  const { correlationId, body, offer, location, status, adultMbId, baseUrl } = args;
  const [yyyy, mm, dd] = body.adult.birthDate.split("-");

  return {
    firstname: body.adult.firstName,
    lastname: body.adult.lastName,
    email: body.adult.email,
    phone: body.adult.phone,

    preferred_location: location.fullName,
    // Reuse the kids form shape for adults. Child fields stay populated so
    // the form submit validates; staff filters on court16_intent to split
    // flows in HubSpot workflows.
    child_name: body.adult.firstName,
    child_1___last_name: body.adult.lastName,
    childage: "15 and older",
    child_date_of_birth__YYYY: yyyy,
    child_date_of_birth__MM: mm,
    child_date_of_birth__DD: dd,
    child_1___playing_level: "New to Tennis",
    school: "—",
    lead_source: "Other",
    any_question_just_let_us_know: body.notes,

    court16_correlation_id: correlationId,
    court16_intent: "adult_intro" as const,
    court16_booking_status: status,
    court16_class_id: String(body.classScheduleId),
    court16_location_slug: location.id,
    court16_waiver_version: body.waiverVersion ?? WAIVER_VERSION,
    court16_mindbody_parent_id: adultMbId,
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
    log.info("intro.hubspot.skipped", { reason: "HubSpot not configured" });
    trace.push({ step: label, status: "skipped", data: { reason: "HubSpot not configured" } });
    return;
  }
  try {
    await submitTrialForm(hsCfg, log, fields);
    trace.push({ step: label, status: "ok" });
  } catch (e) {
    log.warn("intro.hubspot.fail", { error: serialize(e) });
    trace.push({ step: label, status: "error", error: serialize(e) });
  }
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
  return errors;
}

function serialize(e: unknown): unknown {
  if (e instanceof MindbodyError) return e.toJSON();
  if (e instanceof HubspotError) return e.toJSON();
  if (e instanceof Error) return { name: e.name, message: e.message };
  return e;
}
