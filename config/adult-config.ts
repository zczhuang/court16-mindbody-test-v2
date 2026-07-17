/**
 * Adult intro-offer configuration.
 *
 * Court 16 runs two adult intro packages per Anthony's policy:
 *   - Tennis Intro Special — $75
 *   - Pickleball Clinic Intro — $58
 *
 * Each location may offer both or just one. Each offer maps to a specific
 * MindBody "pricing option" / service ID per site. Staff populates the
 * `serviceIdByLocation` map once the real MindBody IDs are captured.
 */

export type AdultOfferKey =
  | "tennis-intro-75"
  | "pickleball-intro-58"
  | "tennis-private-ball-machine"
  | "pickleball-bogo";

export interface AdultOffer {
  key: AdultOfferKey;
  displayName: string;
  priceUsd: number;
  subtitle: string;
  /**
   * How this offer is fulfilled:
   *   - "payment" (default) — redirects to MindBody cart, booked on payment
   *   - "staff_assist"      — no cart; lead lands in HubSpot for staff follow-up
   */
  flow?: "payment" | "staff_assist";
  /** MindBody service / pricing option ID, keyed by location slug. */
  serviceIdByLocation: Record<string, number | undefined>;
  /** Exact ClientService.Name expected after checkout, keyed by location. */
  serviceNameByLocation?: Record<string, string | undefined>;
  /** True only after the displayed price is reconciled to the live Mindbody checkout price. */
  checkoutVerifiedByLocation?: Record<string, boolean | undefined>;
}

const EMPTY_SERVICE_MAP: Record<string, number | undefined> = {
  brooklyn: undefined,
  lic: undefined,
  fidi: undefined,
  ridgehill: undefined,
  fishtown: undefined,
  newton: undefined,
};

const EMPTY_SERVICE_NAME_MAP: Record<string, string | undefined> = {
  brooklyn: undefined,
  lic: undefined,
  fidi: undefined,
  ridgehill: undefined,
  fishtown: undefined,
  newton: undefined,
};

export const ADULT_OFFERS: AdultOffer[] = [
  {
    key: "tennis-intro-75",
    displayName: "Tennis Intro Special",
    priceUsd: 75,
    subtitle: "One 60-minute tennis class with a Court 16 coach.",
    // MindBody RH service: "Tennis Intro Special: 1 Class + 1 Free" $68
    // (discovered via /sale/services May 15 — note RH lists this at $68
    // not $75; pricing mismatch flagged for Anthony in issue tracker).
    serviceIdByLocation: { ...EMPTY_SERVICE_MAP, ridgehill: 100236 },
    serviceNameByLocation: {
      ...EMPTY_SERVICE_NAME_MAP,
      ridgehill: "Tennis Intro Special: 1 Class + 1 Free",
    },
  },
  {
    key: "pickleball-intro-58",
    displayName: "Pickleball Clinic Intro",
    priceUsd: 58,
    subtitle: "One 45-minute pickleball clinic — all levels welcome.",
    // MindBody RH service: "Pickleball Clinic Intro Special: 1 Clinic + 1 Free" $48
    serviceIdByLocation: { ...EMPTY_SERVICE_MAP, ridgehill: 100107 },
    serviceNameByLocation: {
      ...EMPTY_SERVICE_NAME_MAP,
      ridgehill: "Pickleball Clinic Intro Special: 1 Clinic + 1 Free",
    },
  },
  {
    key: "tennis-private-ball-machine",
    displayName: "Tennis Private Ball Machine",
    priceUsd: 45,
    subtitle: "Solo court time with Court 16's ball machine — drill at your own pace.",
    // MindBody RH service: "Ball Machine Private Intro Session | 45min" $94
    // — significantly higher than our $45 listing. Anthony to reconcile.
    serviceIdByLocation: { ...EMPTY_SERVICE_MAP, ridgehill: 100061 },
    serviceNameByLocation: {
      ...EMPTY_SERVICE_NAME_MAP,
      ridgehill: "Ball Machine Private Intro Session | 45min",
    },
  },
  {
    key: "pickleball-bogo",
    displayName: "Pickleball BOGO",
    priceUsd: 0,
    subtitle: "Bring a friend free. Staff coordinates the slot directly with you.",
    flow: "staff_assist",
    // No service needed — staff_assist flow skips the cart.
    serviceIdByLocation: { ...EMPTY_SERVICE_MAP },
  },
];

export function getOffer(key: string): AdultOffer | undefined {
  return ADULT_OFFERS.find((o) => o.key === key);
}

/** Payment offers are selectable only after both ID and exact receipt name are verified. */
export function isAdultOfferReadyAtLocation(offer: AdultOffer, locationId: string): boolean {
  return (
    offer.flow === "staff_assist" ||
    (offer.serviceIdByLocation[locationId] != null &&
      Boolean(offer.serviceNameByLocation?.[locationId]) &&
      offer.checkoutVerifiedByLocation?.[locationId] === true)
  );
}

/**
 * MindBody `ClassDescription.Program.Name` values we consider "adult".
 * Used to filter the calendar for the adult flow. Until real production
 * data tells us the exact strings Court 16 uses, this list is permissive
 * and the `filterAdultOnly` helper falls back to "anything not in the
 * children allowlist" so sandbox / early-dev data still renders.
 */
export const ADULT_PROGRAM_NAMES: string[] = [
  "Adult Classes",
  "Adult Tennis",
  "Adult Pickleball",
  "Pickleball",
  "Intro Offer",
];

/** Returns true iff we're confident this class is an adult program. */
export function isAdultProgram(programName: string | undefined): boolean {
  if (!programName) return false;
  return ADULT_PROGRAM_NAMES.some(
    (p) => programName.toLowerCase().includes(p.toLowerCase()),
  );
}

/** Returns true iff this program is explicitly a children's program we should exclude. */
export function isChildrenProgram(programName: string | undefined): boolean {
  if (!programName) return false;
  const lower = programName.toLowerCase();
  return (
    lower.includes("children") ||
    lower.includes("kids") ||
    lower.includes("little freshman") ||
    lower.includes("freshman") ||
    lower.includes("sophomore") ||
    lower.includes("junior")
  );
}
