/**
 * HubSpot Deal-scoped booking ledger.
 *
 * A Contact represents a person and can be reused across clubs and children.
 * A Deal represents one booking request, so site-scoped Mindbody IDs and
 * enrollment evidence belong here. Ledger-v1 code updates only person-scoped
 * Contact profile fields; existing request-state mirrors are legacy data and
 * are never used or refreshed by staff actions.
 */

export const HUBSPOT_BOOKING_LEDGER_VERSION = "1";
export const HUBSPOT_BOOKING_PROPERTY_GROUP = "court16_booking";

/**
 * Legacy portal-defined Deal properties the runtime writes to but does not
 * own. They pre-date the ledger (created for the original trial pipeline), so
 * the schema sync script must verify they exist rather than define them —
 * defining them here with a guessed type could conflict with the live portal
 * definitions and block an otherwise-safe additive apply.
 */
export const HUBSPOT_REQUIRED_EXTERNAL_DEAL_PROPERTIES = [
  "class_date",
  "denial_reason",
  "denial_note",
] as const;

export type BookingIntent = "kid_trial" | "adult_intro";

export type BookingDealStatus =
  | "intake_started"
  | "pending_staff"
  | "pending_staff_assist"
  | "pending_payment"
  | "confirmed"
  | "denied"
  | "failed"
  | "duplicate_email_softwall"
  | "manual_review";

export type FamilyAccountStatus =
  | "parent_claim_pending"
  | "parent_claimed"
  | "child_link_pending"
  | "family_complete"
  | "manual_review";

/**
 * Write-ahead state for the two irreversible AddClient calls. This is kept
 * separate from FamilyAccountStatus: creating/linking Mindbody client records
 * does not prove that the parent has claimed the consumer family account.
 */
export type FamilyProvisioningStatus =
  | "not_started"
  | "parent_create_started"
  | "parent_created"
  | "child_create_started"
  | "child_created"
  | "reconciliation_required";

export type EnrollmentStatus =
  | "not_started"
  | "checkout_started"
  | "service_verified"
  | "enrollment_started"
  | "enrollment_verified"
  | "reconciliation_required";

export type MindbodyMutationStatus =
  | "not_started"
  | "checkout_started"
  | "add_to_class_started"
  | "reconciliation_required"
  | "verified"
  | "manual_review";

export interface BookingDealLedgerPatch {
  correlationId: string;
  activeParentKey?: string;
  intent: BookingIntent;
  bookingStatus: BookingDealStatus;
  testRecord?: string;
  locationSlug: string;
  mindbodySiteId: string | number;
  mindbodyLocationId?: string | number;
  mindbodyProgramId?: string | number;
  classId?: string | number;
  classScheduleId?: string | number;
  className?: string;
  classDayTime?: string;
  coachName?: string;
  parentEmail?: string;
  childFirstName?: string;
  childLastName?: string;
  childBirthDate?: string;
  waiverVersion?: string;
  staffConfirmUrl?: string;
  staffReassignUrl?: string;
  staffDenyUrl?: string;
  mindbodyParentId?: string | number;
  mindbodyChildId?: string | number;
  familyAccountStatus?: FamilyAccountStatus;
  familyProvisioningStatus?: FamilyProvisioningStatus;
  familyProvisioningStartedAt?: string | number | Date;
  failureReason?: string;
  mindbodyServiceId?: string | number;
  mindbodyServiceName?: string;
  mindbodyClientServiceId?: string | number;
  mindbodySaleId?: string | number;
  mindbodyVisitId?: string | number;
  enrollmentVerifiedAt?: string | number | Date;
  enrollmentStatus?: EnrollmentStatus;
  mindbodyMutationStatus?: MindbodyMutationStatus;
  mindbodyMutationStartedAt?: string | number | Date;
}

