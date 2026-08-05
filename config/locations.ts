/**
 * Court 16 location configuration.
 * locationId values match the enrollment tool's existing API parameter format.
 * siteId values are MindBody Site IDs from the diagnostic audit.
 */
export interface Location {
  id: string; // URL-safe slug used in API calls
  name: string; // Display name
  fullName: string; // Full display with state prefix
  siteId: number; // MindBody Site ID
  address: string;
  city: string;
  state: string;
  /**
   * Club ZIP used for display and club-level routing. The kids-trial flow
   * collects the family's real household address and must never substitute
   * this value into a parent or child profile.
   */
  postalCode: string;
  /**
   * IANA timezone name for the site (e.g. "America/New_York"). MindBody
   * returns `StartDateTime` as wall-clock time WITHOUT a TZ suffix — it's
   * implicitly the site's local time. We use this to convert to absolute
   * UTC ms before writing HubSpot Deal `class_date` so the 24h-reminder
   * workflow fires at the correct absolute instant (caught by smoke #2 v2).
   */
  timezone: string;
  /**
   * Whether the club can accept any public booking through this app.
   * Keep false for announced clubs until their address and operational
   * configuration are verified. API routes enforce this server-side.
   */
  publicBookingEnabled: boolean;
  /**
   * Explicit go-live gate for the kids-trial automation. A Site ID alone is
   * not sufficient: Cedarwind source access, a dedicated Kid's Trials
   * Program, the matching $0 service, and HubSpot routing must all be verified
   * before this becomes true.
   */
  trialBookingEnabled: boolean;
  /**
   * Preview-only escape hatch for an authorized Mindbody site. A club with a
   * dedicated Kid's Trials Program gets a trial-program preview; otherwise it
   * gets a separately labeled regular-kids schedule preview constrained to
   * `kidsCalendarProgramIds`. The calendar and full form may be reviewed, but
   * submission stays fail-closed and no broad, unfiltered class query is
   * allowed.
   */
  trialCalendarPreviewEnabled?: boolean;
  /**
   * Site-scoped allowlist for the preview-only regular-kids schedule.
   * These IDs never satisfy trial-booking readiness and are never accepted by
   * the booking route. Keep the list empty when no kids schedule is live.
   */
  kidsCalendarProgramIds?: readonly number[];
  /**
   * Operational evidence required in addition to static IDs. Every boolean
   * must be true before this club can appear in the public kids-trial flow.
   * Update only from dated acceptance evidence, not from configuration alone.
   */
  trialLaunchEvidence?: {
    mindbodySiteAuthorized: boolean;
    upcomingTrialInventoryVerified: boolean;
    hubspotRoutingVerified: boolean;
    hubspotDealLedgerVerified: boolean;
    durableMutationLockVerified: boolean;
    endToEndAcceptancePassed: boolean;
    designOwnerApproved: boolean;
    reviewedAt: string;
  };
  /** Short parent-facing reason shown for a club that is not trial-ready. */
  trialUnavailableReason?: string;
  /**
   * Per-location Sign in destination. Falls back to the generic
   * court16.com/login when undefined. Replace with per-location URLs
   * once Squarespace has them (e.g. /login/brooklyn or a MindBody
   * classic URL with studioid={siteId}).
   */
  loginUrl?: string;
  /**
   * MindBody Program ID for the site's "Kid's Trials" container — the
   * `/api/mindbody/calendar` route filters on this when called with
   * `intent=kid_trial` so the trial form only surfaces trial-eligible
   * class occurrences (not all the regular kid recurring classes).
   *
   * Setup model (Ibtissam, per May 21 email):
   *   1. Create a new MindBody Program called "Kid's Trials"
   *   2. Add ClassDescriptions for each age band
   *      (Little Freshman / Freshman+Sophomore / Junior+Senior / Teenager)
   *   3. Create a $0 service SKU tied to that Program
   *   4. Schedule recurring class occurrences ONLY at the curated
   *      trial-eligible times (e.g. Mon 3:45 PM, Sat 9 AM, etc.)
   *   5. Share the Program ID with Cedarwind → set here per location
   *
   * If undefined, `trialBookingEnabled` MUST remain false. A separately
   * labeled read-only kids schedule may still use `kidsCalendarProgramIds`,
   * but those regular classes can never enter the trial booking path.
   */
  kidTrialProgramId?: number;
}

/** Default login URL used when a location's `loginUrl` is undefined. */
export const DEFAULT_LOGIN_URL = "https://www.court16.com/login";

export function getLoginUrlFor(loc: Location): string {
  return loc.loginUrl ?? DEFAULT_LOGIN_URL;
}

/**
 * Per-location login URLs — the EXACT links court16.com/login uses.
 * Different clubs use different MindBody paths (/ASP/su1.asp vs
 * /consumermyinfo vs /classic/ws) — preserved here verbatim so Sign in
 * behaves identically to Court 16's existing login page.
 * Source: Stuart pulled these from court16.com/login on 2026-04-18.
 */
