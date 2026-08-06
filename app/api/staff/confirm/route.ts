import { NextResponse } from "next/server";
import {
  addClientToClass,
  checkoutTrialBooking,
  findExactActiveClientVisit,
  getClientVisits,
  getClientServices,
  isAlreadyBookedError,
  loadConfigFromEnv,
  MindbodyError,
  type ClientService,
  type ClientVisit,
  type MindbodyConfig,
} from "@/lib/mindbody";
import {
  findDealByCorrelationId,
  loadHubspotConfig,
  moveDealStage,
  updateDealProperties,
} from "@/lib/hubspot";
import { InvalidTokenError, verifyToken } from "@/lib/staff-tokens";
import { createLogger } from "@/lib/logger";
import { getLocationById } from "@/config/locations";
import { TRIAL_CONFIG } from "@/config/trial-config";
import { getDealPipeline } from "@/config/hubspot-deals";
import { getKidsTrialStaffReadiness } from "@/config/kids-trial-readiness";
import {
  DistributedActionLockError,
  withDistributedActionLock,
} from "@/lib/distributed-action-lock";
import { getMindbodyWriteGuard } from "@/lib/mindbody-write-guard";
import {
  bookingLedgerMatchesStaffToken,
  isFamilyReadyForMindbodyMutation,
  requiresReadOnlyEnrollmentReconciliation,
} from "@/lib/mindbody-booking-evidence";
import {
  buildBookingDealProperties,
  parseBookingDealLedger,
  validateBookingDealLedgerForState,
  type EnrollmentStatus,
  type MindbodyMutationStatus,
  type ParsedBookingDealLedger,
} from "@/lib/hubspot-deal-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/confirm?token=<signed-jwt> renders an explicit confirmation
 * page. POST performs the booking mutation. Keeping writes off GET prevents
 * email-link scanners from enrolling a client before staff clicks the button.
 *
 * Staff clicks the confirm link from the email. We verify the HMAC and the
 * immutable request-scoped Deal ledger, reject terminal requests, reconcile
 * or perform the exact Mindbody enrollment, then mark the Deal confirmed.
 * Deal-based HubSpot workflows own notifications; shared Contact state is
 * never used as the booking authority.
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

  const actionLog = createLogger(payload.correlationId);
  let result;
  try {
    result = await withDistributedActionLock(
      `staff-action:${payload.correlationId}`,
      () => confirmBooking(payload),
      {
        onReleaseError: (error) =>
          actionLog.error("staff.confirm.distributed-lock.release-failed", {
            code: error instanceof DistributedActionLockError ? error.code : "unknown",
          }),
      },
    );
  } catch (error) {
    actionLog.error("staff.confirm.distributed-lock.acquire-failed", {
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
    return html("This booking is already being processed. Wait a moment and refresh HubSpot.", 409);
  }
  return result.value;
}

async function confirmBooking(payload: ReturnType<typeof verifyToken>) {
  const log = createLogger(payload.correlationId);
  const hsCfg = loadHubspotConfig();
  if (!hsCfg) {
    return html(
      "HubSpot is not configured on this deployment. Staff confirm requires HUBSPOT_ACCESS_TOKEN and HUBSPOT_PORTAL_ID.",
      503,
    );
  }
  if (process.env.HUBSPOT_DEAL_LEDGER_ENABLED !== "true") {
    return html(
      "The Deal booking ledger is not enabled on this deployment. No Mindbody enrollment was attempted.",
      503,
    );
  }

  let mbCfg;
  try {
    mbCfg = loadConfigFromEnv();
  } catch (e) {
    return html(`Config error: ${e instanceof Error ? e.message : String(e)}`, 500);
  }

  let bookingDeal: Awaited<ReturnType<typeof findDealByCorrelationId>>;
  try {
    bookingDeal = await findDealByCorrelationId(hsCfg, log, payload.correlationId, {
      includeBookingLedger: true,
    });
  } catch (e) {
    log.warn("staff.confirm.dealLookup.fail", {
      error: e instanceof Error ? e.message : String(e),
    });
    return html("The HubSpot booking record could not be verified.", 502);
  }
  if (!bookingDeal) {
    return html(`Booking not found for correlation ${payload.correlationId}`, 404);
  }

  const parsedLedger = parseBookingDealLedger(bookingDeal.properties);
  const claimsLedgerV1 = bookingDeal.properties.court16_booking_ledger_version === "1";
  if (claimsLedgerV1 && !parsedLedger.ok) {
    log.warn("staff.confirm.deal-ledger-incomplete", { missing: parsedLedger.missing });
    return html(
      "This booking's HubSpot Deal ledger is incomplete. No Mindbody enrollment was attempted; send it to manual review.",
      409,
    );
  }
  const ledger = parsedLedger.ok ? parsedLedger.value : null;
  if (!ledger) {
    return html(
      "This booking does not have a verified Deal ledger. No Mindbody enrollment was attempted; migrate or review it manually.",
      409,
    );
  }
  if (!bookingLedgerMatchesStaffToken(ledger, payload.correlationId)) {
    log.warn("staff.confirm.deal-token-mismatch", {
      dealBookingKey: ledger.bookingKey,
      dealCorrelationId: ledger.correlationId,
    });
    return html(
      "The signed staff link does not match this Deal's booking identity. No Mindbody enrollment was attempted.",
      409,
    );
  }
  if (!isFamilyReadyForMindbodyMutation(ledger)) {
    return html(
      "The child Mindbody record has not been durably verified on this Deal. No service or enrollment was created.",
      409,
    );
  }
  const missingForState = validateBookingDealLedgerForState(ledger);
  if (missingForState.length > 0) {
    log.warn("staff.confirm.deal-ledger-state-incomplete", { missing: missingForState });
    return html(
      "This booking's Deal is missing required class, service, family, or action evidence. No Mindbody enrollment was attempted.",
      409,
    );
  }
  const readOnlyReconciliation = requiresReadOnlyEnrollmentReconciliation(ledger);

  if (bookingDeal.associatedContactIds.length !== 1) {
    log.warn("staff.confirm.deal-contact-cardinality", {
      dealId: bookingDeal.id,
      contactIds: bookingDeal.associatedContactIds,
    });
    return html(
      "This booking must be associated with exactly one HubSpot Contact. No Mindbody enrollment was attempted.",
      409,
    );
  }

  const intent = ledger.intent;
  const bookingStatus = ledger.bookingStatus;
  const failureReason = ledger.failureReason;
  const isKidTrial = intent === "kid_trial";
  const isAdultIntro = intent === "adult_intro";
  const isResumableConfirm =
    bookingStatus === "manual_review" &&
    failureReason?.startsWith("[confirm_retry]") &&
    readOnlyReconciliation;
  if (!isKidTrial && !isAdultIntro) {
    return html("This booking has an unknown intent. No Mindbody enrollment was attempted.", 409);
  }
  if (bookingStatus === "confirmed") {
    return html("This booking is already confirmed on its Deal. Thank you.", 410);
  }
  if (isKidTrial && bookingStatus !== "pending_staff" && !isResumableConfirm) {
    return html(
      "This kids trial is not in Pending Staff state. No Mindbody enrollment was attempted; review the request in HubSpot.",
      409,
    );
  }
  if (isAdultIntro && bookingStatus !== "pending_staff_assist" && !isResumableConfirm) {
    return html(
      "This adult intro is not awaiting staff assistance. No Mindbody enrollment was attempted; review the request in HubSpot.",
      409,
    );
  }

  // Fail closed unless the booking points to a known, fully verified club.
  // Never fall back to the deployment's default MINDBODY_SITE_ID: a missing
  // or stale HubSpot location could otherwise enroll a child at the wrong
  // studio.
  const locationSlug = ledger.locationSlug;
  const location = locationSlug ? getLocationById(locationSlug) : undefined;
  const pipeline = location ? getDealPipeline(location.id) : null;
  const kidTrialReadiness = location
    ? getKidsTrialStaffReadiness({
        location,
        trialConfig: TRIAL_CONFIG[location.id],
        pipeline,
      })
    : null;
  const trialConfig = kidTrialReadiness?.ready
    ? kidTrialReadiness.trialConfig
    : location
      ? TRIAL_CONFIG[location.id]
      : undefined;
  if (
    !location ||
    !pipeline ||
    (isKidTrial && !kidTrialReadiness?.ready)
  ) {
    log.warn("staff.confirm.location-not-ready", {
      locationSlug: locationSlug ?? null,
      knownLocation: Boolean(location),
      intent,
      hasProgram: Boolean(location?.kidTrialProgramId),
      hasService: Boolean(trialConfig?.trialServiceId),
      hasServiceName: Boolean(trialConfig?.trialServiceName),
      hasParentGuardianRelationship: Boolean(trialConfig?.parentGuardianRelationship),
      hasPipeline: Boolean(pipeline),
      missing: kidTrialReadiness && !kidTrialReadiness.ready ? kidTrialReadiness.missing : [],
    });
    return html(
      "This club is missing or its trial automation is not verified. No Mindbody enrollment was attempted. Escalate with the request reference and club.",
      409,
    );
  }

  // A Contact can be reused across clubs, while Mindbody client IDs are
  // site-scoped. Refuse to enroll when the Deal's pipeline or explicit Site ID
  // disagrees with its location configuration.
  if (
    bookingDeal.properties.pipeline !== pipeline.pipelineId ||
    ledger.mindbodySiteId !== String(location.siteId) ||
    (isKidTrial && ledger.mindbodyProgramId !== String(location.kidTrialProgramId)) ||
    (isKidTrial && ledger.mindbodyServiceId !== String(trialConfig?.trialServiceId)) ||
    (isKidTrial && ledger.mindbodyServiceName !== trialConfig?.trialServiceName)
  ) {
    log.warn("staff.confirm.deal-location-mismatch", {
      correlationId: payload.correlationId,
      bookingLocationSlug: location.id,
      expectedPipeline: pipeline.pipelineId,
      actualPipeline: bookingDeal.properties.pipeline ?? null,
      expectedSiteId: String(location.siteId),
      actualSiteId: ledger.mindbodySiteId ?? null,
    });
    return html(
      "The request's HubSpot Deal does not match the club that owns these Mindbody client IDs. No enrollment was attempted; review the family and club manually.",
      409,
    );
  }
  mbCfg = { ...mbCfg, siteId: String(location.siteId) };
  const writeGuard = getMindbodyWriteGuard(mbCfg.siteId);
  if (!writeGuard.allowed) {
    log.warn("staff.confirm.mindbody-writes.blocked", {
      locationSlug: location.id,
      siteId: mbCfg.siteId,
      reason: writeGuard.reason,
    });
    return html(
      "Mindbody writes are not authorized for this club on this deployment. No service or enrollment was created.",
      503,
    );
  }

  const classId = positiveNumber(ledger.classId);
  const clientId = isKidTrial ? ledger.mindbodyChildId : ledger.mindbodyParentId;

  if (!classId || !clientId) {
    // This validation failure happens before any checkout or enrollment call.
    // Preserve the ledger's real pre-write statuses so the Deny link can still
    // terminally resolve the request and release the parent's booking fence.
    await updateDealProperties(hsCfg, log, bookingDeal.id, {
      ...buildBookingDealProperties({
        ...ledger,
        bookingStatus: "failed",
        failureReason: `Missing class ID or ${isKidTrial ? "child" : "adult"} Mindbody client ID on booking Deal`,
      }),
    });
    return html(
      "Booking record is missing class or client — flagged as failed. Use the Deny link to resolve the request and release the parent's booking hold.",
      422,
    );
  }

  // The readiness gate above guarantees this exact site's verified $0 sale
  // service is used. Its ID is not a ClientService instance ID; after checkout
  // we read the granted instance back before enrollment.
  const trialServiceId = isKidTrial ? trialConfig!.trialServiceId : undefined;
  const trialServiceName = isKidTrial ? trialConfig!.trialServiceName : undefined;
  const mindbodyLocationId = positiveNumber(ledger.mindbodyLocationId);
  if (isKidTrial && !mindbodyLocationId) {
    return html(
      "The Deal does not contain a verified physical Mindbody Location ID. No checkout or enrollment was attempted.",
      409,
    );
  }

  let enrollmentError: unknown;
  let retryableError: unknown;
  let verifiedVisit: ClientVisit | undefined;
  let verifiedClientService: ClientService | undefined;
  // True once this attempt persists a checkout/enrollment write-ahead marker.
  // While the prior ledger state is pre-write AND no marker was persisted in
  // this attempt, a failure is provably pre-write: no Checkout or
  // AddClientToClass call was ever issued for this request, so the Deal must
  // keep its retryable pre-write statuses instead of being frozen into
  // read-only reconciliation (which would also block the Deny link).
  let mindbodyWriteMarked = false;
  // Set when Mindbody refuses the ClientService readback outright. The confirm
  // then relies on the configured Service ID and the Visit readback instead of
  // an exact credit lookup. See isClientServiceReadbackDenied.
  let clientServiceReadbackDenied = false;
  const priorLedgerPreWrite =
    (ledger.enrollmentStatus === "not_started" ||
      ledger.enrollmentStatus === "service_verified") &&
    ledger.mindbodyMutationStatus === "not_started";
  let purchaseSaleId = positiveNumber(ledger.mindbodySaleId);
  const visitWindow = visitWindowFromClassDate(ledger.classDate);
  if (!visitWindow) {
    return html(
      "The Deal class date is invalid. No Mindbody enrollment was attempted; review the booking manually.",
      409,
    );
  }

  if (isKidTrial && trialServiceId && trialServiceName) {
    try {
      verifiedVisit = await readExactActiveVisit(
        mbCfg,
        log,
        clientId,
        classId,
        trialServiceId,
        trialServiceName,
        undefined,
        location.siteId,
        mindbodyLocationId,
        visitWindow,
        readOnlyReconciliation ? 3 : 1,
      );
    } catch (e) {
      retryableError = e;
    }

    if (verifiedVisit) {
      verifiedClientService = clientServiceFromVisit(verifiedVisit, trialServiceName);
      log.info("staff.confirm.visitAlreadyExists", { clientId, classId, visitId: verifiedVisit.Id });
    } else if (!retryableError) {
      try {
        verifiedClientService = await readExactClientService(
          mbCfg,
          log,
          clientId,
          trialServiceId,
          trialServiceName,
          location.siteId,
          readOnlyReconciliation ? 3 : 1,
        );
      } catch (e) {
        if (isClientServiceReadbackDenied(e)) {
          clientServiceReadbackDenied = true;
          log.warn("staff.confirm.client-service-readback.denied", {
            clientId,
            siteId: location.siteId,
            detail:
              "Mindbody refused /client/clientservices for this source; continuing on the configured Service and the Visit readback.",
          });
        } else {
          retryableError = e;
        }
      }

      // The visit lookup above ran before we knew the credit readback was
      // denied, so it demanded a product and service name Mindbody never
      // recorded for this booking. Retry it on identity alone before declaring
      // the outcome unresolved — otherwise a request that did enroll stays
      // stuck in reconciliation forever, and no retry can ever clear it.
      if (clientServiceReadbackDenied && !verifiedVisit && !retryableError) {
        try {
          verifiedVisit = await readExactActiveVisit(
            mbCfg,
            log,
            clientId,
            classId,
            undefined,
            undefined,
            undefined,
            location.siteId,
            mindbodyLocationId,
            visitWindow,
            readOnlyReconciliation ? 3 : 1,
          );
          if (verifiedVisit) {
            log.info("staff.confirm.visit-verified-by-identity", {
              clientId,
              classId,
              visitId: verifiedVisit.Id,
            });
          }
        } catch (e) {
          retryableError = e;
        }
      }

      if (verifiedVisit) {
        // Enrollment is proven; fall through to the normal completion path.
      } else if (readOnlyReconciliation && !retryableError) {
        retryableError = new Error(
          "A prior enrollment outcome is unresolved; this retry performed read-only reconciliation and did not call Checkout or AddClientToClass",
        );
      } else if (!verifiedClientService && !retryableError) {
        const checkoutWasAlreadyAttempted =
          ledger?.mindbodyMutationStatus === "checkout_started" ||
          ledger?.mindbodyMutationStatus === "reconciliation_required" ||
          ledger?.enrollmentStatus === "checkout_started" ||
          ledger?.enrollmentStatus === "reconciliation_required";
        if (checkoutWasAlreadyAttempted) {
          retryableError = new Error(
            "A prior checkout outcome is unresolved; this retry performed read-only reconciliation and did not request another credit",
          );
        } else {
          try {
            await persistMutationMarker(hsCfg, log, bookingDeal.id, ledger, {
              enrollmentStatus: "checkout_started",
              mutationStatus: "checkout_started",
            });
            mindbodyWriteMarked = true;
          } catch (e) {
            retryableError = new Error(
              `HubSpot could not persist the checkout write-ahead marker: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        let checkoutError: unknown;
        if (!retryableError) {
          try {
            const checkout = await checkoutTrialBooking(mbCfg, log, {
              ClientId: clientId,
              ServiceId: trialServiceId,
              ClassId: classId,
              LocationId: mindbodyLocationId!,
              CorrelationId: payload.correlationId,
            });
            purchaseSaleId = checkout.saleId > 0 ? checkout.saleId : undefined;
            if (checkout.visit) {
              verifiedVisit = findExactActiveClientVisit([checkout.visit], {
                clientId,
                classId,
                siteId: location.siteId,
                locationId: mindbodyLocationId,
                productId: trialServiceId,
                serviceName: trialServiceName,
              });
              if (verifiedVisit) {
                verifiedClientService = clientServiceFromVisit(
                  verifiedVisit,
                  trialServiceName,
                );
                log.info("staff.confirm.checkout.direct-visit-verified", {
                  visitId: verifiedVisit.Id,
                });
              }
            }
          } catch (e) {
            checkoutError = e;
            log.warn("staff.confirm.checkout-trial.fail", {
              clientId,
              trialServiceId,
              error: serializeError(e).slice(0, 500),
            });
          }

          // Checkout can commit before its response is lost. Reconcile the
          // exact Visit and ClientService before deciding whether Add is needed.
          if (!verifiedVisit) {
            try {
              verifiedVisit = await readExactActiveVisit(
                mbCfg,
                log,
                clientId,
                classId,
                clientServiceReadbackDenied ? undefined : trialServiceId,
                clientServiceReadbackDenied ? undefined : trialServiceName,
                undefined,
                location.siteId,
                mindbodyLocationId,
                visitWindow,
                3,
              );
              if (!verifiedVisit && !clientServiceReadbackDenied) {
                verifiedClientService = await readExactClientService(
                  mbCfg,
                  log,
                  clientId,
                  trialServiceId,
                  trialServiceName,
                  location.siteId,
                  3,
                );
              }
            } catch (e) {
              if (isClientServiceReadbackDenied(e)) {
                clientServiceReadbackDenied = true;
              } else {
                retryableError = checkoutError ?? e;
              }
            }
          }
          if (
            !verifiedVisit &&
            !verifiedClientService &&
            !clientServiceReadbackDenied &&
            !retryableError
          ) {
            retryableError =
              checkoutError ??
              new Error("Checkout returned without an exact Visit or ClientService readback");
          }
        }
      }

      // With the readback denied there is no credit instance ID to bind, so the
      // enrollment uses the configured Service ID exactly as `main` did. The
      // Visit readback below is then the proof that enrollment succeeded.
      const enrollmentClientServiceId =
        verifiedClientService?.Id ?? (clientServiceReadbackDenied ? trialServiceId : undefined);

      if (enrollmentClientServiceId != null && !verifiedVisit && !retryableError) {
        try {
          await persistMutationMarker(hsCfg, log, bookingDeal.id, ledger, {
            enrollmentStatus: "enrollment_started",
            mutationStatus: "add_to_class_started",
            mindbodyClientServiceId: verifiedClientService?.Id,
            mindbodySaleId: purchaseSaleId,
          });
          mindbodyWriteMarked = true;
        } catch (e) {
          retryableError = new Error(
            `HubSpot could not persist the enrollment write-ahead marker: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        if (!retryableError) {
          try {
            const addResult = await addClientToClass(mbCfg, log, {
              ClientId: clientId,
              ClassId: classId,
              ClientServiceId: Number(enrollmentClientServiceId),
            });
            if (addResult.Visit) {
              verifiedVisit = findExactActiveClientVisit([addResult.Visit], {
                clientId,
                classId,
                siteId: location.siteId,
                locationId: mindbodyLocationId,
                productId: trialServiceId,
                serviceName: trialServiceName,
                clientServiceId: verifiedClientService?.Id,
              });
              if (verifiedVisit) {
                log.info("staff.confirm.add.direct-visit-verified", {
                  visitId: verifiedVisit.Id,
                });
              }
            }
          } catch (e) {
            if (isAlreadyBookedError(e)) {
              log.info("staff.confirm.alreadyBooked", { clientId, classId });
            } else {
              enrollmentError = e;
            }
          }
        }
      }

    if (!retryableError && !verifiedVisit) {
      try {
        verifiedVisit = await readExactActiveVisit(
          mbCfg,
          log,
          clientId,
          classId,
          // With the credit readback denied we cannot bind the visit to a
          // specific credit, and Mindbody may record the booking under its own
          // pricing label (Ridge Hill returns ServiceName "Free Class" for a
          // comped trial). Identity is still proven exactly: same client, same
          // occurrence, same site and location, not cancelled, missed, or
          // waitlisted. Claiming credit verification here would be false.
          clientServiceReadbackDenied ? undefined : trialServiceId,
          clientServiceReadbackDenied ? undefined : trialServiceName,
          verifiedClientService?.Id,
          location.siteId,
          mindbodyLocationId,
          visitWindow,
          3,
        );
        if (!verifiedVisit?.Id) {
          retryableError = new Error("Exact active Mindbody visit was not visible after enrollment");
        } else {
          enrollmentError = undefined;
        }
      } catch (e) {
        retryableError = e;
      }
    }
    }
  } else {
    if (!readOnlyReconciliation) {
      try {
        await persistMutationMarker(hsCfg, log, bookingDeal.id, ledger, {
          enrollmentStatus: "enrollment_started",
          mutationStatus: "add_to_class_started",
        });
        mindbodyWriteMarked = true;
      } catch (e) {
        retryableError = e;
      }
      try {
        if (!retryableError) {
          const addResult = await addClientToClass(mbCfg, log, {
            ClientId: clientId,
            ClassId: classId,
          });
          if (addResult.Visit) {
            verifiedVisit = findExactActiveClientVisit([addResult.Visit], {
              clientId,
              classId,
              siteId: location.siteId,
              locationId: mindbodyLocationId,
            });
            if (verifiedVisit) {
              log.info("staff.confirm.add.direct-visit-verified", {
                visitId: verifiedVisit.Id,
              });
            }
          }
        }
      } catch (e) {
        if (isAlreadyBookedError(e)) {
          log.info("staff.confirm.alreadyBooked", { clientId, classId });
        } else {
          enrollmentError = e;
        }
      }
    }
    if (!retryableError) {
      try {
        verifiedVisit = await readExactActiveVisit(
          mbCfg,
          log,
          clientId,
          classId,
          undefined,
          undefined,
          undefined,
          location.siteId,
          mindbodyLocationId,
          visitWindow,
          3,
        );
        if (!verifiedVisit?.Id) {
          retryableError = new Error("Exact active Mindbody visit was not visible after enrollment");
        } else {
          enrollmentError = undefined;
        }
      } catch (e) {
        retryableError = e;
      }
    }
  }

  if (retryableError) {
    const serialized = serializeError(retryableError);
    // A failure is provably pre-write when the ledger entered this attempt in
    // a pre-write state and no write-ahead marker was persisted before the
    // failure: no Checkout or AddClientToClass call was issued. Freezing such
    // a Deal into reconciliation_required would make every later Confirm
    // read-only (a livelock, since there is nothing to read back) and block
    // the Deny link. Keep the Deal exactly as it was, with the failure noted.
    const preWriteFailure = priorLedgerPreWrite && !mindbodyWriteMarked;
    let dealStateRecorded = false;
    try {
      await updateDealProperties(hsCfg, log, bookingDeal.id, {
        ...buildBookingDealProperties({
          ...ledger,
          bookingStatus: preWriteFailure ? ledger.bookingStatus : "manual_review",
          ...(preWriteFailure
            ? {}
            : {
                enrollmentStatus: "reconciliation_required" as const,
                mindbodyMutationStatus: "reconciliation_required" as const,
              }),
          failureReason: `[confirm_retry] ${serialized}`.slice(0, 4000),
          mindbodyServiceId: trialServiceId,
          mindbodyClientServiceId: verifiedClientService?.Id,
          mindbodySaleId: purchaseSaleId,
          mindbodyVisitId: verifiedVisit?.Id,
        }),
      });
      dealStateRecorded = true;
    } catch (e) {
      log.error("staff.confirm.deal-retry-state.fail", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (!dealStateRecorded) {
      return html(
        "Mindbody needs reconciliation, but HubSpot could not save that state on the Deal. Review the request by correlation ID.",
        503,
      );
    }
    if (preWriteFailure) {
      return html(
        "A pre-write check failed before any Mindbody write was attempted, so nothing was charged or enrolled. The request is unchanged: wait one minute and use this Confirm link again, or use the Deny link to resolve the request and release the parent's booking hold.",
        503,
      );
    }
    return html(
      "Mindbody could not verify the exact trial credit or enrollment state. No second credit was requested. Wait one minute, then use this Confirm link again; if it still fails, review the child in Mindbody.",
      503,
    );
  }

  if (enrollmentError) {
    const serialized = serializeError(enrollmentError);
    let dealStateRecorded = false;
    try {
      await updateDealProperties(hsCfg, log, bookingDeal.id, {
        ...buildBookingDealProperties({
          ...ledger,
          bookingStatus: "failed",
          enrollmentStatus: "reconciliation_required",
          mindbodyMutationStatus: "reconciliation_required",
          failureReason: `Staff confirm: ${serialized}`.slice(0, 4000),
          mindbodyServiceId: trialServiceId,
          mindbodyClientServiceId: verifiedClientService?.Id,
          mindbodySaleId: purchaseSaleId,
          mindbodyVisitId: verifiedVisit?.Id,
        }),
      });
      dealStateRecorded = true;
    } catch (e) {
      log.error("staff.confirm.deal-failure-state.fail", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (!dealStateRecorded) {
      return html(
        "Mindbody declined or could not verify the booking, but HubSpot could not save that state on the Deal.",
        503,
      );
    }
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

  if (!verifiedVisit?.Id) {
    return html(
      "Mindbody enrollment could not be read back with a Visit ID. The request remains in manual review.",
      503,
    );
  }

  // The Deal is authoritative. Persist exact readback evidence, release the
  // active-parent uniqueness key, and let reviewed Deal workflows notify.
  try {
    await moveDealStage(hsCfg, log, bookingDeal.id, pipeline.stages.scheduled, {
      ...buildBookingDealProperties({
        ...ledger,
        activeParentKey: undefined,
        bookingStatus: "confirmed",
        enrollmentStatus: "enrollment_verified",
        mindbodyMutationStatus: "verified",
        mindbodyServiceId: trialServiceId,
        mindbodyClientServiceId: verifiedClientService?.Id ?? verifiedVisit.ServiceId,
        mindbodySaleId: purchaseSaleId,
        mindbodyVisitId: verifiedVisit.Id,
        enrollmentVerifiedAt: new Date(),
      }),
      court16_active_parent_key: "",
      court16_failure_reason: "",
    });
    log.info("staff.confirm.dealMoved", {
      dealId: bookingDeal.id,
      stage: pipeline.stages.scheduled,
    });
  } catch (e) {
    log.error("staff.confirm.deal-evidence.fail", {
      error: e instanceof Error ? e.message : String(e),
    });
    return html(
      "Mindbody enrollment is verified, but HubSpot could not save its evidence. No second enrollment will be attempted; retry this link to reconcile HubSpot.",
      503,
    );
  }

  return html(
    `Confirmed in Mindbody and on the HubSpot Deal. The reviewed Deal workflow controls parent notification. (correlation: ${payload.correlationId})`,
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
  expectedSiteId: number,
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
        Number(service.SiteId) === expectedSiteId &&
        remaining > 0 &&
        (!Number.isFinite(expirationMs) || expirationMs >= now)
      );
    })
    .sort((a, b) => Date.parse(b.PaymentDate ?? "") - Date.parse(a.PaymentDate ?? ""))[0];
}

/**
 * True when Mindbody refuses the readback itself, rather than telling us
 * something is wrong with the booking.
 *
 * The source is not granted regional access to `/client/clientservices` at
 * every Court 16 organization — Ridge Hill returns
 * `403 DeniedAccess: "The SourceName provided does not have regional access to
 * the organization in which this site belongs"` — while `/client/clientvisits`,
 * checkout, and enrollment all succeed. That is a permissions gap, not evidence
 * that the trial credit is missing, so it must not fail the confirm closed:
 * `main` never performed this readback at all and enrolled successfully
 * throughout the May pilot.
 *
 * "I could not check" and "the check failed" are different outcomes and are
 * handled differently. When the readback is denied the confirm degrades to the
 * proven path — checkout, then AddClientToClass bound to the configured
 * Service — and enrollment is still proven by the Visit readback, which is
 * permitted.
 */
function isClientServiceReadbackDenied(error: unknown): boolean {
  if (!(error instanceof MindbodyError) || error.status !== 403) return false;
  const code = (error.body as { Error?: { Code?: unknown } } | undefined)?.Error?.Code;
  return code === "DeniedAccess";
}

async function readExactClientService(
  cfg: MindbodyConfig,
  log: ReturnType<typeof createLogger>,
  clientId: string | number,
  productId: number,
  name: string,
  siteId: number,
  attempts: number,
): Promise<ClientService | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const match = findAvailableClientService(
        await getClientServices(cfg, log, clientId),
        productId,
        name,
        siteId,
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

async function readExactActiveVisit(
  cfg: MindbodyConfig,
  log: ReturnType<typeof createLogger>,
  clientId: string | number,
  classId: number,
  expectedProductId: number | undefined,
  expectedServiceName: string | undefined,
  expectedClientServiceId: string | number | undefined,
  expectedSiteId: number,
  expectedLocationId: number | undefined,
  window: { startDate: string; endDate: string },
  attempts: number,
): Promise<ClientVisit | undefined> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const visits = await getClientVisits(cfg, log, {
        clientId,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const match = findExactActiveClientVisit(visits, {
        clientId,
        classId,
        siteId: expectedSiteId,
        locationId: expectedLocationId,
        productId: expectedProductId,
        serviceName: expectedServiceName,
        clientServiceId: expectedClientServiceId,
      });
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

async function persistMutationMarker(
  hsCfg: NonNullable<ReturnType<typeof loadHubspotConfig>>,
  log: ReturnType<typeof createLogger>,
  dealId: string,
  ledger: ParsedBookingDealLedger,
  args: {
    enrollmentStatus: EnrollmentStatus;
    mutationStatus: MindbodyMutationStatus;
    mindbodyClientServiceId?: string | number;
    mindbodySaleId?: string | number;
  },
): Promise<void> {
  await updateDealProperties(hsCfg, log, dealId, {
    ...buildBookingDealProperties({
      ...ledger,
      bookingStatus: ledger.bookingStatus,
      enrollmentStatus: args.enrollmentStatus,
      mindbodyMutationStatus: args.mutationStatus,
      mindbodyMutationStartedAt: new Date(),
      failureReason: ledger.failureReason,
      mindbodyClientServiceId: args.mindbodyClientServiceId ?? ledger.mindbodyClientServiceId,
      mindbodySaleId: args.mindbodySaleId ?? ledger.mindbodySaleId,
    }),
  });
}

function visitWindowFromClassDate(
  value: string | undefined,
): { startDate: string; endDate: string } | null {
  if (!value) return null;
  const milliseconds = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const start = new Date(milliseconds);
  const end = new Date(milliseconds);
  start.setUTCDate(start.getUTCDate() - 2);
  end.setUTCDate(end.getUTCDate() + 2);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function clientServiceFromVisit(visit: ClientVisit, name: string): ClientService | undefined {
  const id = positiveNumber(visit.ServiceId);
  if (!id) return undefined;
  return {
    Id: id,
    ProductId: positiveNumber(visit.ProductId),
    Name: name,
    SiteId: positiveNumber(visit.SiteId),
    Remaining: 0,
  };
}

function positiveNumber(value: string | number | undefined): number | undefined {
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
