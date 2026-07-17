import { NextResponse } from "next/server";
import {
  addClientToClass,
  getClientVisits,
  getClientServices,
  isAlreadyBookedError,
  loadConfigFromEnv,
  MindbodyError,
  purchaseTrialService,
  type ClientService,
  type ClientVisit,
  type MindbodyConfig,
} from "@/lib/mindbody";
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
import { getLocationById } from "@/config/locations";
import { TRIAL_CONFIG } from "@/config/trial-config";
import { getDealPipeline } from "@/config/hubspot-deals";
import { withLocalActionLock } from "@/lib/action-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/confirm?token=<signed-jwt> renders an explicit confirmation
 * page. POST performs the booking mutation. Keeping writes off GET prevents
 * email-link scanners from enrolling a client before staff clicks the button.
 *
 * Staff clicks the confirm link from the email. We verify the HMAC, find
 * the Contact by `court16_correlation_id` in HubSpot, reject if already
 * confirmed (single-use via status, not a separate token table), call
 * MindBody AddClientToClass, then flip `court16_booking_status=confirmed`
 * which triggers the parent-confirmation workflow in HubSpot.
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
  if (payload.action !== "confirm") {
    return html(`Wrong token action: ${payload.action}`, 400);
  }

  return actionHtml(
    "Confirm this booking?",
    "This will enroll the player in Mindbody and mark the request confirmed in HubSpot.",
    "Confirm booking",
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
  if (payload.action !== "confirm") {
    return html(`Wrong token action: ${payload.action}`, 400);
  }

  const result = await withLocalActionLock(
    `staff-action:${payload.correlationId}`,
    () => confirmBooking(payload),
  );
  if (!result.acquired) {
    return html("This booking is already being processed. Wait a moment and refresh HubSpot.", 409);
  }
  return result.value;
}

