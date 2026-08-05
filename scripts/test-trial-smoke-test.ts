import { readFileSync } from "node:fs";

const smokeModuleUrl = new URL("../lib/trial-smoke-test.ts", import.meta.url).href;
const {
  evaluateTrialSmokeTest,
  trialSmokeTestCommunicationFlags,
  TRIAL_SMOKE_TEST_HEADER,
} = await import(smokeModuleUrl);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SECRET = "0123456789abcdef0123456789abcdef";
const RIDGEHILL = 5748154;
const ALLOWED = "5748154";

assert(SECRET.length >= 32, "test secret must satisfy the module's own floor");
assert(TRIAL_SMOKE_TEST_HEADER === "x-court16-smoke-test", "header name is part of the contract");

// --- An ordinary parent booking is never affected. ---

for (const headerToken of [undefined, null]) {
  const ordinary = evaluateTrialSmokeTest({
    siteId: RIDGEHILL,
    headerToken,
    smokeEnabled: "true",
    smokeSecret: SECRET,
    allowedSiteIds: ALLOWED,
  });
  assert(
    ordinary.mode === "production",
    "a request with no smoke header must stay an ordinary production booking",
  );
}

// A present-but-empty header is smoke intent with a broken token, not an
// ordinary booking. `curl -H "x-court16-smoke-test: $TOKEN"` with TOKEN unset
// is the realistic way a tester produces this, and silently booking it for
// real would create a durable record for a fake child.
for (const headerToken of ["", " ", "\t", "\n"]) {
  const emptyToken = evaluateTrialSmokeTest({
    siteId: RIDGEHILL,
    headerToken,
    smokeEnabled: "true",
    smokeSecret: SECRET,
    allowedSiteIds: ALLOWED,
  });
  assert(
    emptyToken.mode === "rejected" && emptyToken.reason === "empty_token",
    `an empty smoke header must be rejected, not treated as a real booking (got ${JSON.stringify(headerToken)})`,
  );
}

// The same must hold when the deployment has smoke mode switched off, so a
// stray empty header on a normal production deployment still cannot book.
const emptyTokenDisabled = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: "",
  smokeEnabled: undefined,
  smokeSecret: undefined,
  allowedSiteIds: undefined,
});
assert(
  emptyTokenDisabled.mode === "rejected",
  "an empty smoke header must never resolve to production, even with smoke disabled",
);

const productionFlags = trialSmokeTestCommunicationFlags({ mode: "production" });
assert(
  productionFlags.SendAccountEmails === true && productionFlags.SendScheduleEmails === true,
  "production must keep both Mindbody communication flags true",
);

// --- Smoke intent never silently downgrades to a real booking. ---
// This is the property that matters most: a mistyped or misconfigured smoke
// run must fail loudly, not quietly create a real family and email them.

const wrongToken = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: "0123456789abcdef0123456789abcdeg",
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: ALLOWED,
});
assert(
  wrongToken.mode === "rejected" && wrongToken.reason === "token_mismatch",
  "a wrong token must be rejected, never treated as a normal booking",
);

const disabled = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: SECRET,
  smokeEnabled: undefined,
  smokeSecret: SECRET,
  allowedSiteIds: ALLOWED,
});
assert(
  disabled.mode === "rejected" && disabled.reason === "smoke_disabled",
  "smoke header against a disabled deployment must be rejected",
);

for (const smokeEnabled of ["TRUE", "1", "yes", " true"]) {
  const nearMiss = evaluateTrialSmokeTest({
    siteId: RIDGEHILL,
    headerToken: SECRET,
    smokeEnabled,
    smokeSecret: SECRET,
    allowedSiteIds: ALLOWED,
  });
  assert(
    nearMiss.mode === "rejected" && nearMiss.reason === "smoke_disabled",
    `only the exact string "true" may enable smoke mode (got ${smokeEnabled})`,
  );
}

