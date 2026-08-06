/**
 * Trial eligibility configuration.
 *
 * Staff can use this file to restrict which class schedules accept trial kids
 * each season. The dedicated Mindbody Program remains the primary boundary;
 * the schedule allowlist applies only when ENFORCE_TRIAL_ELIGIBILITY is true.
 */

import type { MindbodyStandardGender } from "@/lib/trial-intake";

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
  /**
   * Active values returned by this site's GET /site/genders catalog and
   * allowed by the kids-trial form. Keep the club disabled until this list
   * has been read from that exact Site ID and exercised in its launch test.
   */
  mindbodyGenderOptions?: readonly MindbodyStandardGender[];
}

export const TRIAL_CONFIG: Record<string, LocationTrialConfig> = {
  // These six Service IDs came from the 5 Aug 2026 read-only audit. Program/location
  // applicability is unverified: Ridge Hill's Service 100328 is tied to Program 61
  // while these clubs run Program 120; a mismatch returns `ClassRequiresPayment`.
  brooklyn: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 11479,
    trialServiceName: "Kid's Trial",
  },
  lic: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 103806,
    trialServiceName: "Kid's Trial",
  },
  fidi: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 101407,
    trialServiceName: "Kid's Trial",
  },
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
    // Active Ridge Hill catalog values observed via GET /site/genders.
    mindbodyGenderOptions: ["Female", "Male", "Undisclosed"],
  },
  fishtown: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 100214,
    trialServiceName: "Kid's Trial",
  },
  newton: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 100432,
    trialServiceName: "Kid's Trial",
  },
  allston: {
    trialEligibleClassScheduleIds: [],
    maxTrialsPerClass: 2,
    trialServiceId: 100420,
    trialServiceName: "Kid's Trial",
  },
};

/**
 * Whether to apply the optional schedule-ID allowlist after the server has
 * already restricted kids trials to the club's verified Trial Program.
 * False does not enable an unfiltered children's-class fallback.
 */
export const ENFORCE_TRIAL_ELIGIBILITY = false;

/**
 * Number of site-local calendar dates shown to parents, including today.
 * Ibtissam approved a four-week view on Jul 31 2026. Booking eligibility is
 * intentionally separate and is enforced per occurrence.
 */
export const TRIAL_CALENDAR_DISPLAY_DAYS = 28;

/** YYYY-MM-DD for "today" in the given IANA timezone. */
export function todayStrInTz(timezone: string, now = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

/**
 * Last displayed date (YYYY-MM-DD inclusive), counting today as day one in
 * the site's timezone. Noon-UTC anchor dodges DST-boundary off-by-ones.
 */
export function maxCalendarDateStr(timezone: string, now = new Date()): string {
  const base = new Date(`${todayStrInTz(timezone, now)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + TRIAL_CALENDAR_DISPLAY_DAYS - 1);
  return base.toISOString().slice(0, 10);
}