async function confirmBooking(payload: ReturnType<typeof verifyToken>) {
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

  const intent = contact.properties.court16_intent;
  const bookingStatus = contact.properties.court16_booking_status;
  const failureReason = contact.properties.court16_failure_reason;
  const isKidTrial = intent === "kid_trial";
  const isAdultIntro = intent === "adult_intro";
  const isResumableKidConfirm =
    isKidTrial &&
    bookingStatus === "manual_review" &&
    failureReason?.startsWith("[confirm_retry]");
  if (!isKidTrial && !isAdultIntro) {
    return html("This booking has an unknown intent. No Mindbody enrollment was attempted.", 409);
  }
  if (bookingStatus === "confirmed") {
    return html("This booking is already confirmed. Thank you.", 410);
  }
  if (isKidTrial && bookingStatus !== "pending_staff" && !isResumableKidConfirm) {
    return html(
      "This kids trial is not in Pending Staff state. No Mindbody enrollment was attempted; review the request in HubSpot.",
      409,
    );
  }
  if (isAdultIntro && bookingStatus !== "pending_staff_assist") {
    return html(
      "This adult intro is not awaiting staff assistance. No Mindbody enrollment was attempted; review the request in HubSpot.",
      409,
    );
  }

  // Fail closed unless the booking points to a known, fully verified club.
  // Never fall back to the deployment's default MINDBODY_SITE_ID: a missing
  // or stale HubSpot location could otherwise enroll a child at the wrong
  // studio.
  const locationSlug = contact.properties.court16_location_slug;
  const location = locationSlug ? getLocationById(locationSlug) : undefined;
  const trialConfig = location ? TRIAL_CONFIG[location.id] : undefined;
  const pipeline = location ? getDealPipeline(location.id) : null;
  if (
    !location ||
    !location.publicBookingEnabled ||
    !pipeline ||
    (isKidTrial &&
      (!location.trialBookingEnabled ||
        !location.kidTrialProgramId ||
        !trialConfig?.trialServiceId ||
        !trialConfig.trialServiceName ||
        !trialConfig.parentGuardianRelationship))
  ) {
    log.warn("staff.confirm.location-not-ready", {
      locationSlug: locationSlug ?? null,
      knownLocation: Boolean(location),
      intent,
      publicBookingEnabled: location?.publicBookingEnabled ?? false,
      trialBookingEnabled: location?.trialBookingEnabled ?? false,
      hasProgram: Boolean(location?.kidTrialProgramId),
      hasService: Boolean(trialConfig?.trialServiceId),
      hasServiceName: Boolean(trialConfig?.trialServiceName),
      hasParentGuardianRelationship: Boolean(trialConfig?.parentGuardianRelationship),
      hasPipeline: Boolean(pipeline),
    });
    return html(
      "This club is missing or its trial automation is not verified. No Mindbody enrollment was attempted. Escalate with the request reference and club.",
      409,
    );
  }
  mbCfg = { ...mbCfg, siteId: String(location.siteId) };

  const classId = contact.properties.court16_class_id
    ? Number(contact.properties.court16_class_id)
    : undefined;
  const clientId = isKidTrial
    ? contact.properties.court16_mindbody_child_id
    : contact.properties.court16_mindbody_parent_id;

  if (!classId || !clientId) {
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "failed",
      court16_failure_reason: `Missing court16_class_id or ${isKidTrial ? "child" : "adult"} MindBody client ID on contact`,
    });
    return html("Booking record is missing class or client — flagged as failed.", 422);
  }

  // The readiness gate above guarantees this exact site's verified $0 sale
  // service is used. Its ID is not a ClientService instance ID; after checkout
  // we read the granted instance back before enrollment.
  const trialServiceId = isKidTrial ? trialConfig!.trialServiceId : undefined;
  const trialServiceName = isKidTrial ? trialConfig!.trialServiceName : undefined;

  let enrollmentError: unknown;
  let retryableError: unknown;

  if (isKidTrial && trialServiceId && trialServiceName) {
    let alreadyEnrolled = false;
    try {
      const visits = await getClientVisits(mbCfg, log, {
        clientId,
        startDate: utcDateOffset(-30),
        endDate: utcDateOffset(60),
      });
      const existingVisit = visits.find((visit) => isActiveClassVisit(visit, classId));
      if (existingVisit) {
        const exactService =
          Number(existingVisit.ProductId) === trialServiceId &&
          existingVisit.ServiceName === trialServiceName;
        if (exactService) {
          alreadyEnrolled = true;
          log.info("staff.confirm.visitAlreadyExists", { clientId, classId });
        } else {
          enrollmentError = new Error(
            "Existing class visit is attached to an unexpected service; manual Mindbody review required",
          );
        }
      }
    } catch (e) {
      retryableError = e;
    }

    if (!alreadyEnrolled && !retryableError && !enrollmentError) {
      let clientService: ClientService | undefined;
      try {
        clientService = await readExactClientService(
          mbCfg,
          log,
          clientId,
          trialServiceId,
          trialServiceName,
          1,
        );
      } catch (e) {
        retryableError = e;
      }

      if (!clientService && !retryableError) {
        let purchaseError: unknown;
        try {
          await purchaseTrialService(mbCfg, log, {
            ClientId: clientId,
            ServiceId: trialServiceId,
            Notes: `Court 16 trial · ${payload.correlationId}`,
          });
        } catch (e) {
          purchaseError = e;
          log.warn("staff.confirm.purchase-trial.fail", {
            clientId,
            trialServiceId,
            error: serializeError(e).slice(0, 500),
          });
        }

        // A checkout can commit before its response fails. Always retry the
        // exact read-back before deciding whether another staff attempt is
        // needed; never purchase a second credit in this request.
        try {
          clientService = await readExactClientService(
            mbCfg,
            log,
            clientId,
            trialServiceId,
            trialServiceName,
            3,
          );
        } catch (e) {
          retryableError = purchaseError ?? e;
        }
        if (!clientService && !retryableError) {
          retryableError =
            purchaseError ??
            new Error(`Exact ClientService not visible after checkout: ${trialServiceName}`);
        }
      }

      if (clientService?.Id != null && !retryableError) {
        try {
          await addClientToClass(mbCfg, log, {
            ClientId: clientId,
            ClassId: classId,
            ClientServiceId: Number(clientService.Id),
          });
        } catch (e) {
          if (isAlreadyBookedError(e)) {
            log.info("staff.confirm.alreadyBooked", { clientId, classId });
          } else {
            enrollmentError = e;
          }
        }
      }
    }
  } else {
    try {
      await addClientToClass(mbCfg, log, { ClientId: clientId, ClassId: classId });
    } catch (e) {
      if (isAlreadyBookedError(e)) {
        log.info("staff.confirm.alreadyBooked", { clientId, classId });
      } else {
        enrollmentError = e;
      }
    }
  }

  if (retryableError) {
    const serialized = serializeError(retryableError);
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "manual_review",
      court16_failure_reason: `[confirm_retry] ${serialized}`.slice(0, 4000),
    });
    return html(
      "Mindbody could not verify the exact trial credit or enrollment state. No second credit was requested. Wait one minute, then use this Confirm link again; if it still fails, review the child in Mindbody.",
      503,
    );
  }

  if (enrollmentError) {
    const serialized = serializeError(enrollmentError);
    await updateContact(hsCfg, log, contact.id, {
      court16_booking_status: "failed",
      court16_failure_reason: `Staff confirm: ${serialized}`.slice(0, 4000),
    });
    let reason = "Mindbody declined the booking.";
    if (enrollmentError instanceof MindbodyError) {
      const errorBody = enrollmentError.toJSON().body as
        | { Error?: { Message?: string } }
        | null
        | undefined;
      if (errorBody?.Error?.Message) reason = errorBody.Error.Message;
    }
    return html(
      `Mindbody declined this booking: ${reason} ` +
        `This usually means the class filled, was cancelled, or the exact trial credit could not be verified. ` +
        `Use the Reassign link from the same email or review the child in Mindbody. ` +
        `The request is marked Failed in HubSpot with the full details.`,
      502,
    );
  }

  await updateContact(hsCfg, log, contact.id, { court16_booking_status: "confirmed" });

  // Advance the Deal in the Trials pipeline. Soft-failure: log + continue.
  // The Contact-side status flip above is the canonical signal staff
  // workflows trigger on; the Deal move is for reporting / kanban.
  try {
    const deal = await findDealByCorrelationId(hsCfg, log, payload.correlationId);
    if (deal) {
      await moveDealStage(hsCfg, log, deal.id, pipeline.stages.scheduled);
      log.info("staff.confirm.dealMoved", { dealId: deal.id, stage: pipeline.stages.scheduled });
    }
  } catch (e) {
    log.warn("staff.confirm.dealMove.fail", { error: e instanceof Error ? e.message : String(e) });
  }

  return html(
    `Confirmed. Parent will receive a confirmation email shortly. (correlation: ${payload.correlationId})`,
    200,
  );
}

