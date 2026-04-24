import { NextResponse } from "next/server";
import {
  addClientToClass,
  getClientServices,
  loadConfigFromEnv,
  MindbodyError,
} from "@/lib/mindbody";
import {
  findContactByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  updateContact,
} from "@/lib/hubspot";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { getLocationById } from "@/config/locations";
import { getOffer } from "@/config/adult-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/book/intro/confirm
 *
 * Called by the payment-return page once the user finishes MindBody's
 * hosted cart. Verifies the client has the purchased service on their
 * account (via GetClientServices), then calls AddClientToClass to book
 * the session, then flips the HubSpot contact to `confirmed`.
 *
 * Idempotent: if the contact is already `confirmed`, returns the cached
 * success. Safe to refresh the return URL.
 */
export async function POST(req: Request) {
  const correlationId = (await req.json().catch(() => ({})))?.correlationId ?? null;
  if (!correlationId) {
    const cid = makeCorrelationId();
    return NextResponse.json(
      { ok: false, correlationId: cid, error: "correlationId is required" },
      { status: 400 },
    );
  }
  const log = createLogger(correlationId);

  const hsCfg = loadHubspotConfig();
  if (!hsCfg) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        error:
          "HubSpot not configured — cannot resolve booking context. Set HUBSPOT_ACCESS_TOKEN / HUBSPOT_PORTAL_ID / HUBSPOT_TRIAL_FORM_GUID.",
      },
      { status: 503 },
    );
  }

  let mbCfg;
  try {
    mbCfg = loadConfigFromEnv();
  } catch (e) {
    return NextResponse.json(
      { ok: false, correlationId, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  let contact: Awaited<ReturnType<typeof findContactByCorrelationId>>;
  try {
    contact = await findContactByCorrelationId(hsCfg, log, correlationId);
  } catch (e) {
    const msg = e instanceof HubspotError ? `HubSpot error (${e.status})` : "HubSpot lookup failed";
    return NextResponse.json({ ok: false, correlationId, error: msg }, { status: 502 });
  }
  if (!contact) {
    return NextResponse.json(
      { ok: false, correlationId, error: "Booking not found" },
      { status: 404 },
    );
  }

  // Idempotency: already confirmed → return success without re-booking.
  if (contact.properties.court16_booking_status === "confirmed") {
    return NextResponse.json({ ok: true, correlationId, status: "confirmed", cached: true });
  }

  const locationSlug = contact.properties.court16_location_slug;
  const location = locationSlug ? getLocationById(locationSlug) : undefined;
  if (location) {
    const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
    mbCfg = { ...mbCfg, siteId: useSandbox ? mbCfg.siteId : String(location.siteId) };
  }

  const classId = contact.properties.court16_class_id
    ? Number(contact.properties.court16_class_id)
    : undefined;
  const clientId =
    contact.properties.court16_mindbody_parent_id ||
    contact.properties.court16_mindbody_child_id;

  if (!classId || !clientId) {
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "failed",
      court16_failure_reason: "Missing class_id or client id on contact",
    });
    return NextResponse.json(
      { ok: false, correlationId, error: "booking record missing class or client" },
      { status: 422 },
    );
  }

  // Verify the service purchase landed on the client.
  try {
    const services = await getClientServices(mbCfg, log, clientId);
    if (services.length === 0 && mbCfg.writeMode !== "test") {
      await updateContact(hsCfg, log, contact.id, {
        court16_booking_status: "manual_review",
        court16_failure_reason: "No services found — payment may not have completed",
      });
      return NextResponse.json({
        ok: true,
        correlationId,
        status: "manual_review",
        reason: "payment_not_detected",
      });
    }
  } catch (e) {
    // Don't fail the flow on a verification error; just log.
    log.warn("intro.confirm.getServices.fail", { error: e instanceof Error ? e.message : e });
  }

  // Resolve the MindBody service ID from the stored offer key + location.
  // Threaded to AddClientToClass as ClientServiceId so the enrollment
  // binds to the right service line. Undefined → MindBody picks first
  // applicable pricing (existing behavior, no regression).
  const offerKey = contact.properties.court16_offer_key;
  const offer = offerKey ? getOffer(offerKey) : undefined;
  const serviceId = offer && locationSlug ? offer.serviceIdByLocation[locationSlug] : undefined;

  // Book the class.
  try {
    await addClientToClass(mbCfg, log, {
      ClientId: clientId,
      ClassId: classId,
      ClientServiceId: serviceId,
    });
  } catch (e) {
    const serialized =
      e instanceof MindbodyError ? JSON.stringify(e.toJSON()) : e instanceof Error ? e.message : String(e);
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "failed",
      court16_failure_reason: `AddClientToClass: ${serialized}`.slice(0, 4000),
    });
    return NextResponse.json(
      { ok: false, correlationId, error: "booking failed", detail: serialized },
      { status: 502 },
    );
  }

  await updateContact(hsCfg, log, contact.id, { court16_booking_status: "confirmed" });
  return NextResponse.json({ ok: true, correlationId, status: "confirmed" });
}
