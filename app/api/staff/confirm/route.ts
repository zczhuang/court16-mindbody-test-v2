import { NextResponse } from "next/server";
import {
  addClientToClass,
  loadConfigFromEnv,
  MindbodyError,
} from "@/lib/mindbody";
import {
  findContactByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  updateContact,
} from "@/lib/hubspot";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";
import { createLogger } from "@/lib/logger";
import { getLocationById } from "@/config/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET or POST /api/staff/confirm?token=<signed-jwt>
 *
 * Staff clicks the confirm link from the email. We verify the HMAC, find
 * the Contact by `court16_correlation_id` in HubSpot, reject if already
 * confirmed (single-use via status, not a separate token table), call
 * MindBody AddClientToClass, then flip `court16_booking_status=confirmed`
 * which triggers the parent-confirmation workflow in HubSpot.
 */
export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return html("Missing token", 400);

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch (e) {
    const reason = e instanceof InvalidTokenError ? e.reason : "unknown";
    return html(`Invalid token (${reason})`, 401);
  }
  if (payload.action !== "confirm") {
    return html(`Wrong token action: ${payload.action}`, 400);
  }

  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) {
    return html(
      "HubSpot is not configured on this deployment. Staff confirm cannot run without HUBSPOT_ACCESS_TOKEN / HUBSPOT_PORTAL_ID / HUBSPOT_TRIAL_FORM_GUID.",
      503,
    );
  }

  let mbCfg;
  try {
    mbCfg = loadConfigFromEnv();
  } catch (e) {
    return html(`Config error: ${e instanceof Error ? e.message : String(e)}`, 500);
  }

  let contact: Awaited<ReturnType<typeof findContactByCorrelationId>>;
  try {
    contact = await findContactByCorrelationId(hsCfg, log, payload.correlationId);
  } catch (e) {
    const msg = e instanceof HubspotError ? `HubSpot error (${e.status})` : "HubSpot lookup failed";
    return html(msg, 502);
  }
  if (!contact) {
    return html(`Booking not found for correlation ${payload.correlationId}`, 404);
  }

  if (contact.properties.court16_booking_status === "confirmed") {
    return html("This booking is already confirmed. Thank you.", 410);
  }

  // Per-location MindBody Site ID override
  const locationSlug = contact.properties.court16_location_slug;
  if (locationSlug) {
    const location = getLocationById(locationSlug);
    if (location) mbCfg = { ...mbCfg, siteId: String(location.siteId) };
  }

  const classId = contact.properties.court16_class_id
    ? Number(contact.properties.court16_class_id)
    : undefined;
  const clientId =
    contact.properties.court16_mindbody_child_id || contact.properties.court16_mindbody_parent_id;

  if (!classId || !clientId) {
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "failed",
      court16_failure_reason: "Missing court16_class_id or MindBody client ID on contact",
    });
    return html("Booking record is missing class or client — flagged as failed.", 422);
  }

  try {
    await addClientToClass(mbCfg, log, {
      ClientId: clientId,
      ClassId: classId,
    });
  } catch (e) {
    const serialized =
      e instanceof MindbodyError ? JSON.stringify(e.toJSON()) : e instanceof Error ? e.message : String(e);
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "failed",
      court16_failure_reason: `AddClientToClass: ${serialized}`.slice(0, 4000),
    });
    return html(`MindBody booking failed. Staff: check admin queue.`, 502);
  }

  await updateContact(hsCfg, log, contact.id, { court16_booking_status: "confirmed" });
  return html(
    `Confirmed. Parent will receive a confirmation email shortly. (correlation: ${payload.correlationId})`,
    200,
  );
}

function html(msg: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:20px}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:12px}</style></head><body><h1>Court 16 staff</h1><p>${escapeHtml(msg)}</p></body></html>`;
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html" } });
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