const LOGIN_URLS: Record<string, string> = {
  brooklyn:
    "https://clients.mindbodyonline.com/ASP/su1.asp?catid=&classid=0&date=2%2F3%2F2022&justloggedin=&loc=1&lvl=&nLgIn=&optForwardingLink=&pMode=0&page=&prodGroupId=&prodid=&qParam=&sSU=&studioid=135479&stype=&tg=&trn=0&view=&vt=",
  lic:
    "https://clients.mindbodyonline.com/ASP/su1.asp?catid=&classid=0&date=2%2F2%2F2022&justloggedin=&loc=1&lvl=&nLgIn=&optForwardingLink=&pMode=0&page=&prodGroupId=&prodid=&qParam=&sSU=&studioid=985499&stype=&tg=&trn=0&view=&vt=",
  fidi:
    "https://clients.mindbodyonline.com/ASP/su1.asp?catid=&classid=0&date=8%2F18%2F2022&justloggedin=&loc=1&lvl=&nLgIn=&optForwardingLink=&pMode=0&page=&prodGroupId=&prodid=&qParam=&sSU=&studioid=5728093&stype=&tg=&trn=0&view=&vt=",
  fishtown:
    "https://clients.mindbodyonline.com/consumermyinfo?studioid=5742169&tg=&vt=&lvl=&stype=-2&view=&trn=0&page=&catid=&prodid=&date=3%2f19%2f2025&classid=0&prodGroupId=&sSU=&optForwardingLink=&qParam=info&justloggedin=&nLgIn=&pMode=0&loc=1",
  ridgehill:
    "https://clients.mindbodyonline.com/classic/ws?studioid=5748154&stype=-98",
  newton:
    "https://clients.mindbodyonline.com/classic/ws?studioid=5751422&stype=-98",
};

/**
 * Real Court 16 MindBody site IDs, scraped from court16.com/login
 * on 2026-04-18. Each location card on that page links to
 * clients.mindbodyonline.com/ASP/su1.asp?studioid=<id>; the image
 * filename inside the link (AT-Court16-BK, Court16_LIC, etc.)
 * lets us positively match each studioid to its club.
 *
 * Previous IDs (5748147, 5748148, 5748149, 5751421) turned out to be
 * from the Phase 2A prototype's scaffolding, not Court 16's real
 * MindBody sites — replaced with the confirmed ones below.
 */
