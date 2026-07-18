import { NextResponse } from "next/server";
import {
  findDealByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  updateDealProperties,
} from "@/lib/hubspot";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";
import { createLogger } from "@/lib/logger";
import {
  DistributedActionLockError,
  withDistributedActionLock,
} from "@/lib/distributed-action-lock";
import {
  buildBookingDealProperties,
  parseBookingDealLedger,
} from "@/lib/hubspot-deal-ledger";
import { bookingLedgerMatchesStaffToken } from "@/lib/mindbody-booking-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/reassign?token=<signed-jwt> renders an explicit confirmation
 * page. POST performs the HubSpot mutation. Keeping writes off GET prevents
 * email-link scanners from changing request state before staff clicks.
 *
 * Moves the request-scoped Deal to `manual_review` without changing its
 * Mindbody provenance or active-parent key. Notification is owned by Deal-based
 * HubSpot workflows; this route performs no Contact or Mindbody write.
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
    "This will flag the Deal in HubSpot so staff can choose a different class in Mindbody. Any notification depends on the Deal-based workflow being enabled.",
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

  const actionLog = createLogger(payload.correlationId);
  let result;
  try {
    result = await withDistributedActionLock(
      `staff-action:${payload.correlationId}`,
      () => reassignBooking(payload),
      {
        onReleaseError: (error) =>
          actionLog.error("staff.reassign.distributed-lock.release-failed", {
            code: error instanceof DistributedActionLockError ? error.code : "unknown",
          }),
      },
    );
  } catch (error) {
    actionLog.error("staff.reassign.distributed-lock.acquire-failed", {
      code: error instanceof DistributedActionLockError ? error.code : "action_failed",
    });
    return html(
      error instanceof DistributedActionLockError
        ? "The booking lock is temporarily unavailable. No changes were made; try again shortly."
        : "The booking action failed unexpectedly. Review the Deal before retrying.",
      503,
    );
  }
  if (!result.acquired) {
    return html("This request is already being updated. Wait a moment and refresh HubSpot.", 409);
  }
  return result.value;
}

async function reassignBooking(payload: ReturnType<typeof verifyToken>) {
  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) return html("HubSpot is not configured on this deployment.", 503);
  if (process.env.HUBSPOT_DEAL_LEDGER_ENABLED !== "true") {
    return html("The Deal booking ledger is not enabled on this deployment.", 503);
  }

  let deal: Awaited<ReturnType<typeof findDealByCorrelationId>>;
  try {
    deal = await findDealByCorrelationId(hsCfg, log, payload.correlationId, {
      includeBookingLedger: true,
    });
  } catch (e) {
    const msg = e instanceof HubspotError ? `HubSpot error (${e.status})` : "HubSpot lookup failed";
    return html(msg, 502);
  }
  if (!deal) return html(`Booking not found for correlation ${payload.correlationId}`, 404);

  const parsed = parseBookingDealLedger(deal.properties);
  const claimsLedgerV1 = deal.properties.court16_booking_ledger_version === "1";
  if (claimsLedgerV1 && !parsed.ok) {
    return html("This Deal ledger is incomplete. No state was changed.", 409);
  }
  const ledger = parsed.ok ? parsed.value : null;
  if (!ledger) {
    return html("This request does not have a verified Deal ledger. Migrate or review it manually.", 409);
  }
  if (!bookingLedgerMatchesStaffToken(ledger, payload.correlationId)) {
    return html("The signed staff link does not match this Deal's booking identity. No state was changed.", 409);
  }
  if (deal.associatedContactIds.length !== 1 || !deal.associatedContactIds[0]?.trim()) {
    return html("This Deal must have exactly one associated Contact. No state was changed.", 409);
  }
  if (ledger.bookingStatus === "confirmed") {
    return html("This booking is already confirmed and cannot be reassigned here.", 410);
  }
  if (ledger.bookingStatus === "denied") return html("This booking has already been denied.", 410);

  const failureReason =
    "Staff reassign requested — complete enrollment in Mindbody and record the outcome in HubSpot.";
  try {
    await updateDealProperties(hsCfg, log, deal.id, {
      ...buildBookingDealProperties({
        ...ledger,
        bookingStatus: "manual_review",
        failureReason,
      }),
      court16_failure_reason: failureReason,
    });
  } catch (e) {
    log.warn("staff.reassign.deal.fail", { error: e instanceof Error ? e.message : String(e) });
    return html("HubSpot could not save the Deal state. No state was changed.", 502);
  }

  // Intentionally do not move the Deal stage. Reassign means manual review.
  return html(
    `Flagged on the Deal for manual review. Reassign the class in Mindbody, then record the final outcome in HubSpot. No notification is guaranteed while the Deal-based workflow is off. (correlation: ${payload.correlationId})`,
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
