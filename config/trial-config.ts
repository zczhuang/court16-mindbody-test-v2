/**
 * Trial eligibility configuration.
 *
 * Staff updates this file to control which classes accept trial kids each season.
 * Intentionally a static config file, NOT a database table or admin UI.
 * Staff tells you which classes → you update this file → deploy.
 */

export interface LocationTrialConfig {
  trialEligibleClassScheduleIds: number[];
  maxTrialsPerClass: number;
  /**
   * MindBody service / pricing-option ID for "Complimentary Child Intro
   * Session" at this location. Threaded to AddClientToClass as
   * ClientServiceId so the enrollment binds to the right service line.
   * Leave undefined until Jane captures the ID — MindBody falls back to
   * the first applicable pricing.
   */
  trialServiceId?: number;
}

export const TRIAL_CONFIG: Record<string, LocationTrialConfig> = {
  brooklyn: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  lic: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  fidi: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  // RH Kid's Trial $0 service (id 100328) is tied to Program 61. AddClientToClass
  // for a Program 61 occurrence requires this service to be passed as
  // ClientServiceId — without it MindBody returns `ClassRequiresPayment` (verified
  // smoke #M3 v1, May 22). Jane Montoya created the service; surfaced via
  // /sale/services with staffMode Bearer.
  ridgehill: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2, trialServiceId: 100328 },
  fishtown: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  newton: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
};

/**
 * Whether to use the trial eligibility config to filter classes.
 * False = show ALL children's classes (useful until staff populates IDs).
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
