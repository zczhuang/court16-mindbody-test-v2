/** HubSpot values already configured on Court 16's public trial form. */
export const CHILD_PLAYING_LEVELS = [
  "New to Tennis",
  "Played a bit here and there",
  "Has taken formal lessons",
] as const;

export const LEAD_SOURCES = [
  "Word of Mouth",
  "Flyer",
  "Friend with a Court 16 member",
  "Google",
  "Facebook",
  "Instagram",
  "Other",
  "Events",
] as const;

export type ChildPlayingLevel = (typeof CHILD_PLAYING_LEVELS)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface TrialReportingDetails {
  childPlayingLevel: ChildPlayingLevel;
  childSchool?: string;
  leadSource: LeadSource;
}

export interface HubspotTrialReportingFields {
  child_1___playing_level: ChildPlayingLevel;
  school: string;
  lead_source: LeadSource;
}

/**
 * One canonical mapping for the primary synchronous Contact upsert and the
 * optional legacy Forms submission. Keeping them identical preserves the
 * staff-facing reporting contract if compatibility is deliberately enabled.
 */
export function buildHubspotTrialReportingFields(
  details: TrialReportingDetails,
): HubspotTrialReportingFields {
  return {
    child_1___playing_level: details.childPlayingLevel,
    school: details.childSchool?.trim() || "Not provided",
    lead_source: details.leadSource,
  };
}

export function validateTrialReportingDetails(
  details: Partial<TrialReportingDetails> | undefined,
): string[] {
  if (!details) return ["Trial reporting details are required"];
  const errors: string[] = [];
  if (!CHILD_PLAYING_LEVELS.includes(details.childPlayingLevel as ChildPlayingLevel)) {
    errors.push("childPlayingLevel is invalid");
  }
  if (details.childSchool != null && typeof details.childSchool !== "string") {
    errors.push("childSchool must be a string");
  }
  if (!LEAD_SOURCES.includes(details.leadSource as LeadSource)) {
    errors.push("leadSource is invalid");
  }
  return errors;
}
