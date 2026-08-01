import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const trialPage = readFileSync(new URL("../app/trial/page.tsx", import.meta.url), "utf8");
const requestForm = readFileSync(
  new URL("../components/TrialRequestForm.tsx", import.meta.url),
  "utf8",
);
const dayDetail = readFileSync(
  new URL("../components/DayDetail.tsx", import.meta.url),
  "utf8",
);
const classCard = readFileSync(
  new URL("../components/ClassCard.tsx", import.meta.url),
  "utf8",
);
const progressBar = readFileSync(
  new URL("../components/ProgressBar.tsx", import.meta.url),
  "utf8",
);
const trialRoute = readFileSync(
  new URL("../app/api/book/trial/route.ts", import.meta.url),
  "utf8",
);

// Preview inventory must open the real class-selection/form path instead of
// remaining a read-only article.
assert.match(trialPage, /previewScope[\s\S]*?onPick: handleClassSelect/);
assert.match(trialPage, /function previewFormWithoutInventory\(\)/);
assert.match(trialPage, /Sample kids trial — inventory pending/);
assert.match(trialPage, /onClick=\{previewFormWithoutInventory\}/);
assert.match(dayDetail, /kind: "preview"[\s\S]*?onPick: \(tc: TrialClass\) => void/);
assert.match(classCard, /class-card--preview[\s\S]*?onClick=\{\(\) => interaction\.onSelect/);
assert.doesNotMatch(classCard, /class-card--readonly/);

// Keep one complete preview-policy notice above the calendar. Repeating a
// shorter submission-lock notice in the selected-day panel wastes space and
// makes the two-column layout feel duplicated.
assert.match(trialPage, /className="trial-preview-note"/);
assert.doesNotMatch(dayDetail, /class-list-preview-note/);

// Only the final panel is locked: panel one can advance, but an Enter-key or
// programmatic submit on panel two returns before the live callback.
assert.match(requestForm, /submissionEnabled: boolean/);
assert.doesNotMatch(requestForm, /submissionEnabled\s*=\s*true/);
const previewGuard = requestForm.indexOf("if (!submissionEnabled) {");
const firstLiveValidation = requestForm.indexOf("if (!parentFirstName.trim()");
const liveCallback = requestForm.indexOf("await onSubmit({");
assert(previewGuard >= 0, "preview submit guard is missing");
assert(firstLiveValidation > previewGuard, "preview guard must run before live validation");
assert(liveCallback > previewGuard, "preview guard must run before the live submit callback");
assert.match(requestForm, /noValidate=\{previewOnly\}/);
assert.match(
  requestForm,
  /disabled=\{submitting \|\| \(formStep === "mindbody" && !submissionEnabled\)\}/,
);
assert.match(requestForm, /isn&apos;t fully launch-ready yet/);
assert.match(requestForm, /autoComplete=\{testMode \|\| previewOnly \? "off" : undefined\}/);

// Gender belongs with each person's core details on panel one, beside date of
// birth, and live intake must validate both selections before panel two opens.
const parentDobField = requestForm.indexOf('label="Your date of birth *"');
const parentGenderField = requestForm.indexOf(
  'label="Parent or guardian gender *"',
);
const childDobField = requestForm.indexOf('label="Child\'s date of birth *"');
const childGenderField = requestForm.indexOf('label="Child gender *"');
const secondPanelHeading = requestForm.indexOf("Keep the family profile accurate.");
const genderValidation = requestForm.indexOf("if (!parentGender || !childGender)");
const familyStepTransition = requestForm.indexOf(
  'if (formStep === "family") {',
  firstLiveValidation,
);
const parentDetailsGridStart = requestForm.lastIndexOf(
  '<div className="trf-grid">',
  parentDobField,
);
const parentDetailsGridEnd = requestForm.indexOf("</div>", parentGenderField);
const childDetailsGridStart = requestForm.lastIndexOf(
  '<div className="trf-grid">',
  childDobField,
);
const childDetailsGridEnd = requestForm.indexOf("</div>", childGenderField);
assert(parentDobField >= 0, "parent DOB field is missing");
assert(parentGenderField > parentDobField, "parent gender must sit after parent DOB");
assert(childDobField > parentGenderField, "child DOB must remain in the child section");
assert(childGenderField > childDobField, "child gender must sit after child DOB");
assert(
  parentDetailsGridStart >= 0 && parentGenderField < parentDetailsGridEnd,
  "parent DOB and gender must share one responsive grid",
);
assert(
  childDetailsGridStart >= 0 && childGenderField < childDetailsGridEnd,
  "child DOB and gender must share one responsive grid",
);
assert.equal(
  requestForm.match(/label="Parent or guardian gender \*"/g)?.length,
  1,
  "parent gender must appear exactly once",
);
assert.equal(
  requestForm.match(/label="Child gender \*"/g)?.length,
  1,
  "child gender must appear exactly once",
);
assert(
  secondPanelHeading > childGenderField,
  "both gender fields must appear before panel two",
);
assert.doesNotMatch(requestForm, />Profile details</);
assert(
  genderValidation >= 0 && genderValidation < familyStepTransition,
  "gender validation must run before panel one advances",
);

// The live consumer-mode AddClient contract requires a real emergency contact
// at every Court 16 site. One alternate contact supports the adult profile;
// the child payload reuses the registering parent as its truthful contact.
const emergencySection = requestForm.indexOf("Alternate emergency contact");
assert(emergencySection > secondPanelHeading, "emergency contact must be on panel two");
for (const key of [
  "parentEmergencyContactName",
  "parentEmergencyContactPhone",
  "parentEmergencyContactEmail",
  "parentEmergencyContactRelationship",
]) {
  assert.match(requestForm, new RegExp(`value=\\{${key}\\}`));
}
assert.match(
  trialRoute,
  /EmergencyContactInfoRelationship:\s*"Parent\/Guardian"/,
);

// Court16/HubSpot-only questions do not belong in the minimum Mindbody
// profile form.
assert.doesNotMatch(requestForm, /Tennis experience/);
assert.doesNotMatch(requestForm, /School \(optional\)/);
assert.doesNotMatch(requestForm, /How did you hear about Court 16/);
assert.doesNotMatch(requestForm, /Anything we should know/);
assert.doesNotMatch(requestForm, /Apartment, suite/);
for (const field of [
  "childPlayingLevel",
  "childSchool",
  "leadSource",
  "notes",
  "householdAddress2",
]) {
  assert.match(
    trialRoute,
    new RegExp(`"${field}"[\\s\\S]*?not accepted by the minimum Mindbody profile form`),
  );
}

// The parent adds a redundant no-network guard and drives the form lock from
// full launch readiness rather than the weaker inventory-preview flag.
const parentGuard = trialPage.indexOf("if (!isTrialLocationReady(location ?? undefined))");
const intakeFetch = trialPage.indexOf('fetch("/api/book/trial"');
assert(parentGuard >= 0, "parent readiness guard is missing");
assert(intakeFetch > parentGuard, "parent readiness guard must run before the intake fetch");
assert.match(trialPage, /submissionEnabled=\{isTrialLocationReady\(location\)\}/);

// A forced direct POST for a preview-only site is rejected before any shared
// rate-limit or Redis lock state is touched.
const routeReadiness = trialRoute.indexOf("const trialReadiness = getKidsTrialReadiness");
const routeRateLimit = trialRoute.indexOf("const rateLimit = consumeSignupRateLimit");
const routeLock = trialRoute.indexOf("signupLock = await acquireDistributedActionLock");
assert(routeReadiness >= 0, "server readiness gate is missing");
assert(routeRateLimit > routeReadiness, "readiness must run before the rate limiter");
assert(routeLock > routeRateLimit, "distributed lock should remain after the rate limiter");

// Opening the form in preview mode must still produce a valid third progress
// step instead of leaving the progress rail with no current item.
assert.match(progressBar, /\{ k: "details", n: 3, label: "Preview the form" \}/);

console.log("Production trial form preview lock contracts passed.");
