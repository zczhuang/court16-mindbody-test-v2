import { NextResponse } from "next/server";
import {
  findContactByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  updateContact,
} from "@/lib/hubspot";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET or POST /api/staff/reassign?token=<signed-jwt>
 *
 * Flips the contact to `court16_booking_status=manual_review`. No MindBody
 * write. Staff reassigns the class by hand in MindBody, then optionally
 * clicks the admin retry URL with a new class_id patched in.
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
  if (payload.action !== "reassign") {
    return html(`Wrong token action: ${payload.action}`, 400);
  }

  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) return html("HubSpot is not configured on this deployment.", 503);

  let contact: Awaited<ReturnType<typeof findContactByCorrelationId>>;
  try {
    contact = await findContactByCorrelationId(hsCfg, log, payload.correlationId);
  } catch (e) {
    const msg = e instanceof HubspotError ? `HubSpot error (${e.status})` : "HubSpot lookup failed";
    return html(msg, 502);
  }
  if (!contact) return html(`Booking not found for correlation ${payload.correlationId}`, 404);
  if (contact.properties.court16_booking_status === "confirmed") {
    return html("This booking is already confirmed and cannot be reassigned here.", 410);
  }

  await updateContact(hsCfg, log, contact.id, {
    court16_booking_status: "manual_review",
    court16_failure_reason: "Staff reassigned — manually place in MindBody then hit admin retry.",
  });
  return html(
    `Flagged for manual review. Reassign the class in MindBody, then visit the admin retry URL. (correlation: ${payload.correlationId})`,
    200,
  );
}

function html(msg: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:20px}</style></head><body><h1>Court 16 staff</h1><p>${escapeHtml(msg)}</p></body></html>`;
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html" } });
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