export interface ParsedBookingDealLedger {
  version: typeof HUBSPOT_BOOKING_LEDGER_VERSION;
  bookingKey: string;
  correlationId: string;
  activeParentKey?: string;
  intent: BookingIntent;
  bookingStatus: BookingDealStatus;
  testRecord?: string;
  locationSlug: string;
  mindbodySiteId: string;
  mindbodyLocationId?: string;
  mindbodyProgramId?: string;
  classId?: string;
  classScheduleId?: string;
  className?: string;
  classDayTime?: string;
  coachName?: string;
  parentEmail?: string;
  childFirstName?: string;
  childLastName?: string;
  childBirthDate?: string;
  waiverVersion?: string;
  classDate?: string;
  staffConfirmUrl?: string;
  staffReassignUrl?: string;
  staffDenyUrl?: string;
  mindbodyParentId?: string;
  mindbodyChildId?: string;
  familyAccountStatus?: FamilyAccountStatus;
  familyProvisioningStatus?: FamilyProvisioningStatus;
  familyProvisioningStartedAt?: string;
  failureReason?: string;
  mindbodyServiceId?: string;
  mindbodyServiceName?: string;
  mindbodyClientServiceId?: string;
  mindbodySaleId?: string;
  mindbodyVisitId?: string;
  enrollmentVerifiedAt?: string;
  enrollmentStatus?: EnrollmentStatus;
  mindbodyMutationStatus?: MindbodyMutationStatus;
  mindbodyMutationStartedAt?: string;
}

export type BookingDealLedgerParseResult =
  | { ok: true; value: ParsedBookingDealLedger }
  | { ok: false; missing: string[] };

export class HubspotDealConflictError extends Error {
  readonly mismatches: string[];

  constructor(mismatches: string[]) {
    super(`Existing HubSpot Deal does not match this booking: ${mismatches.join(", ")}`);
    this.name = "HubspotDealConflictError";
    this.mismatches = mismatches;
  }
}

const INTENTS = new Set<BookingIntent>(["kid_trial", "adult_intro"]);
const STATUSES = new Set<BookingDealStatus>([
  "intake_started",
  "pending_staff",
  "pending_staff_assist",
  "pending_payment",
  "confirmed",
  "denied",
  "failed",
  "duplicate_email_softwall",
  "manual_review",
]);
const FAMILY_STATUSES = new Set<FamilyAccountStatus>([
  "parent_claim_pending",
  "parent_claimed",
  "child_link_pending",
  "family_complete",
  "manual_review",
]);
const FAMILY_PROVISIONING_STATUSES = new Set<FamilyProvisioningStatus>([
  "not_started",
  "parent_create_started",
  "parent_created",
  "child_create_started",
  "child_created",
  "reconciliation_required",
]);
const ENROLLMENT_STATUSES = new Set<EnrollmentStatus>([
  "not_started",
  "checkout_started",
  "service_verified",
  "enrollment_started",
  "enrollment_verified",
  "reconciliation_required",
]);
const MINDBODY_MUTATION_STATUSES = new Set<MindbodyMutationStatus>([
  "not_started",
  "checkout_started",
  "add_to_class_started",
  "reconciliation_required",
  "verified",
  "manual_review",
]);

const LOCATION_SLUGS = [
  "allston",
  "brooklyn",
  "fishtown",
  "lic",
  "fidi",
  "newton",
  "ridgehill",
] as const;

export function buildBookingDealProperties(
  ledger: BookingDealLedgerPatch,
): Record<string, string | undefined> {
  return {
    court16_booking_ledger_version: HUBSPOT_BOOKING_LEDGER_VERSION,
    court16_booking_key: clean(ledger.correlationId),
    court16_correlation_id: clean(ledger.correlationId),
    court16_active_parent_key: clean(ledger.activeParentKey),
    court16_intent: ledger.intent,
    court16_booking_status: ledger.bookingStatus,
    court16_test_record: clean(ledger.testRecord),
    court16_location_slug: clean(ledger.locationSlug),
    court16_mindbody_site_id: stringify(ledger.mindbodySiteId),
    court16_mindbody_location_id: stringify(ledger.mindbodyLocationId),
    court16_mindbody_program_id: stringify(ledger.mindbodyProgramId),
    court16_class_id: stringify(ledger.classId),
    court16_class_schedule_id: stringify(ledger.classScheduleId),
    court16_class_name: clean(ledger.className),
    court16_class_day_time: clean(ledger.classDayTime),
    court16_coach_name: clean(ledger.coachName),
    court16_parent_email: clean(ledger.parentEmail)?.toLowerCase(),
    court16_child_first_name: clean(ledger.childFirstName),
    court16_child_last_name: clean(ledger.childLastName),
    court16_child_birth_date: dateToEpochMs(ledger.childBirthDate),
    court16_waiver_version: clean(ledger.waiverVersion),
    court16_staff_confirm_url: clean(ledger.staffConfirmUrl),
    court16_staff_reassign_url: clean(ledger.staffReassignUrl),
    court16_staff_deny_url: clean(ledger.staffDenyUrl),
    court16_mindbody_parent_id: stringify(ledger.mindbodyParentId),
    court16_mindbody_child_id: stringify(ledger.mindbodyChildId),
    court16_family_account_status: ledger.familyAccountStatus,
    court16_family_provisioning_status: ledger.familyProvisioningStatus,
    court16_family_provisioning_started_at: datetimeToEpochMs(
      ledger.familyProvisioningStartedAt,
    ),
    court16_failure_reason: clean(ledger.failureReason),
    court16_mindbody_service_id: stringify(ledger.mindbodyServiceId),
    court16_mindbody_service_name: clean(ledger.mindbodyServiceName),
    court16_mindbody_client_service_id: stringify(ledger.mindbodyClientServiceId),
    court16_mindbody_sale_id: stringifyPositive(ledger.mindbodySaleId),
    court16_mindbody_visit_id: stringifyPositive(ledger.mindbodyVisitId),
    court16_enrollment_verified_at: datetimeToEpochMs(ledger.enrollmentVerifiedAt),
    court16_enrollment_status: ledger.enrollmentStatus,
    court16_mindbody_mutation_status: ledger.mindbodyMutationStatus,
    court16_mindbody_mutation_started_at: datetimeToEpochMs(
      ledger.mindbodyMutationStartedAt,
    ),
  };
}