export const LOCATIONS: Location[] = [
  {
    id: "brooklyn",
    name: "Downtown Brooklyn",
    fullName: "NY - Downtown Brooklyn",
    siteId: 135479,
    address: "445 Albee Square W, Suite 4-500",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11201",
    timezone: "America/New_York",
    publicBookingEnabled: true,
    trialBookingEnabled: false,
    trialCalendarPreviewEnabled: true,
    // Retained as the explicit regular-kids fallback; Program 120 below now
    // drives the dedicated trial-calendar preview.
    kidsCalendarProgramIds: [76, 70, 74],
    // Live read-only audit 2026-07-31: Program 120 (Kids' Trials) returned
    // three open occurrences in the current seven-day app window.
    kidTrialProgramId: 120,
    trialUnavailableReason: "Kids trial scheduling is being connected for this club.",
    // Authorization and upcoming trial inventory are now verified. Booking
    // remains gated on the site-specific Service, routing, and acceptance.
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-07-31",
    },
    loginUrl: LOGIN_URLS.brooklyn,
  },
  {
    id: "lic",
    name: "Long Island City, Queens",
    fullName: "NY - Long Island City, Queens",
    siteId: 985499,
    address: "13-06 Queens Plaza South",
    city: "Long Island City",
    state: "NY",
    postalCode: "11101",
    timezone: "America/New_York",
    publicBookingEnabled: true,
    trialBookingEnabled: false,
    trialCalendarPreviewEnabled: true,
    // Retained as the explicit regular-kids fallback; Program 120 below now
    // drives the dedicated trial-calendar preview.
    kidsCalendarProgramIds: [29],
    // Live read-only audit 2026-07-31: Program 120 (Kids' Trials) returned
    // two open occurrences in the current seven-day app window.
    kidTrialProgramId: 120,
    trialUnavailableReason: "Kids trial scheduling is being connected for this club.",
    // Authorization and upcoming trial inventory are now verified. Booking
    // remains gated on the site-specific Service, routing, and acceptance.
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-07-31",
    },
    loginUrl: LOGIN_URLS.lic,
  },
  {
    id: "fidi",
    name: "FiDi, Manhattan",
    fullName: "NY - FiDi, Manhattan",
    siteId: 5728093,
    address: "28 Liberty Street, SC1",
    city: "New York",
    state: "NY",
    postalCode: "10005",
    timezone: "America/New_York",
    publicBookingEnabled: true,
    trialBookingEnabled: false,
    trialCalendarPreviewEnabled: true,
    // Retained as the explicit regular-kids fallback; Program 120 below now
    // drives the dedicated trial-calendar preview.
    kidsCalendarProgramIds: [32],
    // Live read-only audit 2026-07-31: Program 120 (Kids' Trials) returned
    // four non-cancelled open occurrences in the current seven-day app window.
    kidTrialProgramId: 120,
    trialUnavailableReason: "Kids trial scheduling is being connected for this club.",
    // Authorization and upcoming trial inventory are now verified. Booking
    // remains gated on the site-specific Service, routing, and acceptance.
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-07-31",
    },
    loginUrl: LOGIN_URLS.fidi,
  },
  {
    id: "ridgehill",
    name: "Ridge Hill, Yonkers",
    fullName: "NY - Ridge Hill, Yonkers",
    siteId: 5748154,
    address: "32 Market Street",
    city: "Yonkers",
    state: "NY",
    postalCode: "10710",
    timezone: "America/New_York",
    publicBookingEnabled: true,
    trialBookingEnabled: false,
    // Read-only calendar preview only: the site is authorized and Program 61 +
    // Service 100328 are verified. The July 31 audit found one open Program 61
    // occurrence in the current app window. Booking remains fully gated.
    trialCalendarPreviewEnabled: true,
    // Kept separate from dedicated Kid's Trials Program 61 below.
    kidsCalendarProgramIds: [37],
    trialUnavailableReason: "The next online kids trial times are being finalized.",
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-07-31",
    },
    loginUrl: LOGIN_URLS.ridgehill,
    // Ibtissam created Program 61 + 4 ClassDescriptions on May 20-21:
    // Little Freshman Trial (115), Freshman/Sophomore Trial (116),
    // Junior/Senior Trial (117), Teenager Trial (118).
    // The $0 SKU is service 100328 ("Kid's Trial").
    kidTrialProgramId: 61,
  },
  {
    id: "fishtown",
    name: "Fishtown, Philadelphia",
    fullName: "PA - Fishtown, Philadelphia",
    siteId: 5742169,
    address: "1400 N Howard Street",
    city: "Philadelphia",
    state: "PA",
    postalCode: "19122",
    timezone: "America/New_York",
    publicBookingEnabled: true,
    trialBookingEnabled: false,
    trialCalendarPreviewEnabled: true,
    // Retained as the explicit regular-kids fallback; Program 120 below now
    // drives the dedicated trial-calendar preview.
    kidsCalendarProgramIds: [42],
    // Live read-only audit 2026-07-31: Program 120 (Kids' Trials) returned
    // eight open occurrences in the current seven-day app window.
    kidTrialProgramId: 120,
    trialUnavailableReason: "Kids trial scheduling is being connected for this club.",
    // Authorization and upcoming trial inventory are now verified. Booking
    // remains gated on the site-specific Service, routing, and acceptance.
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-07-31",
    },
    loginUrl: LOGIN_URLS.fishtown,
  },
  {
    id: "newton",
    name: "Newton",
    fullName: "MA - Newton",
    siteId: 5751422,
    address: "300 Needham St",
    city: "Newton",
    state: "MA",
    postalCode: "02459",
    timezone: "America/New_York",
    publicBookingEnabled: true,
    trialBookingEnabled: false,
    trialCalendarPreviewEnabled: true,
    // Retained as the explicit regular-kids fallback; Program 120 below now
    // drives the dedicated trial-calendar preview.
    kidsCalendarProgramIds: [37, 36],
    // Live read-only audit 2026-08-04: Program 120 (Kids' Trials) returned
    // ten open occurrences in the current 28-day app window.
    kidTrialProgramId: 120,
    trialUnavailableReason: "Kids trial scheduling is being connected for this club.",
    // Authorization and upcoming trial inventory are verified. Booking remains
    // gated on the site-specific Service, routing, and acceptance.
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-08-04",
    },
    loginUrl: LOGIN_URLS.newton,
  },
  {
    id: "allston",
    name: "Allston",
    fullName: "MA - Allston",
    siteId: 5754600,
    // Court 16 has announced Allston Yards, but has not yet published the
    // club's exact street address. This record is intentionally disabled so
    // the placeholder is never written to a Mindbody client profile.
    address: "Allston Yards — exact address pending",
    city: "Boston",
    state: "MA",
    postalCode: "02134",
    timezone: "America/New_York",
    publicBookingEnabled: false,
    trialBookingEnabled: false,
    trialCalendarPreviewEnabled: true,
    // Retained as an empty regular-kids fallback; Program 120 below now drives
    // the dedicated trial-calendar preview.
    kidsCalendarProgramIds: [],
    // Live read-only audit 2026-08-04: Program 120 (Kids' Trials) returned
    // seven open occurrences in the current 28-day app window.
    kidTrialProgramId: 120,
    trialUnavailableReason: "Opening details and kids trial scheduling are being finalized.",
    // Authorization and upcoming trial inventory are verified. Public booking
    // also remains off while the exact address, Service, routing, and acceptance
    // are still pending.
    trialLaunchEvidence: {
      mindbodySiteAuthorized: true,
      upcomingTrialInventoryVerified: true,
      hubspotRoutingVerified: false,
      hubspotDealLedgerVerified: false,
      durableMutationLockVerified: false,
      endToEndAcceptancePassed: false,
      designOwnerApproved: false,
      reviewedAt: "2026-08-04",
    },
  },
];

export function getLocationById(id: string): Location | undefined {
  return LOCATIONS.find((l) => l.id === id);
}
