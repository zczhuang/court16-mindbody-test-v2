import type { DealPipelineConfig } from "./hubspot-deals";
import type { Location } from "./locations";
import type { LocationTrialConfig } from "./trial-config";

export type KidsTrialReadinessRequirement =
  | "public_launch_enabled"
  | "public_booking_enabled"
  | "trial_booking_enabled"
  | "mindbody_site_authorized"
  | "upcoming_trial_inventory_verified"
  | "hubspot_routing_verified"
  | "hubspot_deal_ledger_verified"
  | "durable_mutation_lock_verified"
  | "end_to_end_acceptance_passed"
  | "design_owner_approved"
  | "mindbody_program_id"
  | "mindbody_service_id"
  | "mindbody_service_name"
  | "mindbody_parent_guardian_relationship"
  | "mindbody_gender_options"
  | "hubspot_pipeline"
  | "hubspot_preferred_location";

export type KidsTrialCalendarPreviewRequirement =
  | "calendar_preview_enabled"
  | "mindbody_site_authorized";

export type KidsTrialCalendarPreviewScope = "trial_program" | "kids_schedule";

export type KidsTrialStaffReadinessRequirement =
  | "mindbody_site_authorized"
  | "hubspot_deal_ledger_verified"
  | "durable_mutation_lock_verified"
  | "end_to_end_acceptance_passed"
  | "mindbody_program_id"
  | "mindbody_service_id"
  | "mindbody_service_name"
  | "hubspot_pipeline";

type ReadyTrialConfig = LocationTrialConfig & {
  trialServiceId: number;
  trialServiceName: string;
  parentGuardianRelationship: NonNullable<LocationTrialConfig["parentGuardianRelationship"]>;
  mindbodyGenderOptions: NonNullable<LocationTrialConfig["mindbodyGenderOptions"]>;
};

type ReadyStaffTrialConfig = LocationTrialConfig & {
  trialServiceId: number;
  trialServiceName: string;
};

export type KidsTrialReadiness =
  | {
      ready: true;
      location: Location;
      programId: number;
      trialConfig: ReadyTrialConfig;
      pipeline: DealPipelineConfig;
      preferredLocation: string;
    }
  | {
      ready: false;
      location: Location;
      missing: KidsTrialReadinessRequirement[];
    };

export type KidsTrialStaffReadiness =
  | {
      ready: true;
      location: Location;
      programId: number;
      trialConfig: ReadyStaffTrialConfig;
      pipeline: DealPipelineConfig;
    }
  | {
      ready: false;
      location: Location;
      missing: KidsTrialStaffReadinessRequirement[];
    };

