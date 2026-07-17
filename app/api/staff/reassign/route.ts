import { NextResponse } from "next/server";
import {
  findContactByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  updateContact,
} from "@/lib/hubspot";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";
import { createLogger } from "@/lib/logger";
import { withLocalActionLock } from "@/lib/action-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/reassign?token=<signed-jwt> renders an explicit confirmation
 * page. POST performs the HubSpot mutation. Keeping writes off GET prevents
 * email-link scanners from changing request state before staff clicks.
 *
 * Flips the contact to `court16_booking_status=manual_review`. No MindBody
 * write. Staff completes the reassignment manually in Mindbody and records
 * the outcome in HubSpot; this app does not expose a nonexistent retry URL.
 */
export async function GET(req: Request) {
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

  return actionHtml(
    "Move this request to manual review?",
    "This will flag the request in HubSpot so staff can choose a different class in Mindbody.",
    "Move to manual review",
  );
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

  const result = await withLocalActionLock(
    `staff-action:${payload.correlationId}`,
    () => reassignBooking(payload),
  );
  if (!result.acquired) {
    return html("This request is already being updated. Wait a moment and refresh HubSpot.", 409);
  }
  return result.value;
}

async function reassignBooking(payload: ReturnType<typeof verifyToken>) {
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
    court16_failure_reason: "Staff reassign requested — complete enrollment in Mindbody and record the outcome in HubSpot.",
  });
  // Intentionally do NOT move the Deal stage here. Reassign means manual
  // review; the Contact status is the workflow trigger for staff follow-up.
  return html(
    `Flagged for manual review. Reassign the class in Mindbody, then record the final outcome in HubSpot. (correlation: ${payload.correlationId})`,
    200,
  );
}

function html(msg: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:20px}</style></head><body><h1>Court 16 staff</h1><p>${escapeHtml(msg)}</p></body></html>`;
  return htmlResponse(body, status);
}

function actionHtml(title: string, msg: string, buttonLabel: string): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:24px}p{line-height:1.5}button{border:2px solid #111;background:#ffd800;color:#111;border-radius:999px;padding:12px 20px;font:700 15px system-ui;cursor:pointer}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p><form method="post"><button type="submit">${escapeHtml(buttonLabel)}</button></form></body></html>`;
  return htmlResponse(body, 200);
}

function htmlResponse(body: string, status: number): Response {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
