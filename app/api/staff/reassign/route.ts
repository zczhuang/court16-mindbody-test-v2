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
  type ParsedBookingDealLedger,
} from "@/lib/hubspot-deal-ledger";
import {
  bookingLedgerMatchesStaffToken,
  findExactActiveClientVisit,
  requiresReadOnlyEnrollmentReconciliation,
} from "@/lib/mindbody-booking-evidence";
import {
  addClientToClass,
  authedMindbodyGet,
  checkoutTrialBooking,
  getClientVisits,
  isAlreadyBookedError,
  isClassRequiresPaymentError,
  loadConfigFromEnv,
  MindbodyError,
  removeClientsFromClasses,
  type ClientVisit,
  type MindbodyConfig,
} from "@/lib/mindbody";
import { getMindbodyWriteGuard } from "@/lib/mindbody-write-guard";
import { getLocationById, type Location } from "@/config/locations";
import {
  maxCalendarDateStr,
  todayStrInTz,
  TRIAL_CONFIG,
  type LocationTrialConfig,
} from "@/config/trial-config";
import { formatClassDayTime, siteLocalToUtcIso } from "@/lib/class-utils";
import {
  encodeSlotValue,
  parseSlotValue,
  selectReassignSlots,
  siteLocalNowIso,
  type ReassignSlot,
} from "@/lib/staff-reassign";
import {
  resolveMindbodyPaginationPage,
  type MindbodyPaginationMetadata,
} from "@/lib/mindbody-pagination";
import type { MindBodyClass } from "@/lib/trial-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/reassign?token=<signed-token> renders a picker of this club's
 * bookable trial slots. POST performs the move. Keeping writes off GET prevents
 * email-link scanners from changing a booking before staff clicks.
 *
 * Two very different jobs share the link, decided by the Deal's booking status:
 *
 *   • Not yet confirmed — nobody is enrolled in Mindbody yet, so the move is
 *     purely a repoint of the Deal's class fields. Confirm then enrols into the
 *     new slot. No Mindbody write happens here at all.
 *   • Already confirmed — a live visit exists. The move adds the child to the
 *     new class FIRST and only removes the old booking once the new one reads
 *     back as an active visit. A failure therefore always leaves the child on a
 *     class, never stranded between two.
 *
 * Notification is owned by Deal-based HubSpot workflows; this route performs no
 * Contact write.
 */

const CLASS_PAGE_LIMIT = 200;
const MAX_CLASS_PAGES = 20;

export async function GET(req: Request) {
  const gate = authorize(req);
  if (!gate.ok) return gate.response;

  const context = await loadReassignContext(gate.payload);
  if (!context.ok) return context.response;

  let slots: ReassignSlot[];
  try {
    slots = await readBookableSlots(context.value);
  } catch (e) {
    context.value.log.error("staff.reassign.slots.fail", { error: serializeError(e) });
    return html(
      "Mindbody would not return this club's upcoming trial classes. Nothing was changed — try again shortly.",
      502,
    );
  }

  return pickerHtml(context.value, slots);
}

