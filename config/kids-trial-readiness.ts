import type { DealPipelineConfig } from "./hubspot-deals";
import type { Location } from "./locations";
import type { LocationTrialConfig } from "./trial-config";

export type KidsTrialReadinessRequirement =
  | "public_booking_enabled"
  | "trial_booking_enabled"
  | "mindbody_program_id"
  | "mindbody_service_id"
  | "mindbody_service_name"
  | "mindbody_parent_guardian_relationship"
  | "mindbody_gender_options"
  | "hubspot_pipeline"
  | "hubspot_preferred_location";

type ReadyTrialConfig = LocationTrialConfig & {
  trialServiceId: number;
  trialServiceName: string;
  parentGuardianRelationship: NonNullable<LocationTrialConfig["parentGuardianRelationship"]>;
  mindbodyGenderOptions: NonNullable<LocationTrialConfig["mindbodyGenderOptions"]>;
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

  if (!location.publicBookingEnabled) missing.push("public_booking_enabled");
  if (!location.trialBookingEnabled) missing.push("trial_booking_enabled");
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
