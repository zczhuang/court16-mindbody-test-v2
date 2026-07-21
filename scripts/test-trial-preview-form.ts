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
