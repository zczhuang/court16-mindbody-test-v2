export interface BookingEvidenceVisit {
  Id?: number;
  ClientId?: string | number;
  SiteId?: number;
  LocationId?: number;
  ClassId?: number;
  ProductId?: number;
  ServiceId?: number;
  ServiceName?: string;
  AppointmentStatus?: string;
  Status?: string;
  LateCancelled?: boolean;
  Missed?: boolean;
  WaitlistEntryId?: number;
}

export interface CheckoutBookingCoordinates {
  ClientId: string | number;
  ServiceId: number;
  ClassId: number;
}

export interface ExactClientVisitCriteria {
  clientId: string | number;
  classId: number;
  siteId: number;
  locationId?: number;
  productId?: number;
  serviceName?: string;
  clientServiceId?: string | number;
}

export interface BookingLedgerSafetyState {
  bookingKey: string;
  correlationId: string;
  intent: string;
  familyProvisioningStatus?: string;
  enrollmentStatus?: string;
  mindbodyMutationStatus?: string;
}

/** Fail closed unless the Deal identity and signed staff token name one request. */
export function bookingLedgerMatchesStaffToken(
  ledger: Pick<BookingLedgerSafetyState, "bookingKey" | "correlationId">,
  tokenCorrelationId: string,
): boolean {
  return (
    ledger.bookingKey === ledger.correlationId && ledger.correlationId === tokenCorrelationId
  );
}

/** A prior Add may have committed even when its response or HubSpot update was lost. */
export function requiresReadOnlyEnrollmentReconciliation(
  ledger: Pick<BookingLedgerSafetyState, "enrollmentStatus" | "mindbodyMutationStatus">,
): boolean {
  return (
    ledger.mindbodyMutationStatus === "add_to_class_started" ||
    ledger.mindbodyMutationStatus === "reconciliation_required" ||
    ledger.enrollmentStatus === "enrollment_started" ||
    ledger.enrollmentStatus === "reconciliation_required"
  );
}

/**
 * Denial is safe only before confirm has started any Mindbody write AND while
 * the kid-trial family records are in a settled, fully-recorded state.
 * "not_started" means no AddClient ran; "child_created" means both original
 * Client IDs are persisted on the Deal. Every in-between or reconciliation
 * value means a Mindbody record may exist that the Deal cannot account for,
 * so releasing the parent fence could let a resubmission duplicate a child.
 */
export function hasUnsafeMindbodyStateForDeny(
  ledger: Pick<
    BookingLedgerSafetyState,
    "intent" | "familyProvisioningStatus" | "enrollmentStatus" | "mindbodyMutationStatus"
  >,
): boolean {
  const enrollmentIsPreWrite =
    ledger.enrollmentStatus === "not_started" || ledger.enrollmentStatus === "service_verified";
  const familyIsSettled =
    ledger.intent !== "kid_trial" ||
    ledger.familyProvisioningStatus === "not_started" ||
    ledger.familyProvisioningStatus === "child_created";
  return (
    !enrollmentIsPreWrite ||
    ledger.mindbodyMutationStatus !== "not_started" ||
    !familyIsSettled
  );
}

export function isFamilyReadyForMindbodyMutation(
  ledger: Pick<BookingLedgerSafetyState, "intent" | "familyProvisioningStatus">,
): boolean {
  return ledger.intent !== "kid_trial" || ledger.familyProvisioningStatus === "child_created";
}

export function parseCheckoutTrialBookingResponse<T extends BookingEvidenceVisit>(
  payload: unknown,
  input: CheckoutBookingCoordinates,
): { saleId: number; serviceName: string; visit?: T } {
  const checkout = payload as {
    ShoppingCart?: {
      SaleId?: number;
      CartItems?: Array<{ Item?: { Name?: string } }>;
    };
    Classes?: Array<{ Id?: number; Visits?: T[] }>;
  };
  const cart = checkout.ShoppingCart;
  const visit = (checkout.Classes ?? [])
    .flatMap((classRecord) => classRecord.Visits ?? [])
    .find(
      (candidate) =>
        Number.isInteger(Number(candidate.Id)) &&
        Number(candidate.Id) > 0 &&
        Number(candidate.ClassId) === input.ClassId &&
        String(candidate.ClientId) === String(input.ClientId) &&
        Number(candidate.ProductId) === input.ServiceId,
    );
  return {
    saleId: cart?.SaleId ?? 0,
    serviceName: cart?.CartItems?.[0]?.Item?.Name ?? "trial service",
    visit,
  };
}

/** Return only evidence for the exact active booking represented by a Deal. */
export function findExactActiveClientVisit<T extends BookingEvidenceVisit>(
  visits: T[],
  criteria: ExactClientVisitCriteria,
): T | undefined {
  return visits.find((visit) => {
    const state = `${visit.AppointmentStatus ?? ""} ${visit.Status ?? ""}`.toLowerCase();
    if (!Number.isInteger(Number(visit.Id)) || Number(visit.Id) <= 0) return false;
    if (Number(visit.ClassId) !== criteria.classId) return false;
    if (String(visit.ClientId) !== String(criteria.clientId)) return false;
    if (Number(visit.SiteId) !== criteria.siteId) return false;
    if (
      criteria.locationId !== undefined &&
      Number(visit.LocationId) !== criteria.locationId
    ) {
      return false;
    }
    if (visit.LateCancelled || visit.Missed || visit.WaitlistEntryId) return false;
    if (state.includes("cancel") || state.includes("missed") || state.includes("waitlist")) {
      return false;
    }
    if (criteria.productId !== undefined && Number(visit.ProductId) !== criteria.productId) {
      return false;
    }
    if (criteria.productId !== undefined && !(Number(visit.ServiceId) > 0)) return false;
    if (criteria.serviceName !== undefined && visit.ServiceName !== criteria.serviceName) {
      return false;
    }
    if (
      criteria.clientServiceId !== undefined &&
      String(visit.ServiceId) !== String(criteria.clientServiceId)
    ) {
      return false;
    }
    return true;
  });
}