const noSecret = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: SECRET,
  smokeEnabled: "true",
  smokeSecret: undefined,
  allowedSiteIds: ALLOWED,
});
assert(
  noSecret.mode === "rejected" && noSecret.reason === "secret_not_configured",
  "an unset secret must fail closed",
);

const shortSecret = "0123456789abcdef0123456789abcde";
const weakSecret = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: shortSecret,
  smokeEnabled: "true",
  smokeSecret: shortSecret,
  allowedSiteIds: ALLOWED,
});
assert(
  weakSecret.mode === "rejected" && weakSecret.reason === "secret_not_configured",
  "a secret below the length floor must fail closed even if the token matches it",
);

// --- Site scoping is exact. ---

const notAllowlisted = evaluateTrialSmokeTest({
  siteId: 135479,
  headerToken: SECRET,
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: ALLOWED,
});
assert(
  notAllowlisted.mode === "rejected" && notAllowlisted.reason === "site_not_allowlisted",
  "a valid token must not unlock a club that is not allowlisted",
);

const emptyAllowlist = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: SECRET,
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: undefined,
});
assert(
  emptyAllowlist.mode === "rejected" && emptyAllowlist.reason === "site_not_allowlisted",
  "an unset allowlist must unlock nothing",
);

// A prefix of an allowlisted Site ID must not match it.
const prefixSite = evaluateTrialSmokeTest({
  siteId: 574815,
  headerToken: SECRET,
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: ALLOWED,
});
assert(
  prefixSite.mode === "rejected" && prefixSite.reason === "site_not_allowlisted",
  "site matching must be exact, not prefix-based",
);

// --- The one path that qualifies. ---

const approved = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: SECRET,
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: " 5748154 , 5751422 ",
});
assert(
  approved.mode === "smoke" && approved.siteId === "5748154",
  "exact token plus allowlisted Site ID should qualify, tolerating allowlist whitespace",
);

const smokeFlags = trialSmokeTestCommunicationFlags(approved);
assert(
  smokeFlags.SendAccountEmails === false && smokeFlags.SendScheduleEmails === false,
  "a smoke run must suppress both Mindbody communication flags",
);

// Only one club at a time is a runbook rule, but multiple entries must still
// scope correctly when the allowlist is edited between runs.
const secondClub = evaluateTrialSmokeTest({
  siteId: 5751422,
  headerToken: SECRET,
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: " 5748154 , 5751422 ",
});
assert(secondClub.mode === "smoke", "each allowlisted club should resolve independently");

// A duplicated header arrives comma-joined from the Web Request API. Even when
// every copy is the real token, the joined value must not qualify.
const duplicatedHeader = evaluateTrialSmokeTest({
  siteId: RIDGEHILL,
  headerToken: `${SECRET}, ${SECRET}`,
  smokeEnabled: "true",
  smokeSecret: SECRET,
  allowedSiteIds: ALLOWED,
});
assert(
  duplicatedHeader.mode === "rejected" && duplicatedHeader.reason === "token_mismatch",
  "a comma-joined duplicate header must not qualify",
);

// siteId coercion must fail closed on anything that is not the exact ID.
for (const siteId of ["05748154", "+5748154", "5748154.0", "5,748,154", "574815"]) {
  const coerced = evaluateTrialSmokeTest({
    siteId,
    headerToken: SECRET,
    smokeEnabled: "true",
    smokeSecret: SECRET,
    allowedSiteIds: ALLOWED,
  });
  assert(
    coerced.mode === "rejected" && coerced.reason === "site_not_allowlisted",
    `siteId ${siteId} must not match the allowlisted club`,
  );
}

// The numeric and string spellings of the same club are the same club.
for (const siteId of [5748154, "5748154", " 5748154 "]) {
  const equivalent = evaluateTrialSmokeTest({
    siteId,
    headerToken: SECRET,
    smokeEnabled: "true",
    smokeSecret: SECRET,
    allowedSiteIds: ALLOWED,
  });
  assert(equivalent.mode === "smoke", `siteId ${JSON.stringify(siteId)} should resolve to the club`);
}

