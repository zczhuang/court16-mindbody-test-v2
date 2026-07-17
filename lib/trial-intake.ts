/**
 * Mindbody-required profile data collected by the Court 16 kids-trial form.
 * These fields are intentionally kept out of HubSpot; they exist to prevent
 * fabricated address or demographic values in Mindbody.
 */

export const MINDBODY_STANDARD_GENDERS = ["Female", "Male", "Undisclosed"] as const;

export const MIN_KIDS_TRIAL_AGE = 3;
export const MAX_KIDS_TRIAL_AGE = 17;

/** USPS two-letter state, district, territory, and military-region codes. */
export const US_STATE_AND_TERRITORY_CODES = [
  "AA",
  "AE",
  "AK",
  "AL",
  "AP",
  "AR",
  "AS",
  "AZ",
  "CA",
  "CO",
  "CT",
  "DC",
  "DE",
  "FL",
  "FM",
  "GA",
  "GU",
  "HI",
  "IA",
  "ID",
  "IL",
  "IN",
  "KS",
  "KY",
  "LA",
  "MA",
  "MD",
  "ME",
  "MH",
  "MI",
  "MN",
  "MO",
  "MP",
  "MS",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "OR",
  "PA",
  "PR",
  "PW",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VA",
  "VI",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
] as const;

export type MindbodyStandardGender = (typeof MINDBODY_STANDARD_GENDERS)[number];

export interface MindbodyProfileDetails {
  parentGender: MindbodyStandardGender;
  childGender: MindbodyStandardGender;
  householdAddress1: string;
  householdAddress2?: string;
  householdCity: string;
  householdState: string;
  householdPostalCode: string;
}

export interface NormalizedMindbodyProfileDetails extends MindbodyProfileDetails {
  householdAddress2?: string;
}

export interface MindbodyHouseholdAddress {
  AddressLine1: string;
  AddressLine2?: string;
  City: string;
  State: string;
  PostalCode: string;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAllowedGender(
  value: unknown,
  allowedGenders: readonly MindbodyStandardGender[],
): value is MindbodyStandardGender {
  return allowedGenders.includes(value as MindbodyStandardGender);
}

function isUsStateOrTerritory(value: unknown): value is string {
  if (!hasText(value)) return false;
  return US_STATE_AND_TERRITORY_CODES.includes(
    value.trim().toUpperCase() as (typeof US_STATE_AND_TERRITORY_CODES)[number],
  );
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validate the one-child payload supported by the current public flow. */
export function validateSingleTrialChildPayload(children: unknown): string[] {
  if (!Array.isArray(children)) {
    return ["children must be an array containing exactly one child"];
  }
  if (children.length !== 1) {
    return ["children must contain exactly one child for the current trial flow"];
  }

  const rawChild = children[0];
  if (!rawChild || typeof rawChild !== "object" || Array.isArray(rawChild)) {
    return ["children[0] must be an object"];
  }

  const child = rawChild as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof child.firstName !== "string" || child.firstName.trim().length === 0) {
    errors.push("children[0].firstName is required");
  }
  if (typeof child.lastName !== "string" || child.lastName.trim().length === 0) {
    errors.push("children[0].lastName is required");
  }
  if (!isValidIsoDate(child.birthDate)) {
    errors.push('children[0].birthDate is required ("YYYY-MM-DD")');
  }
  return errors;
}

export function validateMindbodyProfileDetails(
  details: Partial<MindbodyProfileDetails> | undefined,
  allowedGenders: readonly MindbodyStandardGender[] = MINDBODY_STANDARD_GENDERS,
): string[] {
  if (!details) return ["Mindbody profile details are required"];

  const errors: string[] = [];
  const allowedLabel = allowedGenders.join(", ");
  if (!isAllowedGender(details.parentGender, allowedGenders)) {
    errors.push(`parentGender must be one of this site's configured values: ${allowedLabel}`);
  }
  if (!isAllowedGender(details.childGender, allowedGenders)) {
    errors.push(`childGender must be one of this site's configured values: ${allowedLabel}`);
  }
  if (!hasText(details.householdAddress1)) errors.push("householdAddress1 is required");
  if (
    details.householdAddress2 != null &&
    typeof details.householdAddress2 !== "string"
  ) {
    errors.push("householdAddress2 must be a string");
  }
  if (!hasText(details.householdCity)) errors.push("householdCity is required");
  if (!isUsStateOrTerritory(details.householdState)) {
    errors.push("householdState must be a valid 2-letter US state or territory code");
  }
  if (
    !hasText(details.householdPostalCode) ||
    !/^\d{5}(?:-\d{4})?$/.test(details.householdPostalCode.trim())
  ) {
    errors.push("householdPostalCode must be a 5-digit ZIP or ZIP+4");
  }
  return errors;
}

export function normalizeMindbodyProfileDetails(
  details: MindbodyProfileDetails,
): NormalizedMindbodyProfileDetails {
  const address2 = details.householdAddress2?.trim();
  return {
    parentGender: details.parentGender,
    childGender: details.childGender,
    householdAddress1: details.householdAddress1.trim(),
    ...(address2 ? { householdAddress2: address2 } : {}),
    householdCity: details.householdCity.trim(),
    householdState: details.householdState.trim().toUpperCase(),
    householdPostalCode: details.householdPostalCode.trim(),
  };
}

export function buildMindbodyHouseholdAddress(
  details: NormalizedMindbodyProfileDetails,
): MindbodyHouseholdAddress {
  return {
    AddressLine1: details.householdAddress1,
    ...(details.householdAddress2 ? { AddressLine2: details.householdAddress2 } : {}),
    City: details.householdCity,
    State: details.householdState,
    PostalCode: details.householdPostalCode,
  };
}
