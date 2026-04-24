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
  ridgehill: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  fishtown: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
  newton: { trialEligibleClassScheduleIds: [], maxTrialsPerClass: 2 },
};

/**
 * Maps a child's age to the appropriate class level name prefix.
 * Level names come from the MindBody ClassName field, e.g.:
 *   "Little Freshman I 30min I 44ft crt | Foam Ball"
 *   "Freshman I 45min I 44ft crt | Red Ball"
 */
export const AGE_TO_LEVEL_MAP: Record<string, string[]> = {
  "3": ["Little Freshman"],
  "4": ["Little Freshman"],
  "5": ["Little Freshman", "Freshman"],
  "6": ["Little Freshman", "Freshman"],
  "7": ["Freshman"],
  "8": ["Freshman", "Sophomore"],
  "9": ["Sophomore"],
  "10": ["Sophomore", "Junior"],
  "11": ["Junior"],
  "12": ["Junior", "Senior"],
  "13": ["Senior", "Teenager"],
  "14": ["Senior", "Teenager"],
  "15": ["Teenager"],
  "16": ["Teenager"],
  "17": ["Teenager"],
};

/**
 * Whether to use the trial eligibility config to filter classes.
 * False = show ALL children's classes (useful until staff populates IDs).
 */
export const ENFORCE_TRIAL_ELIGIBILITY = false;

/**
 * Per-level age range metadata. Drives both the UI age filter and the
 * server-side validation that rejects bookings where the child's age
 * doesn't match the class level.
 *
 * Kept in sync with AGE_TO_LEVEL_MAP above — if you edit that map,
 * mirror the change here. When a class's level isn't in this map
 * (unknown or adult program), validation is permissive (no constraint).
 */
export const CLASS_AGE_METADATA: Record<string, { minAge: number; maxAge: number }> = {
  "Little Freshman": { minAge: 3, maxAge: 6 },
  Freshman: { minAge: 5, maxAge: 8 },
  Sophomore: { minAge: 8, maxAge: 10 },
  Junior: { minAge: 10, maxAge: 12 },
  Senior: { minAge: 12, maxAge: 14 },
  Teenager: { minAge: 13, maxAge: 17 },
};