export function parseBookingDealLedger(
  properties: Record<string, string | undefined>,
): BookingDealLedgerParseResult {
  const version = clean(properties.court16_booking_ledger_version);
  const bookingKey = clean(properties.court16_booking_key);
  const correlationId = clean(properties.court16_correlation_id);
  const intent = clean(properties.court16_intent);
  const bookingStatus = clean(properties.court16_booking_status);
  const locationSlug = clean(properties.court16_location_slug);
  const mindbodySiteId = clean(properties.court16_mindbody_site_id);

  const missing: string[] = [];
  if (version !== HUBSPOT_BOOKING_LEDGER_VERSION) missing.push("court16_booking_ledger_version");
  if (!bookingKey) missing.push("court16_booking_key");
  if (!correlationId) missing.push("court16_correlation_id");
  if (bookingKey && correlationId && bookingKey !== correlationId) {
    missing.push("court16_booking_key=court16_correlation_id");
  }
  if (!intent || !INTENTS.has(intent as BookingIntent)) missing.push("court16_intent");
  if (!bookingStatus || !STATUSES.has(bookingStatus as BookingDealStatus)) {
    missing.push("court16_booking_status");
  }
  if (!locationSlug) missing.push("court16_location_slug");
  if (!mindbodySiteId) missing.push("court16_mindbody_site_id");
  if (missing.length > 0) return { ok: false, missing };

  const familyAccountStatus = clean(properties.court16_family_account_status);
  const familyProvisioningStatus = clean(properties.court16_family_provisioning_status);
  const enrollmentStatus = clean(properties.court16_enrollment_status);
  const mindbodyMutationStatus = clean(properties.court16_mindbody_mutation_status);
  return {
    ok: true,
    value: {
      version: HUBSPOT_BOOKING_LEDGER_VERSION,
      bookingKey: bookingKey!,
      correlationId: correlationId!,
      activeParentKey: clean(properties.court16_active_parent_key),
      intent: intent as BookingIntent,
      bookingStatus: bookingStatus as BookingDealStatus,
      testRecord: clean(properties.court16_test_record),
      locationSlug: locationSlug!,
      mindbodySiteId: mindbodySiteId!,
      mindbodyLocationId: clean(properties.court16_mindbody_location_id),
      mindbodyProgramId: clean(properties.court16_mindbody_program_id),
      classId: clean(properties.court16_class_id),
      classScheduleId: clean(properties.court16_class_schedule_id),
      className: clean(properties.court16_class_name),
      classDayTime: clean(properties.court16_class_day_time),
      coachName: clean(properties.court16_coach_name),
      parentEmail: clean(properties.court16_parent_email),
      childFirstName: clean(properties.court16_child_first_name),
      childLastName: clean(properties.court16_child_last_name),
      childBirthDate: clean(properties.court16_child_birth_date),
      waiverVersion: clean(properties.court16_waiver_version),
      classDate: clean(properties.class_date),
      staffConfirmUrl: clean(properties.court16_staff_confirm_url),
      staffReassignUrl: clean(properties.court16_staff_reassign_url),
      staffDenyUrl: clean(properties.court16_staff_deny_url),
      mindbodyParentId: clean(properties.court16_mindbody_parent_id),
      mindbodyChildId: clean(properties.court16_mindbody_child_id),
      familyAccountStatus:
        familyAccountStatus && FAMILY_STATUSES.has(familyAccountStatus as FamilyAccountStatus)
          ? (familyAccountStatus as FamilyAccountStatus)
          : undefined,
      familyProvisioningStatus:
        familyProvisioningStatus &&
        FAMILY_PROVISIONING_STATUSES.has(
          familyProvisioningStatus as FamilyProvisioningStatus,
        )
          ? (familyProvisioningStatus as FamilyProvisioningStatus)
          : undefined,
      familyProvisioningStartedAt: clean(
        properties.court16_family_provisioning_started_at,
      ),
      failureReason: clean(properties.court16_failure_reason),
      mindbodyServiceId: clean(properties.court16_mindbody_service_id),
      mindbodyServiceName: clean(properties.court16_mindbody_service_name),
      mindbodyClientServiceId: clean(properties.court16_mindbody_client_service_id),
      mindbodySaleId: clean(properties.court16_mindbody_sale_id),
      mindbodyVisitId: clean(properties.court16_mindbody_visit_id),
      enrollmentVerifiedAt: clean(properties.court16_enrollment_verified_at),
      enrollmentStatus:
        enrollmentStatus && ENROLLMENT_STATUSES.has(enrollmentStatus as EnrollmentStatus)
          ? (enrollmentStatus as EnrollmentStatus)
          : undefined,
      mindbodyMutationStatus:
        mindbodyMutationStatus &&
        MINDBODY_MUTATION_STATUSES.has(mindbodyMutationStatus as MindbodyMutationStatus)
          ? (mindbodyMutationStatus as MindbodyMutationStatus)
          : undefined,
      mindbodyMutationStartedAt: clean(properties.court16_mindbody_mutation_started_at),
    },
  };
}

