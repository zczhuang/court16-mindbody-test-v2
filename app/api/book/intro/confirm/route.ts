import { NextResponse } from "next/server";
import {
  addClientToClass,
  getClientServices,
  loadConfigFromEnv,
  MindbodyError,
} from "@/lib/mindbody";
import {
  findContactByCorrelationId,
  findDealByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  moveDealStage,
  updateContact,
} from "@/lib/hubspot";
import { createLogger, makeCorrelationId } from "@/lib/logger";
import { getLocationById } from "@/config/locations";
import { getOffer, isAdultOfferReadyAtLocation } from "@/config/adult-config";
import { getDealPipeline } from "@/config/hubspot-deals";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";

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
  const body = (await req.json().catch(() => ({}))) as {
    correlationId?: string;
    confirmationToken?: string;
  };
  const correlationId = body.correlationId ?? null;
  if (!correlationId || !body.confirmationToken) {
    const cid = makeCorrelationId();
    return NextResponse.json(
      { ok: false, correlationId: cid, error: "secure confirmation state is required" },
      { status: 400 },
    );
  }
  const log = createLogger(correlationId);

  let confirmationState: ReturnType<typeof verifyToken>;
  try {
    confirmationState = verifyToken(body.confirmationToken);
  } catch (e) {
    const reason = e instanceof InvalidTokenError ? e.reason : "unknown";
    return NextResponse.json(
      { ok: false, correlationId, error: `invalid confirmation state (${reason})` },
      { status: 401 },
    );
  }
  if (
    confirmationState.action !== "intro_payment_confirm" ||
    confirmationState.correlationId !== correlationId
  ) {
    return NextResponse.json(
      { ok: false, correlationId, error: "confirmation state does not match this booking" },
      { status: 401 },
    );
  }

  const hsCfg = loadHubspotConfig();
  if (!hsCfg) {
    return NextResponse.json(
      {
        ok: false,
        correlationId,
        error:
          "HubSpot not configured — cannot resolve booking context. Set HUBSPOT_ACCESS_TOKEN and HUBSPOT_PORTAL_ID.",
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
  if (contact.properties.court16_intent !== "adult_intro") {
    return NextResponse.json(
      { ok: false, correlationId, error: "booking is not an adult intro" },
      { status: 409 },
    );
  }

  // Idempotency: already confirmed → return success without re-booking.
  if (contact.properties.court16_booking_status === "confirmed") {
    return NextResponse.json({ ok: true, correlationId, status: "confirmed", cached: true });
  }
  if (contact.properties.court16_booking_status !== "pending_payment") {
    return NextResponse.json(
      { ok: false, correlationId, error: "booking is not awaiting payment confirmation" },
      { status: 409 },
    );
  }

  const locationSlug = contact.properties.court16_location_slug;
  const location = locationSlug ? getLocationById(locationSlug) : undefined;
  const pipeline = location ? getDealPipeline(location.id) : null;
  if (!location || !location.publicBookingEnabled || !pipeline) {
    return NextResponse.json(
      { ok: false, correlationId, error: "booking location is missing or not enabled" },
      { status: 409 },
    );
  }
  const useSandbox = process.env.MINDBODY_USE_SANDBOX_FALLBACK === "true";
  mbCfg = { ...mbCfg, siteId: useSandbox ? mbCfg.siteId : String(location.siteId) };

  const classId = contact.properties.court16_class_id
    ? Number(contact.properties.court16_class_id)
    : undefined;
  const clientId = contact.properties.court16_mindbody_parent_id;

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

  const offerKey = contact.properties.court16_offer_key;
  const offer = offerKey ? getOffer(offerKey) : undefined;
  if (
    !offer ||
    offer.flow === "staff_assist" ||
    !isAdultOfferReadyAtLocation(offer, location.id)
  ) {
    return NextResponse.json(
      { ok: false, correlationId, error: "booking offer is missing or not payment-enabled" },
      { status: 409 },
    );
  }
  const expectedServiceName = offer.serviceNameByLocation?.[location.id];

  // Verify the exact purchased ClientService, not merely the existence of
  // any old credit on the account. The signed checkout state supplies the
  // earliest acceptable purchase time for this request.
  let purchasedClientServiceId: number;
  try {
    const services = await getClientServices(mbCfg, log, clientId);
    const earliestPurchaseMs = (confirmationState.iat! - 5 * 60) * 1000;
    const matchingService = services.find((service) => {
      const paymentMs = Date.parse(service.PaymentDate ?? "");
      const remaining = Number(service.Remaining ?? service.Count ?? 0);
      const expirationMs = service.ExpirationDate ? Date.parse(service.ExpirationDate) : Infinity;
      return (
        service.Name === expectedServiceName &&
        Number.isFinite(paymentMs) &&
        paymentMs >= earliestPurchaseMs &&
        remaining > 0 &&
        (!Number.isFinite(expirationMs) || expirationMs >= Date.now()) &&
        service.Id != null
      );
    });
    if (!matchingService || matchingService.Id == null) {
      await updateContact(hsCfg, log, contact.id, {
        court16_booking_status: "manual_review",
        court16_failure_reason: `Exact recent service not found: ${expectedServiceName}`,
      });
      return NextResponse.json({
        ok: true,
        correlationId,
        status: "manual_review",
        reason: "payment_not_detected",
      }, { status: 202 });
    }
    purchasedClientServiceId = Number(matchingService.Id);
  } catch (e) {
    log.warn("intro.confirm.getServices.fail", { error: e instanceof Error ? e.message : e });
    return NextResponse.json(
      { ok: false, correlationId, error: "payment verification is temporarily unavailable" },
      { status: 502 },
    );
  }

  // Book the class.
  try {
    await addClientToClass(mbCfg, log, {
      ClientId: clientId,
      ClassId: classId,
      ClientServiceId: purchasedClientServiceId,
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

  // Advance the Deal in the Trials pipeline. Soft-failure: log + continue.
  try {
    const deal = await findDealByCorrelationId(hsCfg, log, correlationId);
    if (deal) {
      await moveDealStage(hsCfg, log, deal.id, pipeline.stages.scheduled);
      log.info("intro.confirm.dealMoved", { dealId: deal.id, stage: pipeline.stages.scheduled });
    }
  } catch (e) {
    log.warn("intro.confirm.dealMove.fail", { error: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({ ok: true, correlationId, status: "confirmed" });
}
