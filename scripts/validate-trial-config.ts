/**
 * Static kids-trial configuration validation. This performs no network calls
 * and does not prove live Mindbody inventory or end-to-end launch readiness.
 */

type Location = {
  id: string;
  siteId: number;
  publicBookingEnabled: boolean;
  trialBookingEnabled: boolean;
  kidTrialProgramId?: number;
};

type TrialConfig = {
  trialEligibleClassScheduleIds: number[];
  maxTrialsPerClass: number;
  trialServiceId?: number;
  trialServiceName?: string;
  mindbodyGenderOptions?: readonly string[];
  parentGuardianRelationship?: {
    Id: number;
    RelationshipName1: string;
    RelationshipName2: string;
  };
};

type Pipeline = {
  pipelineId: string;
  stages: { requested: string; scheduled: string };
};

type Readiness = { ready: true } | { ready: false; missing: string[] };

async function main(): Promise<void> {
  const locationsUrl = new URL("../config/locations.ts", import.meta.url).href;
  const trialConfigUrl = new URL("../config/trial-config.ts", import.meta.url).href;
  const hubspotUrl = new URL("../config/hubspot-deals.ts", import.meta.url).href;
  const readinessUrl = new URL("../config/kids-trial-readiness.ts", import.meta.url).href;

  const [locationsModule, trialModule, hubspotModule, readinessModule] = await Promise.all([
    import(locationsUrl),
    import(trialConfigUrl),
    import(hubspotUrl),
    import(readinessUrl),
  ]);

  const locations = locationsModule.LOCATIONS as Location[];
  const trialConfigs = trialModule.TRIAL_CONFIG as Record<string, TrialConfig>;
  const pipelines = hubspotModule.DEAL_PIPELINES as Record<string, Pipeline>;
  const preferredLocations = hubspotModule.HUBSPOT_PREFERRED_LOCATION_LABEL as Record<string, string>;
  const getReadiness = readinessModule.getKidsTrialReadiness as (input: {
    location: Location;
    trialConfig?: TrialConfig;
    pipeline: Pipeline | null;
    preferredLocation?: string;
  }) => Readiness;

  const errors: string[] = [];
  const locationIds = new Set<string>();
  const siteIds = new Set<number>();

  for (const location of locations) {
    if (locationIds.has(location.id)) errors.push(`duplicate location id: ${location.id}`);
    if (siteIds.has(location.siteId)) errors.push(`duplicate Mindbody Site ID: ${location.siteId}`);
    locationIds.add(location.id);
    siteIds.add(location.siteId);

    const trialConfig = trialConfigs[location.id];
    if (!trialConfig) {
      errors.push(`${location.id}: missing TRIAL_CONFIG entry`);
      continue;
    }
    if (
      !Array.isArray(trialConfig.trialEligibleClassScheduleIds) ||
      trialConfig.trialEligibleClassScheduleIds.some(
        (id) => !Number.isInteger(id) || id <= 0,
      )
    ) {
      errors.push(`${location.id}: trialEligibleClassScheduleIds must contain positive integers`);
    }
    if (!Number.isInteger(trialConfig.maxTrialsPerClass) || trialConfig.maxTrialsPerClass <= 0) {
      errors.push(`${location.id}: maxTrialsPerClass must be a positive integer`);
    }

    const hasPipeline = Boolean(pipelines[location.id]);
    const hasPreferredLocation = Boolean(preferredLocations[location.id]?.trim());
    if (hasPipeline && !hasPreferredLocation) {
      errors.push(`${location.id}: HubSpot pipeline requires a preferred_location mapping`);
    }

    const readiness = getReadiness({
      location,
      trialConfig,
      pipeline: pipelines[location.id] ?? null,
      preferredLocation: preferredLocations[location.id],
    });
    if (location.trialBookingEnabled && !readiness.ready) {
      errors.push(`${location.id}: enabled but incomplete (${readiness.missing.join(", ")})`);
    }
  }

  for (const configId of Object.keys(trialConfigs)) {
    if (!locationIds.has(configId)) errors.push(`orphan TRIAL_CONFIG entry: ${configId}`);
  }
  for (const configId of new Set([
    ...Object.keys(pipelines),
    ...Object.keys(preferredLocations),
  ])) {
    if (!locationIds.has(configId)) errors.push(`orphan HubSpot location mapping: ${configId}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
    return;
  }

  const enabled = locations.filter((location) => location.trialBookingEnabled).map((location) => location.id);
  console.log(
    `Trial config valid: ${locations.length} locations; enabled: ${enabled.join(", ") || "none"}.`,
  );
  console.log("Static validation only; live Mindbody and end-to-end acceptance remain required.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "trial config validation failed");
  process.exitCode = 2;
});