function html(msg: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Court 16 staff</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#222}h1{font-size:20px}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:12px}</style></head><body><h1>Court 16 staff</h1><p>${escapeHtml(msg)}</p></body></html>`;
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

function findAvailableClientService(
  services: ClientService[],
  expectedProductId: number,
  expectedName: string,
): ClientService | undefined {
  const now = Date.now();
  return services
    .filter((service) => {
      const remaining = Number(service.Remaining ?? service.Count ?? 0);
      const expirationMs = service.ExpirationDate ? Date.parse(service.ExpirationDate) : Infinity;
      return (
        service.Id != null &&
        Number(service.ProductId) === expectedProductId &&
        service.Name === expectedName &&
        remaining > 0 &&
        (!Number.isFinite(expirationMs) || expirationMs >= now)
      );
    })
    .sort((a, b) => Date.parse(b.PaymentDate ?? "") - Date.parse(a.PaymentDate ?? ""))[0];
}

async function readExactClientService(
  cfg: MindbodyConfig,
  log: ReturnType<typeof createLogger>,
  clientId: string | number,
  productId: number,
  name: string,
  attempts: number,
): Promise<ClientService | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const match = findAvailableClientService(
        await getClientServices(cfg, log, clientId),
        productId,
        name,
      );
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

function utcDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isActiveClassVisit(visit: ClientVisit, classId: number): boolean {
  const state = `${visit.AppointmentStatus ?? ""} ${visit.Status ?? ""}`.toLowerCase();
  return Number(visit.ClassId) === classId && !visit.LateCancelled && !state.includes("cancel");
}

function serializeError(error: unknown): string {
  return error instanceof MindbodyError
    ? JSON.stringify(error.toJSON())
    : error instanceof Error
      ? error.message
      : String(error);
}
