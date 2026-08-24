import { NextResponse } from "next/server";
import {
  findDealByCorrelationId,
  getContactById,
  HubspotError,
  loadHubspotConfig,
  updateContact,
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
import {
  bookingLedgerMatchesStaffToken,
  hasUnsafeMindbodyStateForDeny,
} from "@/lib/mindbody-booking-evidence";

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
 * Single-use and notification state are enforced by the request-scoped Deal.
 * Parent notification is owned by a Deal-based HubSpot workflow; this route
 * does not claim that an email was sent while that workflow is disabled.
 *
 * On submit:
 *  1. Mark the Deal: denial_reason + denial_note (does NOT move stage —
 *     Court 16's existing per-location pipelines don't have a "Denied"
 *     stage, and adding one would fragment Ibtissam's existing data).
 *  2. Release the Deal's active-parent key because denial is terminal.
 *  3. Mindbody booking cancellation remains manual. Confirm now persists the
 *     Visit ID on the Deal, but deny intentionally performs no Mindbody write.
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
  if (payload.action !== "deny") return html(`Wrong token action: ${payload.action}`, 400);
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

  const actionLog = createLogger(payload.correlationId);
  let result;
  try {
    result = await withDistributedActionLock(
      `staff-action:${payload.correlationId}`,
      () => denyBooking(payload, reason, note),
      {
        onReleaseError: (error) =>
          actionLog.error("staff.deny.distributed-lock.release-failed", {
            code: error instanceof DistributedActionLockError ? error.code : "unknown",
          }),
      },
    );
  } catch (error) {
    actionLog.error("staff.deny.distributed-lock.acquire-failed", {
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
    return html("This request is already being processed. Wait a moment and refresh HubSpot.", 409);
  }
  return result.value;
}

async function denyBooking(
  payload: ReturnType<typeof verifyToken>,
  reason: string,
  note: string,
) {
  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) return html("HubSpot is not configured on this deployment.", 503);
  if (process.env.HUBSPOT_DEAL_LEDGER_ENABLED !== "true") {
    return html("The Deal booking ledger is not enabled on this deployment.", 503);
  }

  // 1. Find the authoritative request-scoped Deal.
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
    return html(
      "This booking is already confirmed. Cancel it in MindBody admin instead of denying.",
      410,
    );
  }
  if (ledger.bookingStatus === "denied") {
    return html("This booking has already been denied.", 410);
  }
  if (hasUnsafeMindbodyStateForDeny(ledger)) {
    const familyUnsettled =
      ledger.intent === "kid_trial" &&
      ledger.familyProvisioningStatus !== "not_started" &&
      ledger.familyProvisioningStatus !== "child_created";
    return html(
      familyUnsettled
        ? "This request's Mindbody family records are in an unresolved state (a parent or child create may have partially run). Reconcile the recorded client IDs in Mindbody and on the Deal before denying; no state was changed."
        : "This booking has a started or unresolved Mindbody checkout/enrollment. Reconcile the enrollment before denying it; no state was changed.",
      409,
    );
  }

  // 2. Persist the canonical Deal transition. A Deal-based workflow can branch
  //    on this failure reason when notification automation is enabled.
  const failureReason =
    REASONS.find((r) => r.value === reason)!.label + (note ? ` — ${note}` : "");
  const dealFailureReason = `Denied: ${failureReason}`.slice(0, 4000);
  try {
    await updateDealProperties(hsCfg, log, deal.id, {
      ...buildBookingDealProperties({
        ...ledger,
        activeParentKey: undefined,
        bookingStatus: "denied",
        failureReason: dealFailureReason,
      }),
      court16_active_parent_key: "",
      denial_reason: reason,
      denial_note: reason === "other" ? note : undefined,
      court16_failure_reason: dealFailureReason,
    });
    log.info("staff.deny.dealAnnotated", { dealId: deal.id, reason });
  } catch (e) {
    log.warn("staff.deny.deal.fail", { error: e instanceof Error ? e.message : String(e) });
    return html("HubSpot could not save the denial on the Deal. No state was changed.", 502);
  }

  // 3. Legacy Contact mirror hygiene. Ledger-v1 code never updates the old
  //    Contact-level court16_booking_status, but intake still fails closed
  //    into manual_review whenever that mirror holds an active value — so a
  //    stale pre-ledger mirror would keep fencing every future booking from
  //    this email. Denial is terminal for this request; clear a stale-active
  //    mirror the same way the legacy deny flow did ("failed"). Best-effort:
  //    a failure here never undoes the recorded denial.
  let legacyMirrorCleared = false;
  // pending_payment is deliberately excluded: it belongs to the legacy adult
  // payment-return flow, which still reads the Contact mirror. Clearing it
  // here could break a live adult intro that shares the parent's email; that
  // rare cross-flow conflict stays in manual review instead.
  const LEGACY_ACTIVE_CONTACT_STATUSES = new Set([
    "pending_staff",
    "manual_review",
    "duplicate_email_softwall",
    "pending_staff_assist",
  ]);
  try {
    const contactId = deal.associatedContactIds[0]!;
    const contact = await getContactById(hsCfg, log, contactId);
    const mirrorStatus = contact?.properties?.court16_booking_status;
    const mirrorIntent = contact?.properties?.court16_intent;
    const mirrorIsKidTrial = !mirrorIntent || mirrorIntent === "kid_trial";
    if (mirrorStatus && mirrorIsKidTrial && LEGACY_ACTIVE_CONTACT_STATUSES.has(mirrorStatus)) {
      await updateContact(hsCfg, log, contactId, {
        court16_booking_status: "failed",
        court16_failure_reason: `Legacy mirror cleared by staff denial of ${payload.correlationId}: ${dealFailureReason}`.slice(
          0,
          4000,
        ),
      });
      legacyMirrorCleared = true;
      log.info("staff.deny.legacy-mirror-cleared", { contactId, previousStatus: mirrorStatus });
    }
  } catch (e) {
    log.warn("staff.deny.legacy-mirror.fail", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Mindbody cancellation remains manual. The Deal now preserves the exact
  //    Visit ID for a future remove-client implementation, but this action
  //    intentionally performs no Mindbody write.
  log.info("staff.deny.done", { correlationId: payload.correlationId, reason });

  return html(
    `Denied on the HubSpot Deal. Parent notification requires the Deal-based denial workflow; no email is guaranteed while it is off. ` +
      `Reason: ${REASONS.find((r) => r.value === reason)!.label}. ` +
      (legacyMirrorCleared
        ? `The Contact's stale legacy booking status was also marked failed so future requests from this parent are not auto-held. `
        : ``) +
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
<p class="sub">Pick a reason. This records the denial on the HubSpot Deal. Parent notification requires the Deal-based workflow to be enabled.</p>
<form method="POST">
  <fieldset>
    <legend>Reason</legend>
    ${radios}
  </fieldset>
  <label style="display:block;margin-top:16px;font-size:13px;color:#666">
    Note (required for "Other"):
    <textarea name="note" placeholder="Anything staff should record about why."></textarea>
  </label>
  <button type="submit">Deny request</button>
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