/**
 * State-specific completeness check. Parsing only proves that a Deal claims
 * ledger v1; staff actions must also prove that every immutable Mindbody
 * coordinate needed for that lifecycle state is present on the Deal itself.
 */
export function validateBookingDealLedgerForState(
  ledger: ParsedBookingDealLedger,
): string[] {
  const missing: string[] = [];
  const require = (value: string | undefined, property: string) => {
    if (!value) missing.push(property);
  };

  require(ledger.classId, "court16_class_id");
  require(ledger.classScheduleId, "court16_class_schedule_id");
  require(ledger.classDate, "class_date");
  require(ledger.parentEmail, "court16_parent_email");

  if (ledger.intent === "kid_trial") {
    require(ledger.mindbodyProgramId, "court16_mindbody_program_id");
    require(ledger.mindbodyLocationId, "court16_mindbody_location_id");
    require(ledger.mindbodyServiceId, "court16_mindbody_service_id");
    require(ledger.mindbodyServiceName, "court16_mindbody_service_name");
    require(ledger.childFirstName, "court16_child_first_name");
    require(ledger.childLastName, "court16_child_last_name");
    require(ledger.childBirthDate, "court16_child_birth_date");
  }

  if (
    ledger.bookingStatus === "pending_staff" ||
    ledger.bookingStatus === "confirmed" ||
    ledger.bookingStatus === "manual_review"
  ) {
    if (!ledger.enrollmentStatus) missing.push("court16_enrollment_status");
    if (!ledger.mindbodyMutationStatus) missing.push("court16_mindbody_mutation_status");
    if (ledger.intent === "kid_trial") {
      require(ledger.mindbodyParentId, "court16_mindbody_parent_id");
      require(ledger.mindbodyChildId, "court16_mindbody_child_id");
      if (ledger.bookingStatus === "pending_staff") {
        require(ledger.activeParentKey, "court16_active_parent_key");
      }
      if (!ledger.familyProvisioningStatus) {
        missing.push("court16_family_provisioning_status");
      } else if (
        (ledger.bookingStatus === "pending_staff" || ledger.bookingStatus === "confirmed") &&
        ledger.familyProvisioningStatus !== "child_created"
      ) {
        missing.push("court16_family_provisioning_status=child_created");
      }
    } else {
      require(ledger.mindbodyParentId, "court16_mindbody_parent_id");
    }
    require(ledger.staffConfirmUrl, "court16_staff_confirm_url");
    require(ledger.staffReassignUrl, "court16_staff_reassign_url");
    require(ledger.staffDenyUrl, "court16_staff_deny_url");
  }

  if (ledger.bookingStatus === "confirmed") {
    if (ledger.enrollmentStatus !== "enrollment_verified") {
      missing.push("court16_enrollment_status=enrollment_verified");
    }
    if (ledger.mindbodyMutationStatus !== "verified") {
      missing.push("court16_mindbody_mutation_status=verified");
    }
    require(ledger.mindbodyVisitId, "court16_mindbody_visit_id");
    if (ledger.intent === "kid_trial") {
      require(ledger.mindbodyClientServiceId, "court16_mindbody_client_service_id");
    }
    require(ledger.enrollmentVerifiedAt, "court16_enrollment_verified_at");
  }

  if (
    (ledger.bookingStatus === "failed" || ledger.bookingStatus === "manual_review") &&
    !ledger.failureReason
  ) {
    missing.push("court16_failure_reason");
  }

  return [...new Set(missing)];
}

