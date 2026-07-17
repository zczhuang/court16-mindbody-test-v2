/**
 * Per-location HubSpot Deal pipeline + stage IDs.
 *
 * Court 16 already runs 6 location-specific trial pipelines in HubSpot
 * (KID TRIALS (BK), KIDS TRIAL (LIC), KIDS TRIAL (FIDI), KIDS TRIAL
 * (RIDGE HILL), KIDS TRIAL (NEWTON), KIDS TRIAL (FISHTOWN)). Each has
 * a 7-stage flow that staff use today. Rather than create a parallel
 * "Trials" pipeline, the booking app threads new Deals into the
 * matching per-location pipeline at submit time.
 *
 * IDs below were captured live from HubSpot on 2026-05-12. If staff
 * archives or recreates a pipeline these will need re-capturing — the
 * code degrades gracefully: missing entries fall back to `default`
 * (the BK pipeline, which lives on the HubSpot default Deal pipeline
 * slot).
 */

export interface DealPipelineConfig {
  /** HubSpot pipeline ID (number-string except for the default BK pipeline). */
  pipelineId: string;
  /** Stage IDs we use directly from the app. */
  stages: {
    /** Where a Deal lands on form submit. */
    requested: string;
    /** Where staff-confirm / intro-confirm moves a Deal to. */
    scheduled: string;
  };
}

/**
 * Keyed by `Location.id` in `config/locations.ts`. A location must remain
 * disabled until it has an explicit entry; never route a missing club to a
 * different pipeline by default. Allston is intentionally absent pending
 * verified pipeline and stage IDs.
 */
export const DEAL_PIPELINES: Record<string, DealPipelineConfig> = {
  brooklyn: {
    pipelineId: "default",
    stages: {
      // "Requested Trial / Intro Offer" — appointmentscheduled is HubSpot's
      // default-pipeline stage slug, repurposed by Court 16 long ago.
      requested: "appointmentscheduled",
      // "Scheduled Trial / Intro Offer"
      scheduled: "qualifiedtobuy",
    },
  },
  lic: {
    pipelineId: "1460258",
    stages: {
      requested: "5321400", // "REQUESTED TRIAL / INTRO OFFER"
      scheduled: "11096161", // "SCHEDULED TRIAL / INTRO OFFER"
    },
  },
  fidi: {
    pipelineId: "2477627",
    stages: {
      requested: "8517561", // "Requested Trial / Intro Offer"
      scheduled: "8517634", // "Scheduled Trial"
    },
  },
  ridgehill: {
    pipelineId: "830977386",
    stages: {
      requested: "1231873814", // "Requested Trial"
      scheduled: "1231873816", // "Scheduled Trial"
    },
  },
  newton: {
    pipelineId: "873061120",
    stages: {
      requested: "1307706690", // "Requested Trial"
      scheduled: "1307706693", // "Scheduled Trial"
    },
  },
  fishtown: {
    pipelineId: "1818411",
    stages: {
      requested: "6445996", // "Requested Trial / Intro Offer"
      scheduled: "1031324174", // "Scheduled Trial"
    },
  },
};

/**
 * Look up the pipeline config for a location slug. Returns null when
 * the slug isn't recognized — callers should skip the Deal-creation
 * step rather than fail the booking entirely (form submit + MindBody
 * write are the user-visible critical path).
 */
export function getDealPipeline(locationId: string): DealPipelineConfig | null {
  return DEAL_PIPELINES[locationId] ?? null;
}

/**
 * HubSpot Contact has a `preferred_location` dropdown property whose
 * options Ibtissam set up to match the public trial form's location
 * picker. The exact strings are portal-baked — anything else 400s
 * with `INVALID_OPTION`. Map our internal `location.id` slugs to the
 * verbatim dropdown labels.
 *
 * Verified against the live portal 4832170 on 2026-05-12.
 */
export const HUBSPOT_PREFERRED_LOCATION_LABEL: Record<string, string> = {
  brooklyn: "Gowanus, Brooklyn",
  lic: "Long Island City, Queens",
  fidi: "Manhattan-FiDi",
  ridgehill: "Ridge Hill - Yonkers",
  fishtown: "Fishtown, Philadelphia",
  newton: "Newton - Massachusetts",
};

export function getHubspotPreferredLocation(locationId: string): string | undefined {
  return HUBSPOT_PREFERRED_LOCATION_LABEL[locationId];
}
