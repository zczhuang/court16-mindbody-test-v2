import assert from "node:assert/strict";
import type { MindbodyProfileDetails } from "../lib/trial-intake";

const intakeModuleUrl = new URL("../lib/trial-intake.ts", import.meta.url).href;
const {
  buildMindbodyHouseholdAddress,
  isValidIsoDate,
  normalizeMindbodyProfileDetails,
  validateMindbodyProfileDetails,
  validateSingleTrialChildPayload,
} = (await import(intakeModuleUrl)) as typeof import("../lib/trial-intake");

const valid: MindbodyProfileDetails = {
  parentGender: "Undisclosed",
  childGender: "Female",
  householdAddress1: " 123 Main Street ",
  householdAddress2: " Apt 4B ",
  householdCity: " Brooklyn ",
  householdState: "ny",
  householdPostalCode: "11201",
};

assert.deepEqual(validateMindbodyProfileDetails(valid), []);

const normalized = normalizeMindbodyProfileDetails(valid);
assert.deepEqual(normalized, {
  parentGender: "Undisclosed",
  childGender: "Female",
  householdAddress1: "123 Main Street",
  householdAddress2: "Apt 4B",
  householdCity: "Brooklyn",
  householdState: "NY",
  householdPostalCode: "11201",
});
assert.deepEqual(buildMindbodyHouseholdAddress(normalized), {
  AddressLine1: "123 Main Street",
  AddressLine2: "Apt 4B",
  City: "Brooklyn",
  State: "NY",
  PostalCode: "11201",
});

const invalid = {
  ...valid,
  parentGender: "None",
  childGender: "Unknown",
  householdAddress1: " ",
  householdState: "New York",
  householdPostalCode: "ABC",
} as unknown as MindbodyProfileDetails;
const invalidErrors = validateMindbodyProfileDetails(invalid);
assert(
  invalidErrors.includes(
    "parentGender must be one of this site's configured values: Female, Male, Undisclosed",
  ),
);
assert(
  invalidErrors.includes(
    "childGender must be one of this site's configured values: Female, Male, Undisclosed",
  ),
);
assert(invalidErrors.includes("householdAddress1 is required"));
assert(
  invalidErrors.includes(
    "householdState must be a valid 2-letter US state or territory code",
  ),
);
assert(invalidErrors.includes("householdPostalCode must be a 5-digit ZIP or ZIP+4"));

assert.deepEqual(
  validateMindbodyProfileDetails({ ...valid, householdState: "ZZ" }),
  ["householdState must be a valid 2-letter US state or territory code"],
);
assert.deepEqual(validateMindbodyProfileDetails({ ...valid, householdState: "PR" }), []);
assert.deepEqual(validateMindbodyProfileDetails(valid, ["Female", "Male"]), [
  "parentGender must be one of this site's configured values: Female, Male",
]);

assert.equal(isValidIsoDate("2018-02-28"), true);
assert.equal(isValidIsoDate("2018-02-30"), false);
assert.equal(isValidIsoDate("2018-13-01"), false);
assert.equal(isValidIsoDate("not-a-date"), false);

assert.deepEqual(
  validateSingleTrialChildPayload([
    { firstName: " Jordan ", lastName: " Tester ", birthDate: "2017-09-12", age: 2 },
  ]),
  [],
);
assert.deepEqual(validateSingleTrialChildPayload(undefined), [
  "children must be an array containing exactly one child",
]);
assert.deepEqual(validateSingleTrialChildPayload([]), [
  "children must contain exactly one child for the current trial flow",
]);
assert.deepEqual(validateSingleTrialChildPayload([{}, {}]), [
  "children must contain exactly one child for the current trial flow",
]);
assert.deepEqual(validateSingleTrialChildPayload([{}]), [
  "children[0].firstName is required",
  "children[0].lastName is required",
  'children[0].birthDate is required ("YYYY-MM-DD")',
]);

console.log("Trial intake validation passed.");