const IDEMPOTENT_DEAL_IMMUTABLE_PROPERTIES = [
  "court16_booking_ledger_version",
  "court16_booking_key",
  "court16_correlation_id",
  "court16_intent",
  "court16_location_slug",
  "court16_mindbody_site_id",
  "court16_mindbody_location_id",
  "court16_mindbody_program_id",
  "court16_mindbody_service_id",
  "court16_mindbody_service_name",
  "court16_class_id",
  "court16_class_schedule_id",
  "court16_parent_email",
  "court16_child_first_name",
  "court16_child_last_name",
  "court16_child_birth_date",
  "court16_waiver_version",
  "class_date",
] as const;

/** Pure guard used by both HubSpot search-hit and unique-conflict paths. */
export function assertExistingTrialDealMatches(
  existing: {
    properties: Record<string, string | undefined>;
    associatedContactIds: string[];
  },
  args: { contactId: string; correlationId: string; pipelineId: string },
  requestedProperties: Record<string, string>,
): void {
  const mismatches: string[] = [];
  if (existing.properties.pipeline !== args.pipelineId) mismatches.push("pipeline");
  if (
    existing.associatedContactIds.length !== 1 ||
    existing.associatedContactIds[0] !== args.contactId
  ) {
    mismatches.push("associated_contact");
  }

  for (const property of IDEMPOTENT_DEAL_IMMUTABLE_PROPERTIES) {
    const requested = requestedProperties[property];
    if (requested === undefined) continue;
    if (!immutableValuesMatch(property, existing.properties[property], requested)) {
      mismatches.push(property);
    }
  }

  if (existing.properties.court16_correlation_id !== args.correlationId) {
    mismatches.push("court16_correlation_id");
  }
  if (mismatches.length > 0) {
    throw new HubspotDealConflictError([...new Set(mismatches)]);
  }
}

function immutableValuesMatch(
  property: (typeof IDEMPOTENT_DEAL_IMMUTABLE_PROPERTIES)[number],
  current: string | undefined,
  requested: string,
): boolean {
  if (current === undefined) return false;
  if (property === "court16_parent_email") {
    return current.trim().toLowerCase() === requested.trim().toLowerCase();
  }
  if (property === "court16_child_birth_date" || property === "class_date") {
    const currentTime = temporalValue(current);
    const requestedTime = temporalValue(requested);
    return currentTime !== undefined && requestedTime !== undefined && currentTime === requestedTime;
  }
  return current === requested;
}