export async function POST(req: Request) {
  const gate = authorize(req);
  if (!gate.ok) return gate.response;
  const { payload } = gate;
  const actionLog = createLogger(payload.correlationId);

  let selectedSlot: unknown;
  try {
    selectedSlot = (await req.formData()).get("slot");
  } catch {
    // A body that will not parse carries no selection, which is the same
    // situation for staff as submitting the form without picking a slot.
    selectedSlot = undefined;
  }
  const selection = parseSlotValue(selectedSlot);
  if (!selection.ok) {
    return html(
      selection.reason === "missing"
        ? "Choose a class before submitting. No state was changed."
        : "That class selection was not readable. Reopen the link and choose again. No state was changed.",
      400,
    );
  }

  let result;
  try {
    result = await withDistributedActionLock(
      `staff-action:${payload.correlationId}`,
      () => reassignBooking(payload, selection),
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

/** Token checks shared by both verbs, before any HubSpot or Mindbody call. */
function authorize(
  req: Request,
): { ok: true; payload: ReturnType<typeof verifyToken> } | { ok: false; response: Response } {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return { ok: false, response: html("Missing token", 400) };

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch (e) {
    const reason = e instanceof InvalidTokenError ? e.reason : "unknown";
    return { ok: false, response: html(`Invalid token (${reason})`, 401) };
  }
  if (payload.action !== "reassign") {
    return { ok: false, response: html(`Wrong token action: ${payload.action}`, 400) };
  }
  return { ok: true, payload };
}

interface ReassignContext {
  log: ReturnType<typeof createLogger>;
  hsCfg: NonNullable<ReturnType<typeof loadHubspotConfig>>;
  mbCfg: MindbodyConfig;
  dealId: string;
  ledger: ParsedBookingDealLedger;
  location: Location;
  trialConfig: LocationTrialConfig;
  programId: number;
  correlationId: string;
}

type ContextResult = { ok: true; value: ReassignContext } | { ok: false; response: Response };

/**
 * Every guard that must hold before a reassign is even offered, in the same
 * order for GET and POST — so the picker is never rendered for a request the
 * POST would refuse.
 */
async function loadReassignContext(
  payload: ReturnType<typeof verifyToken>,
): Promise<ContextResult> {
  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) return { ok: false, response: html("HubSpot is not configured on this deployment.", 503) };
  if (process.env.HUBSPOT_DEAL_LEDGER_ENABLED !== "true") {
    return { ok: false, response: html("The Deal booking ledger is not enabled on this deployment.", 503) };
  }

  let mbCfg: MindbodyConfig;
  try {
    mbCfg = loadConfigFromEnv();
  } catch (e) {
    return {
      ok: false,
      response: html(`Config error: ${e instanceof Error ? e.message : String(e)}`, 500),
    };
  }

  let deal: Awaited<ReturnType<typeof findDealByCorrelationId>>;
  try {
    deal = await findDealByCorrelationId(hsCfg, log, payload.correlationId, {
      includeBookingLedger: true,
    });
  } catch (e) {
    const msg = e instanceof HubspotError ? `HubSpot error (${e.status})` : "HubSpot lookup failed";
    return { ok: false, response: html(msg, 502) };
  }
  if (!deal) {
    return {
      ok: false,
      response: html(`Booking not found for correlation ${payload.correlationId}`, 404),
    };
  }

  const parsed = parseBookingDealLedger(deal.properties);
  const claimsLedgerV1 = deal.properties.court16_booking_ledger_version === "1";
  if (claimsLedgerV1 && !parsed.ok) {
    return { ok: false, response: html("This Deal ledger is incomplete. No state was changed.", 409) };
  }
  const ledger = parsed.ok ? parsed.value : null;
  if (!ledger) {
    return {
      ok: false,
      response: html(
        "This request does not have a verified Deal ledger. Migrate or review it manually.",
        409,
      ),
    };
  }
  if (!bookingLedgerMatchesStaffToken(ledger, payload.correlationId)) {
    return {
      ok: false,
      response: html(
        "The signed staff link does not match this Deal's booking identity. No state was changed.",
        409,
      ),
    };
  }
  if (deal.associatedContactIds.length !== 1 || !deal.associatedContactIds[0]?.trim()) {
    return {
      ok: false,
      response: html("This Deal must have exactly one associated Contact. No state was changed.", 409),
    };
  }
  if (ledger.bookingStatus === "denied") {
    return { ok: false, response: html("This booking has already been denied.", 410) };
  }
  if (ledger.bookingStatus === "intake_started") {
    return {
      ok: false,
      response: html(
        "This request is still being created and cannot be moved yet. Refresh the Deal in a moment.",
        409,
      ),
    };
  }
  if (ledger.intent !== "kid_trial") {
    return {
      ok: false,
      response: html("Only kids trial requests can be reassigned from this link.", 409),
    };
  }
  // An unconfirmed request whose Mindbody state is unsettled may already own a
  // visit the Deal cannot account for. Repointing the class fields would then
  // silently orphan a real enrollment, so send it through Confirm — which owns
  // reconciliation — before any move.
  if (
    ledger.bookingStatus !== "confirmed" &&
    requiresReadOnlyEnrollmentReconciliation(ledger)
  ) {
    return {
      ok: false,
      response: html(
        "This request has an unresolved Mindbody enrollment. Use the Confirm link first so it reconciles, then reassign. No state was changed.",
        409,
      ),
    };
  }

  const location = getLocationById(ledger.locationSlug);
  const trialConfig = location ? TRIAL_CONFIG[location.id] : undefined;
  const programId = location?.kidTrialProgramId;
  if (!location || !trialConfig?.trialServiceId || !programId) {
    return {
      ok: false,
      response: html("This club is not configured for trial scheduling on this deployment.", 409),
    };
  }
  if (String(location.siteId) !== ledger.mindbodySiteId) {
    return {
      ok: false,
      response: html(
        "The Deal's Mindbody site does not match the club it names. No state was changed; review it manually.",
        409,
      ),
    };
  }

  return {
    ok: true,
    value: {
      log,
      hsCfg,
      mbCfg: { ...mbCfg, siteId: String(location.siteId) },
      dealId: deal.id,
      ledger,
      location,
      trialConfig,
      programId,
      correlationId: payload.correlationId,
    },
  };
}

/**
 * Pull the club's dedicated trial Program across the whole booking window and
 * narrow it to slots staff may actually move a child into. Trial Programs are
 * often hidden from the public consumer view, hence staff mode.
 */
async function readBookableSlots(ctx: ReassignContext): Promise<ReassignSlot[]> {
  const startDate = todayStrInTz(ctx.location.timezone);
  const endDate = maxCalendarDateStr(ctx.location.timezone);
  const classes: MindBodyClass[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_CLASS_PAGES; page++) {
    const result = await authedMindbodyGet<{
      Classes?: MindBodyClass[];
      PaginationResponse?: MindbodyPaginationMetadata;
    }>(ctx.log, {
      siteIdOverride: ctx.mbCfg.siteId,
      path: "/class/classes",
      query: {
        StartDateTime: `${startDate}T00:00:00`,
        EndDateTime: `${endDate}T23:59:59`,
        ProgramIds: String(ctx.programId),
        Limit: CLASS_PAGE_LIMIT,
        Offset: offset,
      },
      staffMode: true,
    });
    const pageClasses = result.Classes ?? [];
    classes.push(...pageClasses);
    const decision = resolveMindbodyPaginationPage({
      currentOffset: offset,
      requestedLimit: CLASS_PAGE_LIMIT,
      pageLength: pageClasses.length,
      pagination: result.PaginationResponse,
    });
    if (decision.complete) break;
    offset = decision.nextOffset;
    if (page === MAX_CLASS_PAGES - 1) {
      throw new Error(`Mindbody pagination exceeded its safety cap for Program ${ctx.programId}`);
    }
  }

  return selectReassignSlots(classes, {
    programId: ctx.programId,
    siteId: ctx.location.siteId,
    currentClassId: Number(ctx.ledger.classId) || undefined,
    nowSiteLocal: siteLocalNowIso(ctx.location.timezone),
  });
}

async function reassignBooking(
  payload: ReturnType<typeof verifyToken>,
  selection: { classId: number; classScheduleId: number },
): Promise<Response> {
  const context = await loadReassignContext(payload);
  if (!context.ok) return context.response;
  const ctx = context.value;

  // Re-read the target through the same rules the picker used. A stale tab or a
  // hand-crafted pair therefore selects nothing rather than a wrong class.
  let slots: ReassignSlot[];
  try {
    slots = await readBookableSlots(ctx);
  } catch (e) {
    ctx.log.error("staff.reassign.slots.fail", { error: serializeError(e) });
    return html(
      "Mindbody would not confirm that class is still bookable. No state was changed.",
      502,
    );
  }
  const target = slots.find(
    (slot) =>
      slot.classId === selection.classId && slot.classScheduleId === selection.classScheduleId,
  );
  if (!target) {
    return html(
      "That class is no longer bookable — it may have filled or been cancelled. No state was changed; reopen the link and choose another.",
      409,
    );
  }

  return ctx.ledger.bookingStatus === "confirmed"
    ? moveConfirmedBooking(ctx, target)
    : repointPendingBooking(ctx, target);
}

/** Class fields every successful reassign writes, whatever the prior state. */
function classPatch(ctx: ReassignContext, target: ReassignSlot) {
  return {
    classId: target.classId,
    classScheduleId: target.classScheduleId,
    className: target.className,
    classDayTime: formatClassDayTime(target.startDateTime, ctx.location.timezone),
    coachName: target.coachName || ctx.ledger.coachName,
  };
}

/** `class_date` is a HubSpot datetime (epoch ms UTC); the reminder workflow reads it. */
function classDateProperty(ctx: ReassignContext, target: ReassignSlot): string | undefined {
  const ms = Date.parse(siteLocalToUtcIso(target.startDateTime, ctx.location.timezone));
  return Number.isFinite(ms) ? String(ms) : undefined;
}

/**
 * Nothing is enrolled yet, so the move is a Deal edit and nothing else. The
 * request returns to `pending_staff` because that is now exactly true: a normal
 * pending request, on a different slot, that Confirm will enrol.
 */
async function repointPendingBooking(
  ctx: ReassignContext,
  target: ReassignSlot,
): Promise<Response> {
  const patch = classPatch(ctx, target);
  try {
    await updateDealProperties(ctx.hsCfg, ctx.log, ctx.dealId, {
      ...buildBookingDealProperties({
        ...ctx.ledger,
        ...patch,
        bookingStatus: "pending_staff",
        failureReason: undefined,
      }),
      // stripUndefined drops undefined, so an earlier reason has to be cleared
      // explicitly or it would outlive the state it described.
      court16_failure_reason: "",
      class_date: classDateProperty(ctx, target),
    });
  } catch (e) {
    ctx.log.warn("staff.reassign.repoint.fail", { error: serializeError(e) });
    return html("HubSpot could not save the new class. No state was changed.", 502);
  }
  ctx.log.info("staff.reassign.repointed", {
    fromClassId: ctx.ledger.classId ?? null,
    toClassId: target.classId,
  });
  return html(
    `Moved to ${patch.classDayTime || target.startDateTime} (${target.className}). Nobody was enrolled in Mindbody yet, so nothing needed to change there — use Confirm to book this new slot.`,
    200,
  );
}

/**
 * A live visit exists, so this is a real Mindbody move. Order matters: add to
 * the new class, prove it, and only then remove the old booking. If any step
 * fails the child keeps their original class and the Deal says so.
 */
async function moveConfirmedBooking(
  ctx: ReassignContext,
  target: ReassignSlot,
): Promise<Response> {
  const writeGuard = getMindbodyWriteGuard(ctx.mbCfg.siteId);
  if (!writeGuard.allowed) {
    ctx.log.warn("staff.reassign.mindbody-writes.blocked", {
      locationSlug: ctx.location.id,
      siteId: ctx.mbCfg.siteId,
      reason: writeGuard.reason,
    });
    return html(
      "Mindbody writes are not authorized for this club on this deployment. No state was changed.",
      503,
    );
  }

  const clientId = ctx.ledger.mindbodyChildId;
  const fromClassId = positiveInteger(ctx.ledger.classId);
  const mindbodyLocationId = positiveInteger(ctx.ledger.mindbodyLocationId);
  if (!clientId || !fromClassId || !mindbodyLocationId) {
    return html(
      "This Deal is missing the child, class, or Mindbody location ID needed to move a live booking. No state was changed.",
      409,
    );
  }

  const patch = classPatch(ctx, target);
  const fromLabel = ctx.ledger.classDayTime || `class ${fromClassId}`;
  const toLabel = patch.classDayTime || target.startDateTime;

  // Write-ahead marker. If this attempt dies mid-move the Deal already says a
  // Mindbody mutation was in flight, which is what staff need to know.
  try {
    await updateDealProperties(ctx.hsCfg, ctx.log, ctx.dealId, {
      ...buildBookingDealProperties({
        ...ctx.ledger,
        bookingStatus: "manual_review",
        mindbodyMutationStatus: "add_to_class_started",
        mindbodyMutationStartedAt: new Date(),
        failureReason: `Staff reassign in progress: moving from ${fromLabel} to ${toLabel}.`,
      }),
    });
  } catch (e) {
    ctx.log.warn("staff.reassign.marker.fail", { error: serializeError(e) });
    return html(
      "HubSpot could not record the start of this move, so nothing was attempted in Mindbody. No state was changed.",
      502,
    );
  }

  const criteria = {
    clientId,
    classId: target.classId,
    siteId: ctx.location.siteId,
    locationId: mindbodyLocationId,
  };
  let visit: ClientVisit | undefined;
  let saleId: number | undefined;

  try {
    const added = await addClientToClass(ctx.mbCfg, ctx.log, {
      ClientId: clientId,
      ClassId: target.classId,
    });
    if (added.Visit) visit = findExactActiveClientVisit([added.Visit], criteria);
  } catch (e) {
    if (isAlreadyBookedError(e)) {
      ctx.log.info("staff.reassign.add.already-booked", { clientId, classId: target.classId });
    } else if (isClassRequiresPaymentError(e)) {
      // The original credit is still bound to the old class until it is
      // released, so a paid-Program move needs its own $0 comp. Checkout both
      // grants the credit and books the class in one call.
      try {
        const checkout = await checkoutTrialBooking(ctx.mbCfg, ctx.log, {
          ClientId: clientId,
          ServiceId: ctx.trialConfig.trialServiceId!,
          ClassId: target.classId,
          LocationId: mindbodyLocationId,
          CorrelationId: ctx.correlationId,
        });
        saleId = checkout.saleId;
        if (checkout.visit) visit = findExactActiveClientVisit([checkout.visit], criteria);
      } catch (checkoutError) {
        return failMove(
          ctx,
          `Mindbody would not book ${toLabel}: ${serializeError(checkoutError)}. Nothing was removed — the child is still booked into ${fromLabel}.`,
        );
      }
    } else {
      return failMove(
        ctx,
        `Mindbody would not book ${toLabel}: ${serializeError(e)}. Nothing was removed — the child is still booked into ${fromLabel}.`,
      );
    }
  }

  if (!visit) {
    try {
      visit = await readActiveVisit(ctx, criteria, visitWindow(target.startDateTime));
    } catch (e) {
      ctx.log.warn("staff.reassign.visit-readback.fail", { error: serializeError(e) });
    }
  }
  if (!positiveInteger(visit?.Id)) {
    return failMove(
      ctx,
      `Mindbody did not report an active booking in ${toLabel}. Nothing was removed — the child is still booked into ${fromLabel}. Check Mindbody before retrying.`,
    );
  }

  // Only now is it safe to release the old spot.
  let removed = true;
  try {
    await removeClientsFromClasses(ctx.mbCfg, ctx.log, {
      ClientId: clientId,
      ClassId: fromClassId,
    });
  } catch (e) {
    removed = false;
    ctx.log.error("staff.reassign.remove-old.fail", {
      clientId,
      classId: fromClassId,
      error: serializeError(e),
    });
  }

  const stillOnOldClass = `The child is now booked into ${toLabel}, but Mindbody would not release ${fromLabel} — they are currently on both. Remove the old booking by hand.`;
  try {
    await updateDealProperties(ctx.hsCfg, ctx.log, ctx.dealId, {
      ...buildBookingDealProperties({
        ...ctx.ledger,
        ...patch,
        bookingStatus: removed ? "confirmed" : "manual_review",
        enrollmentStatus: "enrollment_verified",
        mindbodyMutationStatus: removed ? "verified" : "manual_review",
        mindbodyVisitId: visit!.Id,
        // A fresh checkout granted a new credit instance; bind the ledger to it
        // rather than leaving it pointed at the credit the old class consumed.
        mindbodyClientServiceId:
          saleId !== undefined
            ? (positiveInteger(visit!.ServiceId) ?? ctx.ledger.mindbodyClientServiceId)
            : ctx.ledger.mindbodyClientServiceId,
        mindbodySaleId: saleId ?? ctx.ledger.mindbodySaleId,
        enrollmentVerifiedAt: new Date(),
      }),
      court16_failure_reason: removed ? "" : stillOnOldClass,
      class_date: classDateProperty(ctx, target),
    });
  } catch (e) {
    ctx.log.error("staff.reassign.final-update.fail", { error: serializeError(e) });
    return html(
      `The child was moved in Mindbody${removed ? "" : " but is still on the old class"}, and HubSpot could not be updated. Fix the Deal by hand: new class ${toLabel}, visit ${visit!.Id}.`,
      502,
    );
  }

  ctx.log.info("staff.reassign.moved", {
    fromClassId,
    toClassId: target.classId,
    visitId: visit!.Id,
    oldBookingRemoved: removed,
  });
  return html(
    removed
      ? `Moved to ${toLabel} (${target.className}). The old booking on ${fromLabel} was released and the Deal is confirmed against the new class.`
      : stillOnOldClass,
    200,
  );
}

/** Record a move that never touched the old booking, and say so plainly. */
async function failMove(ctx: ReassignContext, reason: string): Promise<Response> {
  try {
    await updateDealProperties(ctx.hsCfg, ctx.log, ctx.dealId, {
      ...buildBookingDealProperties({
        ...ctx.ledger,
        bookingStatus: "manual_review",
        mindbodyMutationStatus: "manual_review",
        failureReason: reason,
      }),
      court16_failure_reason: reason,
    });
  } catch (e) {
    ctx.log.error("staff.reassign.fail-update.fail", { error: serializeError(e) });
  }
  ctx.log.warn("staff.reassign.move-failed", { reason });
  return html(reason, 502);
}

async function readActiveVisit(
  ctx: ReassignContext,
  criteria: { clientId: string; classId: number; siteId: number; locationId: number },
  window: { startDate: string; endDate: string },
  attempts = 3,
): Promise<ClientVisit | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const visits = await getClientVisits(ctx.mbCfg, ctx.log, {
        clientId: criteria.clientId,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const match = findExactActiveClientVisit(visits, criteria);
      if (match) return match;
      lastError = undefined;
    } catch (e) {
      lastError = e;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
  return undefined;
}

/** A day either side absorbs the site-local/UTC skew in Mindbody's visit query. */
function visitWindow(startDateTime: string): { startDate: string; endDate: string } {
  const day = new Date(`${startDateTime.slice(0, 10)}T12:00:00Z`);
  const start = new Date(day);
  const end = new Date(day);
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function positiveInteger(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function serializeError(error: unknown): string {
  return error instanceof MindbodyError
    ? JSON.stringify(error.toJSON())
    : error instanceof Error
      ? error.message
      : String(error);
}

function pickerHtml(ctx: ReassignContext, slots: ReassignSlot[]): Response {
  const child = [ctx.ledger.childFirstName, ctx.ledger.childLastName].filter(Boolean).join(" ");
  const current = ctx.ledger.classDayTime || "an unrecorded slot";
  const confirmed = ctx.ledger.bookingStatus === "confirmed";
  const effect = confirmed
    ? "This booking is already live in Mindbody. Choosing a slot books the new class first, then releases the old one — the child is never left without a class."
    : "Nobody is enrolled in Mindbody yet, so this only changes which class the request points at. Use Confirm afterwards to book it.";

  if (slots.length === 0) {
    return html(
      `${child || "This request"} is on ${current}. There are no other bookable trial classes at ${ctx.location.name} in the next four weeks, so there is nothing to move to. No state was changed.`,
      200,
    );
  }

  const options = slots
    .map((slot) => {
      const label = formatClassDayTime(slot.startDateTime, ctx.location.timezone) || slot.startDateTime;
      const detail = [slot.className, slot.coachName, `${slot.spotsRemaining} spot${slot.spotsRemaining === 1 ? "" : "s"} left`]
        .filter(Boolean)
        .join(" · ");
      return `<label class="slot"><input type="radio" name="slot" value="${escapeHtml(encodeSlotValue(slot))}" required><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span></label>`;
    })
    .join("");

  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:24px}p{line-height:1.5}.slot{display:flex;gap:12px;align-items:flex-start;border:1px solid #ddd;border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer}.slot:hover{border-color:#111}.slot span{display:flex;flex-direction:column}.slot small{color:#666;margin-top:2px}button{border:2px solid #111;background:#ffd800;color:#111;border-radius:999px;padding:12px 20px;font:700 15px system-ui;cursor:pointer;margin-top:16px}</style></head><body><h1>Move ${escapeHtml(child || "this request")} to a different class</h1><p>Currently on <strong>${escapeHtml(current)}</strong> at ${escapeHtml(ctx.location.name)}.</p><p>${escapeHtml(effect)}</p><form method="post">${options}<button type="submit">Move to the selected class</button></form></body></html>`;
  return htmlResponse(body, 200);
}

function html(msg: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:20px}</style></head><body><h1>Court 16 staff</h1><p>${escapeHtml(msg)}</p></body></html>`;
  return htmlResponse(body, status);
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
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    // Slot values and class names reach attribute contexts in the picker, where
    // an unescaped quote would break out of the attribute.
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
