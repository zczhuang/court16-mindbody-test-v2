// Static Court 16 configuration. Hardcoded intentionally: a CMS for 6
// locations and 2 offers would be overkill for Track 1. Change in code,
// redeploy, done.
//
// Per Ideal-State §6.1 FR-U6, all 6 locations are treated identically at
// the code level; location-specific class inventory still comes from
// MindBody at runtime.

export const WAIVER_VERSION = "v1.0";

export interface LocationConfig {
  slug: string;
  displayName: string;
  mindbodySiteId: string;
  /** Override staff notification email. Falls back to STAFF_NOTIFY_EMAIL env var. */
  staffNotifyEmailOverride?: string;
  /**
   * MindBody program IDs that count as trial-eligible kid classes at this
   * location. A class is only offered on the kids flow if its ProgramId is
   * in this list. Populate once per location when real MindBody data is
   * wired in; leaving empty means "accept all classes" (open-ended Track 1
   * default until program IDs are captured per site).
   */
  trialProgramIds: number[];
  /** Adult intro-eligible program IDs. Same rules as trialProgramIds. */
  introProgramIds: number[];
}

/**
 * The 6 Court 16 locations. Site IDs are placeholders (`-99` sandbox) until
 * the per-location production IDs come back from Anthony — see Ideal-State
 * §13.1 access checklist. Do NOT ship `-99` to production.
 */
export const LOCATIONS: LocationConfig[] = [
  {
    slug: "nyc-union-sq",
    displayName: "NYC — Union Square",
    mindbodySiteId: "-99",
    trialProgramIds: [],
    introProgramIds: [],
  },
  {
    slug: "nyc-brooklyn",
    displayName: "NYC — Brooklyn",
    mindbodySiteId: "-99",
    trialProgramIds: [],
    introProgramIds: [],
  },
  {
    slug: "nyc-long-island-city",
    displayName: "NYC — Long Island City",
    mindbodySiteId: "-99",
    trialProgramIds: [],
    introProgramIds: [],
  },
  {
    slug: "nyc-upper-west-side",
    displayName: "NYC — Upper West Side",
    mindbodySiteId: "-99",
    trialProgramIds: [],
    introProgramIds: [],
  },
  {
    slug: "nyc-chelsea",
    displayName: "NYC — Chelsea",
    mindbodySiteId: "-99",
    trialProgramIds: [],
    introProgramIds: [],
  },
  {
    slug: "nyc-harlem",
    displayName: "NYC — Harlem",
    mindbodySiteId: "-99",
    trialProgramIds: [],
    introProgramIds: [],
  },
];

export function getLocation(slug: string): LocationConfig | undefined {
  return LOCATIONS.find((l) => l.slug === slug);
}

export interface OfferConfig {
  key: string;
  displayName: string;
  priceUsd: number;
  /** MindBody pricing option / service ID. Per-location — keyed by location slug. */
  mindbodyServiceIdByLocation: Record<string, number | undefined>;
}

/** Adult intro offers per Anthony's policy: no free adult trials. Kids flow doesn't use offers. */
export const OFFERS: OfferConfig[] = [
  {
    key: "tennis-intro-75",
    displayName: "Tennis Intro Special — $75",
    priceUsd: 75,
    mindbodyServiceIdByLocation: {},
  },
  {
    key: "pickleball-intro-58",
    displayName: "Pickleball Clinic Intro — $58",
    priceUsd: 58,
    mindbodyServiceIdByLocation: {},
  },
];

export function getOffer(key: string): OfferConfig | undefined {
  return OFFERS.find((o) => o.key === key);
}

/** Comfort levels surfaced in the kids form. Stored as a HubSpot contact property. */
export const COMFORT_LEVELS = ["beginner", "some-experience", "experienced"] as const;
export type ComfortLevel = (typeof COMFORT_LEVELS)[number];

export const WAIVER_TEXT_SUMMARY =
  "I acknowledge Court 16's participation waiver and agree to its terms. Full text available on request.";