// An unexpected header shape rejects rather than throwing inside the evaluator.
for (const headerToken of [[SECRET], [], 42, {}, true]) {
  const malformed = evaluateTrialSmokeTest({
    siteId: RIDGEHILL,
    headerToken,
    smokeEnabled: "true",
    smokeSecret: SECRET,
    allowedSiteIds: ALLOWED,
  });
  assert(
    malformed.mode === "rejected" && malformed.reason === "malformed_token",
    `a non-string smoke header must be rejected (got ${JSON.stringify(headerToken)})`,
  );
}

// Only a production result may yield sending flags. Asking for flags on a
// rejection is a caller bug -- the request should already have aborted -- so
// the function refuses rather than handing back production defaults that would
// let the booking proceed for real.
const productionOnly = trialSmokeTestCommunicationFlags({ mode: "production" });
assert(
  productionOnly.SendAccountEmails === true && productionOnly.SendScheduleEmails === true,
  "a production booking must keep both flags true",
);

for (const reason of [
  "malformed_token",
  "empty_token",
  "smoke_disabled",
  "secret_not_configured",
  "token_mismatch",
  "site_not_allowlisted",
]) {
  let threw = false;
  try {
    trialSmokeTestCommunicationFlags({ mode: "rejected", reason });
  } catch (error) {
    threw = true;
    assert(
      (error as { code?: string }).code === "trial_smoke_test_rejected",
      `rejection ${reason} must throw the typed smoke-test error`,
    );
    assert(
      (error as { reason?: string }).reason === reason,
      `the thrown error must carry the ${reason} reason for logging`,
    );
  }
  assert(threw, `asking for flags on a ${reason} rejection must throw, not return defaults`);
}

// --- Route wiring: a rejection must abort before any side effect. ---
// Source-level assertions, matching how test-trial-e2e.ts and
// test-trial-preview-form.ts already pin production route guarantees.

const trialRoute = readFileSync(
  new URL("../app/api/book/trial/route.ts", import.meta.url),
  "utf8",
);

const gateCall = trialRoute.indexOf("const smokeTest = getTrialSmokeTest(");
const gateAbort = trialRoute.indexOf('code: "trial_request_not_authorized"');
assert(gateCall > 0, "the trial route must evaluate the smoke-test gate");
assert(gateAbort > gateCall, "the trial route must abort on a rejected smoke result");

// Every vendor/side-effect entry point must come after the abort. This is the
// regression that matters: moving the gate below any of these would let a
// rejected smoke request touch Mindbody or HubSpot before being refused.
for (const sideEffect of [
  "loadConfigFromEnv(",
  "getMindbodyWriteGuard(",
  "loadHubspotConfig(",
  "getKidsTrialReadiness(",
]) {
  const at = trialRoute.indexOf(sideEffect);
  assert(at > 0, `expected to find ${sideEffect} in the trial route`);
  assert(
    at > gateAbort,
    `${sideEffect} must not run before a rejected smoke request is refused`,
  );
}

// The parent AddClient call must derive its flags from the gate, never
// hard-code them, so suppression cannot drift away from the decision.
assert(
  trialRoute.includes("...trialSmokeTestCommunicationFlags(smokeTest)"),
  "parent AddClient must take its communication flags from the smoke-test gate",
);
assert(
  !/^\s*SendAccountEmails:\s*true,/m.test(trialRoute),
  "the trial route must no longer hard-code SendAccountEmails: true",
);

// The rejection reason must stay server-side; the client response must not
// disclose which check failed or that a smoke lane exists.
const clientFacingReason = /return NextResponse\.json\([\s\S]{0,400}?reason: smokeTest\.reason/;
assert(
  !clientFacingReason.test(trialRoute),
  "the smoke-test rejection reason must not be returned to the client",
);

console.log("Trial smoke-test gate contracts passed.");
