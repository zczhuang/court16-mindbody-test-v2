/**
 * Trial eligibility configuration.
 *
 * Staff can use this file to restrict which class schedules accept trial kids
 * each season. The dedicated Mindbody Program remains the primary boundary;
 * the schedule allowlist applies only when ENFORCE_TRIAL_ELIGIBILITY is true.
 */

export interface LocationTrialConfig {
  trialEligibleClassScheduleIds: number[];
  maxTrialsPerClass: number;
  /**
   * Mindbody sale-service / pricing-option ID used to grant the $0 trial.
   * This is not the ClientService instance ID used by AddClientToClass;
   * confirmation reads that instance back from /client/clientservices.
   * Leave undefined until the exact live ID and name are verified.
   */
  trialServiceId?: number;
  /** Exact service name returned by both /sale/services and /client/clientservices. */
  trialServiceName?: string;
  /**
   * Exact Parent/Guardian relationship descriptor returned by this site's
   * GET /site/relationships catalog. Mindbody relationship IDs are site
   * specific, so this must be verified before trial writes are enabled.
   */
  parentGuardianRelationship?: {
    Id: number;
    RelationshipName1: string;
    RelationshipName2: string;
  };
}

export const TRIAL_CONFIG: Record<string, LocationTrialConfig> = {
  brooklyn: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  lic: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  fidi: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  // RH Kid's Trial $0 service (id 100328) is tied to Program 61. AddClientToClass
  // for a Program 61 occurrence requires this service credit — without it
  // Mindbody returns `ClassRequiresPayment` (verified smoke #M3 v1, May 22).
  // Jane Montoya created the service; surfaced via /sale/services with staff
  // auth. Confirmation resolves the resulting ClientService instance by name.
  ridgehill: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 100328,
    trialServiceName: "Kid's Trial",
    parentGuardianRelationship: {
      Id: -6,
      RelationshipName1: "Parent/Guardian",
      RelationshipName2: "Child",
    },
  },
  fishtown: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  newton: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  allston: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
};

/**
 * Whether to apply the optional schedule-ID allowlist after the server has
 * already restricted kids trials to the club's verified Trial Program.
 * False does not enable an unfiltered children's-class fallback.
 */
export const ENFORCE_TRIAL_ELIGIBILITY = false;

/**
 * How far ahead parents can request a trial, in days from today.
 * Ibtissam (Trial Process Review, Jun 11 2026): cap advance bookings so
 * requests don't land weeks out. NEXT_PUBLIC_ so the client-side calendar
 * sees the same number the API enforces; the API clamp is the authority.
 */
export const TRIAL_MAX_ADVANCE_DAYS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_TRIAL_MAX_ADVANCE_DAYS ?? "7");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
})();

/** YYYY-MM-DD for "today" in the given IANA timezone. */
export function todayStrInTz(timezone: string): string {
  // en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

/**
 * Last bookable date (YYYY-MM-DD inclusive), counting from today in the
 * site's timezone. Noon-UTC anchor dodges DST-boundary off-by-ones.
 */
export function maxBookableDateStr(timezone: string): string {
  const base = new Date(`${todayStrInTz(timezone)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + TRIAL_MAX_ADVANCE_DAYS);
  return base.toISOString().slice(0, 10);
}
