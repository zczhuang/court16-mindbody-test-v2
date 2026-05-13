import { NextResponse } from "next/server";
import {
  findContactByCorrelationId,
  findDealByCorrelationId,
  HubspotError,
  loadHubspotConfig,
  moveDealStage,
  updateContact,
} from "@/lib/hubspot";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS: { value: string; label: string }[] = [
  { value: "wrong_age_band", label: "Wrong age band" },
  { value: "no_availability", label: "No availability for this class" },
  { value: "parent_cancelled", label: "Parent cancelled" },
  { value: "duplicate_booking", label: "Duplicate booking" },
  { value: "other", label: "Other (use the note below)" },
];

/**
 * GET /api/staff/deny?token=…   → render a 5-radio-button form
 * POST /api/staff/deny           → execute the denial
 *
 * Single-use enforced via the Contact's status field (same pattern as
 * confirm/reassign). Once denied, the Contact's `court16_booking_status`
 * is `failed` — repeat clicks return 410.
 *
 * On submit:
 *  1. Mark the Deal: denial_reason + denial_note (does NOT move stage —
 *     Court 16's existing per-location pipelines don't have a "Denied"
 *     stage, and adding one would fragment Ibtissam's existing data).
 *  2. Flip the Contact's `court16_booking_status` → "failed" so the
 *     existing failure-notification workflow can fire.
 *  3. MindBody booking-cancellation is documented as a TODO; the
 *     Public API `Class/RemoveClientFromClass` endpoint requires a
 *     visit-id we don't currently capture from AddClientToClass. Staff
 *     manually removes the client in MindBody admin for now.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return html("Missing token", 400);
  try {
    verifyToken(token);
  } catch (e) {
    const reason = e instanceof InvalidTokenError ? e.reason : "unknown";
    return html(`Invalid token (${reason})`, 401);
  }
  return renderForm(token);
}

export async function POST(req: Request) {
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
  if (payload.action !== "deny") {
    return html(`Wrong token action: ${payload.action}`, 400);
  }

  const form = await req.formData();
  const reason = String(form.get("reason") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();

  if (!REASONS.find((r) => r.value === reason)) {
    return html("Pick a denial reason from the dropdown.", 400);
  }
  if (reason === "other" && note.length === 0) {
    return html("'Other' requires a note describing why.", 400);
  }

  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) return html("HubSpot is not configured on this deployment.", 503);

  // 1. Find Contact — needed to flip its status
  let contact: Awaited<ReturnType<typeof findContactByCorrelationId>>;
  try {
    contact = await findContactByCorrelationId(hsCfg, log, payload.correlationId);
  } catch (e) {
    const msg = e instanceof HubspotError ? `HubSpot error (${e.status})` : "HubSpot lookup failed";
    return html(msg, 502);
  }
  if (!contact) return html(`Booking not found for correlation ${payload.correlationId}`, 404);
  if (contact.properties.court16_booking_status === "confirmed") {
    return html(
      "This booking is already confirmed. Cancel it in MindBody admin instead of denying.",
      410,
    );
  }
  if (contact.properties.court16_booking_status === "failed") {
    return html("This booking has already been denied.", 410);
  }

  // 2. Patch the Deal (find by correlation, set denial properties)
  try {
    const deal = await findDealByCorrelationId(hsCfg, log, payload.correlationId);
    if (deal) {
      await moveDealStage(hsCfg, log, deal.id, deal.properties.dealstage ?? "", {
        denial_reason: reason,
        denial_note: reason === "other" ? note : undefined,
      });
      log.info("staff.deny.dealAnnotated", { dealId: deal.id, reason });
    }
  } catch (e) {
    log.warn("staff.deny.deal.fail", { error: e instanceof Error ? e.message : String(e) });
  }

  // 3. Flip the Contact
  const failureReason =
    REASONS.find((r) => r.value === reason)!.label + (note ? ` — ${note}` : "");
  await updateContact(hsCfg, log, contact.id, {
    court16_booking_status: "failed",
    court16_failure_reason: `Denied: ${failureReason}`.slice(0, 4000),
  });

  // 4. MindBody cancellation — TODO: requires the visit-id from the
  //    AddClientToClass response, which we don't currently persist.
  //    Track 2 enhancement. For now staff cancels in MindBody admin.
  log.info("staff.deny.done", { correlationId: payload.correlationId, reason });

  return html(
    `Denied. Parent will be notified via the denial workflow. ` +
      `Reason: ${REASONS.find((r) => r.value === reason)!.label}. ` +
      `(correlation: ${payload.correlationId})`,
    200,
  );
}

function renderForm(token: string): Response {
  const radios = REASONS.map(
    (r) =>
      `<label style="display:block;padding:8px 0;cursor:pointer">
        <input type="radio" name="reason" value="${r.value}" required style="margin-right:8px"> ${escapeHtml(r.label)}
      </label>`,
  ).join("");

  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff — Deny</title><style>
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 560px; margin: 48px auto; padding: 0 24px; color: #222; line-height: 1.5; }
h1 { font-size: 22px; margin: 0 0 6px; }
.sub { color: #666; font-size: 14px; margin-bottom: 24px; }
fieldset { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; }
textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; font-size: 14px; margin-top: 8px; box-sizing: border-box; }
button { background: #b8301a; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 16px; font-size: 14px; }
button:hover { background: #94250e; }
.cancel { color: #666; text-decoration: none; margin-left: 12px; font-size: 13px; }
</style></head><body>
<h1>Deny trial booking</h1>
<p class="sub">Pick a reason. The parent will be notified via the denial workflow.</p>
<form method="POST">
  <fieldset>
    <legend>Reason</legend>
    ${radios}
  </fieldset>
  <label style="display:block;margin-top:16px;font-size:13px;color:#666">
    Note (required for "Other"):
    <textarea name="note" placeholder="Anything the parent should know about why."></textarea>
  </label>
  <button type="submit">Deny + send email</button>
  <a class="cancel" href="javascript:window.close()">Cancel</a>
</form>
</body></html>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function html(msg: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:20px}</style></head><body><h1>Court 16 staff</h1><p>${escapeHtml(msg)}</p></body></html>`;
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html" } });
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
