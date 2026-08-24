import {
  buildBookingDealProperties,
  parseBookingDealLedger,
  validateBookingDealLedgerForState,
} from "../hubspot-deal-ledger.ts";
import type { TrialE2EReceipt } from "./types";

/**
 * Exercise the production Deal-ledger serializer, parser, and state validator
 * without calling HubSpot or retaining family PII in the signed receipt.
 */
export function assertTrialE2ELedgerContract(receipt: TrialE2EReceipt): void {
  const confirmed = receipt.state === "confirmed";
  const properties = buildBookingDealProperties({
    correlationId: receipt.submissionId,
    activeParentKey: `e2e:${receipt.runId}`,
    intent: "kid_trial",
    bookingStatus: receipt.state,
    locationSlug: "e2e-sandbox",
    mindbodySiteId: receipt.mode === "mindbody_sandbox" ? -99 : "fixture",
    mindbodyLocationId: receipt.mode === "mindbody_sandbox" ? 1 : 990001,
    mindbodyProgramId: receipt.mode === "mindbody_sandbox" ? 26 : 990026,
    mindbodyServiceId: receipt.mode === "mindbody_sandbox" ? 1377 : 9901377,
    mindbodyServiceName:
      receipt.mode === "mindbody_sandbox"
        ? "Groupon 5 Class Intro Series"
        : "E2E fixture service",
    classId: receipt.classSelection.classId,
    classScheduleId: receipt.classSelection.classScheduleId,
    className: receipt.classSelection.className,
    classDayTime: receipt.classSelection.startsAt,
    parentEmail: "redacted@example.invalid",
    childFirstName: "Redacted",
    childLastName: "Fixture",
    childBirthDate: "2017-06-15",
    waiverVersion: "e2e-v1",
    staffConfirmUrl: "https://e2e.invalid/confirm",
    staffReassignUrl: "https://e2e.invalid/reassign",
    staffDenyUrl: "https://e2e.invalid/deny",
    mindbodyParentId: receipt.ids.parentClientId,
    mindbodyChildId: receipt.ids.childClientId,
    familyAccountStatus: "parent_claim_pending",
    familyProvisioningStatus: "child_created",
    enrollmentStatus: confirmed ? "enrollment_verified" : "not_started",
    mindbodyMutationStatus: confirmed ? "verified" : "not_started",
    ...(confirmed
      ? {
          mindbodyClientServiceId: `service:${receipt.ids.childClientId}`,
          mindbodySaleId:
            Number(receipt.ids.saleId) > 0 ? receipt.ids.saleId : 9902772,
          mindbodyVisitId:
            Number(receipt.ids.visitId) > 0 ? receipt.ids.visitId : 9905824,
          enrollmentVerifiedAt: receipt.issuedAt,
          mindbodyMutationStartedAt: receipt.issuedAt,
        }
      : {}),
  });
  properties.class_date = String(
    Date.parse(`${receipt.classSelection.startsAt.slice(0, 10)}T12:00:00Z`),
  );

  const parsed = parseBookingDealLedger(properties);
  if (!parsed.ok) {
    throw new Error(`E2E Deal-ledger parse failed: ${parsed.missing.join(", ")}`);
  }
  const missing = validateBookingDealLedgerForState(parsed.value);
  if (missing.length > 0) {
    throw new Error(`E2E Deal-ledger state failed: ${missing.join(", ")}`);
  }
}