interface KidsTrialReadinessInput {
  location: Location;
  trialConfig?: LocationTrialConfig;
  pipeline: DealPipelineConfig | null;
  preferredLocation?: string;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasExactParentGuardianRelationship(
  relationship: LocationTrialConfig["parentGuardianRelationship"],
): relationship is NonNullable<LocationTrialConfig["parentGuardianRelationship"]> {
  return Boolean(
    relationship &&
      Number.isInteger(relationship.Id) &&
      hasText(relationship.RelationshipName1) &&
      hasText(relationship.RelationshipName2) &&
      /parent|guardian/i.test(relationship.RelationshipName1) &&
      /child|dependent/i.test(relationship.RelationshipName2),
  );
}

function hasMindbodyGenderOptions(
  options: LocationTrialConfig["mindbodyGenderOptions"],
): options is NonNullable<LocationTrialConfig["mindbodyGenderOptions"]> {
  return Boolean(options && options.length > 0 && new Set(options).size === options.length);
}

function hasExactPipeline(pipeline: DealPipelineConfig | null): pipeline is DealPipelineConfig {
  return Boolean(
    pipeline &&
      hasText(pipeline.pipelineId) &&
      hasText(pipeline.stages.requested) &&
      hasText(pipeline.stages.scheduled),
  );
}

/**
 * Resolve the complete static configuration required before a club can expose
 * kids-trial availability or accept a trial request. Live Mindbody inventory
 * and end-to-end acceptance remain separate launch checks.
 */
export function getKidsTrialReadiness({
  location,
  trialConfig,
  pipeline,
  preferredLocation,
}: KidsTrialReadinessInput): KidsTrialReadiness {
  const missing: KidsTrialReadinessRequirement[] = [];
  const evidence = location.trialLaunchEvidence;

  if (process.env.NEXT_PUBLIC_KIDS_TRIAL_PUBLIC_LAUNCH_ENABLED !== "true") {
    missing.push("public_launch_enabled");
  }
  if (!location.publicBookingEnabled) missing.push("public_booking_enabled");
  if (!location.trialBookingEnabled) missing.push("trial_booking_enabled");
  if (!evidence?.mindbodySiteAuthorized) missing.push("mindbody_site_authorized");
  if (!evidence?.upcomingTrialInventoryVerified) {
    missing.push("upcoming_trial_inventory_verified");
  }
  if (!evidence?.hubspotRoutingVerified) missing.push("hubspot_routing_verified");
  if (!evidence?.hubspotDealLedgerVerified) missing.push("hubspot_deal_ledger_verified");
  if (!evidence?.durableMutationLockVerified) missing.push("durable_mutation_lock_verified");
  if (!evidence?.endToEndAcceptancePassed) missing.push("end_to_end_acceptance_passed");
  if (!evidence?.designOwnerApproved) missing.push("design_owner_approved");
  if (!isPositiveInteger(location.kidTrialProgramId)) missing.push("mindbody_program_id");
  if (!isPositiveInteger(trialConfig?.trialServiceId)) missing.push("mindbody_service_id");
  if (!hasText(trialConfig?.trialServiceName)) missing.push("mindbody_service_name");
  if (!hasExactParentGuardianRelationship(trialConfig?.parentGuardianRelationship)) {
    missing.push("mindbody_parent_guardian_relationship");
  }
  if (!hasMindbodyGenderOptions(trialConfig?.mindbodyGenderOptions)) {
    missing.push("mindbody_gender_options");
  }
  if (!hasExactPipeline(pipeline)) missing.push("hubspot_pipeline");
  if (!hasText(preferredLocation)) missing.push("hubspot_preferred_location");

  if (missing.length > 0) return { ready: false, location, missing };

  return {
    ready: true,
    location,
    programId: location.kidTrialProgramId!,
    trialConfig: {
      ...trialConfig!,
      trialServiceId: trialConfig!.trialServiceId!,
      trialServiceName: trialConfig!.trialServiceName!,
      parentGuardianRelationship: trialConfig!.parentGuardianRelationship!,
      mindbodyGenderOptions: trialConfig!.mindbodyGenderOptions!,
    },
    pipeline: pipeline!,
    preferredLocation: preferredLocation!,
  };
}

/**
 * Resolve the narrower safety boundary for completing a request that already
 * reached `pending_staff`. Public-launch, current inventory, and design gates
 * intentionally do not apply here: operators must be able to stop new intake
 * without stranding an in-flight booking. The current server-side Mindbody
 * write allowlist remains a separate mandatory check at the mutation point.
 */
/**
 * Browse-only calendar preview: strictly weaker than public readiness and
 * never a booking gate. It only decides whether parents may SEE this club's
 * explicitly enabled calendar before the full launch checklist passes. A
 * dedicated trial Program is preferred; otherwise the caller may read only
 * the site-scoped regular-kids Program allowlist. An empty allowlist produces
 * an honest empty calendar and never falls back to a broad class query.
 */
export function getKidsTrialCalendarPreviewReadiness({
  location,
}: Pick<KidsTrialReadinessInput, "location">):
  | {
      ready: true;
      location: Location;
      scope: KidsTrialCalendarPreviewScope;
      programIds: number[];
    }
  | { ready: false; location: Location; missing: KidsTrialCalendarPreviewRequirement[] } {
  const missing: KidsTrialCalendarPreviewRequirement[] = [];
  if (location.trialCalendarPreviewEnabled !== true) missing.push("calendar_preview_enabled");
  if (!location.trialLaunchEvidence?.mindbodySiteAuthorized) {
    missing.push("mindbody_site_authorized");
  }
  if (missing.length > 0) return { ready: false, location, missing };

  if (isPositiveInteger(location.kidTrialProgramId)) {
    return {
      ready: true,
      location,
      scope: "trial_program",
      programIds: [location.kidTrialProgramId],
    };
  }

  const programIds = Array.from(
    new Set((location.kidsCalendarProgramIds ?? []).filter(isPositiveInteger)),
  );
  return { ready: true, location, scope: "kids_schedule", programIds };
}

export function getKidsTrialStaffReadiness({
  location,
  trialConfig,
  pipeline,
}: Omit<KidsTrialReadinessInput, "preferredLocation">): KidsTrialStaffReadiness {
  const missing: KidsTrialStaffReadinessRequirement[] = [];
  const evidence = location.trialLaunchEvidence;

  if (!evidence?.mindbodySiteAuthorized) missing.push("mindbody_site_authorized");
  if (!evidence?.hubspotDealLedgerVerified) missing.push("hubspot_deal_ledger_verified");
  if (!evidence?.durableMutationLockVerified) missing.push("durable_mutation_lock_verified");
  if (!evidence?.endToEndAcceptancePassed) missing.push("end_to_end_acceptance_passed");
  if (!isPositiveInteger(location.kidTrialProgramId)) missing.push("mindbody_program_id");
  if (!isPositiveInteger(trialConfig?.trialServiceId)) missing.push("mindbody_service_id");
  if (!hasText(trialConfig?.trialServiceName)) missing.push("mindbody_service_name");
  if (!hasExactPipeline(pipeline)) missing.push("hubspot_pipeline");

  if (missing.length > 0) return { ready: false, location, missing };

  return {
    ready: true,
    location,
    programId: location.kidTrialProgramId!,
    trialConfig: {
      ...trialConfig!,
      trialServiceId: trialConfig!.trialServiceId!,
      trialServiceName: trialConfig!.trialServiceName!,
    },
    pipeline: pipeline!,
  };
}
