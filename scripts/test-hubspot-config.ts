import assert from "node:assert/strict";

const hubspotModuleUrl = new URL("../lib/hubspot.ts", import.meta.url).href;
const { loadHubspotConfig } = (await import(hubspotModuleUrl)) as typeof import("../lib/hubspot");

const keys = [
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_PORTAL_ID",
  "HUBSPOT_TRIAL_FORM_GUID",
  "HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM",
  "HUBSPOT_REQUIRED",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

try {
  process.env.HUBSPOT_PORTAL_ID = "4832170";
  process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
  process.env.HUBSPOT_TRIAL_FORM_GUID = "test-form-guid";
  delete process.env.HUBSPOT_REQUIRED;

  delete process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM;
  assert.equal(loadHubspotConfig()?.submitLegacyTrialForm, false);

  process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM = "false";
  assert.equal(loadHubspotConfig()?.submitLegacyTrialForm, false);

  process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM = "true";
  assert.equal(loadHubspotConfig()?.submitLegacyTrialForm, true);

  delete process.env.HUBSPOT_TRIAL_FORM_GUID;
  process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM = "false";
  assert.equal(loadHubspotConfig()?.trialFormGuid, "");

  process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM = "true";
  assert.equal(loadHubspotConfig(), null);

  process.env.HUBSPOT_TRIAL_FORM_GUID = "test-form-guid";
  process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM = "false";
  process.env.HUBSPOT_REQUIRED = "true";
  delete process.env.HUBSPOT_ACCESS_TOKEN;
  assert.throws(() => loadHubspotConfig(), /HUBSPOT_ACCESS_TOKEN/);
} finally {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("HubSpot config safety validation passed.");