function temporalValue(value: string): number | undefined {
  const milliseconds = /^\d+$/.test(value.trim()) ? Number(value) : Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

export const HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES = [
  "court16_booking_ledger_version",
  "court16_booking_key",
  "court16_correlation_id",
  "court16_active_parent_key",
  "court16_intent",
  "court16_booking_status",
  "court16_test_record",
  "court16_failure_reason",
  "court16_location_slug",
  "court16_mindbody_site_id",
  "court16_mindbody_location_id",
  "court16_mindbody_program_id",
  "court16_class_id",
  "court16_class_schedule_id",
  "court16_class_name",
  "court16_class_day_time",
  "court16_coach_name",
  "court16_parent_email",
  "court16_child_first_name",
  "court16_child_last_name",
  "court16_child_birth_date",
  "court16_waiver_version",
  "court16_staff_confirm_url",
  "court16_staff_reassign_url",
  "court16_staff_deny_url",
  "court16_mindbody_parent_id",
  "court16_mindbody_child_id",
  "court16_family_account_status",
  "court16_family_provisioning_status",
  "court16_family_provisioning_started_at",
  "court16_mindbody_service_id",
  "court16_mindbody_service_name",
  "court16_mindbody_client_service_id",
  "court16_mindbody_sale_id",
  "court16_mindbody_visit_id",
  "court16_enrollment_verified_at",
  "court16_enrollment_status",
  "court16_mindbody_mutation_status",
  "court16_mindbody_mutation_started_at",
] as const;

export interface HubspotDealPropertyDefinition {
  name: (typeof HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES)[number];
  label: string;
  type: "string" | "enumeration" | "date" | "datetime";
  fieldType: "text" | "textarea" | "select" | "date";
  description: string;
  options?: Array<{ label: string; value: string; displayOrder: number; hidden: false }>;
  hasUniqueValue?: boolean;
}

function enumOptions(values: readonly string[]): NonNullable<HubspotDealPropertyDefinition["options"]> {
  return values.map((value, displayOrder) => ({
    label: value.replaceAll("_", " "),
    value,
    displayOrder,
    hidden: false,
  }));
}

const text = (
  name: HubspotDealPropertyDefinition["name"],
  label: string,
  description: string,
  fieldType: "text" | "textarea" = "text",
): HubspotDealPropertyDefinition => ({ name, label, type: "string", fieldType, description });

export const HUBSPOT_BOOKING_DEAL_PROPERTY_DEFINITIONS: readonly HubspotDealPropertyDefinition[] = [
  text("court16_booking_ledger_version", "Court 16 booking ledger version", "Schema version for the Deal-scoped booking ledger."),
  {
    ...text("court16_booking_key", "Court 16 booking key", "Unique browser-generated UUID for one logical booking submission."),
    hasUniqueValue: true,
  },
  text("court16_correlation_id", "Court 16 correlation ID", "Request reference mirrored to legacy Contact workflows; booking-key uniqueness is separate."),
  {
    ...text("court16_active_parent_key", "Court 16 active parent key", "Unique SHA-256 key held only while this parent email has an active booking request."),
    hasUniqueValue: true,
  },
  {
    name: "court16_intent",
    label: "Court 16 intent",
    type: "enumeration",
    fieldType: "select",
    description: "Booking product represented by this Deal.",
    options: enumOptions([...INTENTS]),
  },
  {
    name: "court16_booking_status",
    label: "Court 16 booking status",
    type: "enumeration",
    fieldType: "select",
    description: "Authoritative lifecycle state for this booking request.",
    options: enumOptions([...STATUSES]),
  },
  {
    ...text(
      "court16_test_record",
      "Court 16 test record",
      "True only when this Deal came from an internal smoke test, never from a real family.",
    ),
    type: "enumeration",
    fieldType: "select",
    options: enumOptions(["true", "false"]),
  },
  text("court16_failure_reason", "Court 16 failure reason", "Retry, denial, or reconciliation detail for this request.", "textarea"),
  {
    name: "court16_location_slug",
    label: "Court 16 location slug",
    type: "enumeration",
    fieldType: "select",
    description: "Application location slug for this booking.",
    options: enumOptions(LOCATION_SLUGS),
  },
  text("court16_mindbody_site_id", "Court 16 Mindbody Site ID", "Mindbody Site ID that owns every Mindbody identifier on this Deal."),
  text("court16_mindbody_location_id", "Court 16 Mindbody location ID", "Mindbody Location ID on the selected class occurrence and checkout sale."),
  text("court16_mindbody_program_id", "Court 16 Mindbody Program ID", "Mindbody Program used for this trial."),
  text("court16_class_id", "Court 16 class ID", "Mindbody per-occurrence Class ID used for enrollment."),
  text("court16_class_schedule_id", "Court 16 class schedule ID", "Mindbody recurring ClassSchedule ID selected by the family."),
  text("court16_class_name", "Court 16 class name", "Mindbody-owned class description read at intake."),
  text("court16_class_day_time", "Court 16 class day/time", "Human-readable club-local class time."),
  text("court16_coach_name", "Court 16 coach name", "Mindbody-owned staff display name."),
  text("court16_parent_email", "Court 16 parent email", "Normalized parent email captured for this booking."),
  text("court16_child_first_name", "Court 16 child first name", "Child identity for this booking; do not infer from the mutable Contact mirror."),
  text("court16_child_last_name", "Court 16 child last name", "Child identity for this booking."),
  {
    name: "court16_child_birth_date",
    label: "Court 16 child birth date",
    type: "date",
    fieldType: "date",
    description: "UTC-midnight date captured at intake.",
  },
  text("court16_waiver_version", "Court 16 waiver version", "Waiver version accepted with this booking."),
  text("court16_staff_confirm_url", "Court 16 staff confirm URL", "Signed, request-scoped staff confirmation URL."),
  text("court16_staff_reassign_url", "Court 16 staff reassign URL", "Signed, request-scoped staff manual-review URL."),
  text("court16_staff_deny_url", "Court 16 staff deny URL", "Signed, request-scoped staff denial URL."),
  text("court16_mindbody_parent_id", "Court 16 Mindbody parent ID", "Site-scoped original parent Client ID."),
  text("court16_mindbody_child_id", "Court 16 Mindbody child ID", "Site-scoped original child Client ID used for enrollment and family completion."),
  {
    name: "court16_family_account_status",
    label: "Court 16 family account status",
    type: "enumeration",
    fieldType: "select",
    description: "Evidence-backed family-account state for the original child on this Deal.",
    options: enumOptions([...FAMILY_STATUSES]),
  },
  {
    name: "court16_family_provisioning_status",
    label: "Court 16 family provisioning status",
    type: "enumeration",
    fieldType: "select",
    description: "Write-ahead state for creating and linking the original parent and child Mindbody records.",
    options: enumOptions([...FAMILY_PROVISIONING_STATUSES]),
  },
  {
    name: "court16_family_provisioning_started_at",
    label: "Court 16 family provisioning started at",
    type: "datetime",
    fieldType: "date",
    description: "UTC instant persisted before the first irreversible family-record mutation.",
  },
  text("court16_mindbody_service_id", "Court 16 Mindbody service ID", "Configured sale Service/pricing-option ID."),
  text("court16_mindbody_service_name", "Court 16 Mindbody service name", "Exact configured trial pricing-option name used for verification."),
  text("court16_mindbody_client_service_id", "Court 16 Mindbody ClientService ID", "Client-owned service-credit instance used for enrollment."),
  text("court16_mindbody_sale_id", "Court 16 Mindbody Sale ID", "Checkout sale ID when this booking created the trial credit."),
  text("court16_mindbody_visit_id", "Court 16 Mindbody Visit ID", "Verified Visit ID for the original client and class occurrence."),
  {
    name: "court16_enrollment_verified_at",
    label: "Court 16 enrollment verified at",
    type: "datetime",
    fieldType: "date",
    description: "UTC instant when the app read the exact active Mindbody visit back.",
  },
  {
    name: "court16_enrollment_status",
    label: "Court 16 enrollment status",
    type: "enumeration",
    fieldType: "select",
    description: "Readback-backed progress of the Mindbody service and enrollment writes.",
    options: enumOptions([...ENROLLMENT_STATUSES]),
  },
  {
    name: "court16_mindbody_mutation_status",
    label: "Court 16 Mindbody mutation status",
    type: "enumeration",
    fieldType: "select",
    description: "Write-ahead guard for checkout or class-enrollment mutations.",
    options: enumOptions([...MINDBODY_MUTATION_STATUSES]),
  },
  {
    name: "court16_mindbody_mutation_started_at",
    label: "Court 16 Mindbody mutation started at",
    type: "datetime",
    fieldType: "date",
    description: "UTC instant persisted before an irreversible Mindbody call.",
  },
] as const;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stringify(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return clean(String(value));
}

function stringifyPositive(value: string | number | undefined): string | undefined {
  const stringValue = stringify(value);
  return stringValue && Number(stringValue) > 0 ? stringValue : undefined;
}

function datetimeToEpochMs(value: string | number | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : /^\d+$/.test(value.trim())
          ? Number(value)
          : Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? String(Math.trunc(milliseconds)) : undefined;
}

function dateToEpochMs(value: string | undefined): string | undefined {
  const cleaned = clean(value);
  if (!cleaned || !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return undefined;
  const milliseconds = Date.parse(`${cleaned}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) ? String(milliseconds) : undefined;
}
