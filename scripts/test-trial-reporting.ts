import assert from "node:assert/strict";
import type { TrialReportingDetails } from "../lib/trial-reporting";

const reportingModuleUrl = new URL("../lib/trial-reporting.ts", import.meta.url).href;
const { buildHubspotTrialReportingFields, validateTrialReportingDetails } = (await import(
  reportingModuleUrl
)) as typeof import("../lib/trial-reporting");

const valid: TrialReportingDetails = {
  childPlayingLevel: "Played a bit here and there",
  childSchool: "PS 123",
  leadSource: "Google",
};
assert.deepEqual(validateTrialReportingDetails(valid), []);
assert.deepEqual(buildHubspotTrialReportingFields(valid), {
  child_1___playing_level: "Played a bit here and there",
  school: "PS 123",
  lead_source: "Google",
});
assert.deepEqual(buildHubspotTrialReportingFields({ ...valid, childSchool: "  " }), {
  child_1___playing_level: "Played a bit here and there",
  lead_source: "Google",
});
assert.deepEqual(validateTrialReportingDetails({}), []);
assert.deepEqual(validateTrialReportingDetails(undefined), []);
assert.deepEqual(buildHubspotTrialReportingFields({}), {});

const invalid = {
  childPlayingLevel: "New to Pickleball",
  childSchool: 123,
  leadSource: "TikTok",
} as unknown as TrialReportingDetails;
assert.deepEqual(validateTrialReportingDetails(invalid), [
  "childPlayingLevel is invalid",
  "childSchool must be a string",
  "leadSource is invalid",
]);

console.log("Trial reporting validation passed.");
