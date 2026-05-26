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
