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
