import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runTrialE2EConfirmation,
  runTrialE2EIntake,
  validateTrialE2ERequest,
  verifyTrialE2EReceipt,
} from "../lib/trial-e2e/core.ts";
import {
  makeTrialE2EFixtureClass,
  makeTrialE2EInitialValues,
  TRIAL_E2E_LOCATION_ID,
  TRIAL_E2E_LOCATION_NAME,
} from "../lib/trial-e2e/fixtures.ts";
import {
  evaluateTrialE2EPolicy,
  getTrialE2EPublicDescriptor,
  isTrialE2EHostAllowed,
  isTrialE2ERequestSecure,
  isTrialE2ESameOriginRequest,
} from "../lib/trial-e2e/policy.ts";
import {
  acquireTrialE2ELock,
  getStoredTrialE2EReceipt,
  openTrialE2EJournal,
  storeTrialE2EReceipt,
} from "../lib/trial-e2e/store.ts";
import {
  advanceTrialE2EJournal,
  createTrialE2EJournal,
  signTrialE2EJournal,
  verifyTrialE2EJournal,
} from "../lib/trial-e2e/journal.ts";
import type { TrialRequest } from "../lib/trial-types.ts";

const secret = "e2e-test-signing-secret-that-is-at-least-32-chars";
const audience = "court16-trial-e2e-tests";
const now = new Date("2026-07-20T16:00:00.000Z");
const submissionId = "123e4567-e89b-42d3-a456-426614174000";
const fixtureClass = makeTrialE2EFixtureClass(now);
const initial = makeTrialE2EInitialValues(submissionId);
const request = {
  ...initial,
  submissionId,
  childAge: 9,
  children: [
    {
      firstName: initial.childFirstName,
      lastName: initial.childLastName,
      age: 9,
      birthDate: initial.childBirthDate,
    },
  ],
  locationId: TRIAL_E2E_LOCATION_ID,
  locationName: TRIAL_E2E_LOCATION_NAME,
  classScheduleId: fixtureClass.classScheduleId,
  classId: fixtureClass.classId,
  className: fixtureClass.name,
  classDay: `${fixtureClass.dayOfWeek}, ${fixtureClass.date}`,
  classTime: fixtureClass.time,
  classStartsAt: fixtureClass.startsAt,
  coachName: fixtureClass.coach,
} as TrialRequest;

assert.deepEqual(validateTrialE2ERequest(request, now), []);
assert.match(request.parentEmail, /@example\.invalid$/);

const intake = runTrialE2EIntake(request, secret, audience, now);
assert.equal(intake.status, "pending_staff");
assert.equal(intake.cached, false);
assert.equal(intake.receipt.mode, "fixture");
assert.equal(intake.receipt.notificationEvidence.hubspotAdapterInvoked, false);
assert.equal(intake.receipt.notificationEvidence.staffNotifierInvoked, false);
assert.equal(intake.receipt.notificationEvidence.adminNotifierInvoked, false);
assert.equal(intake.receipt.notificationEvidence.externalDeliveryObservation, "not_observed");
assert(!JSON.stringify(intake.receipt).includes(request.parentEmail));
assert(!JSON.stringify(intake.receipt).includes(request.parentLastName));
assert.match(intake.receipt.verificationScope.join(" "), /contract simulation/i);
assert.match(
  intake.receipt.limitations.join(" "),
  /production trial-intake and staff-confirm route orchestration does not execute/i,
);

const repeatedIntake = runTrialE2EIntake(
  request,
  secret,
  audience,
  new Date(now.getTime() + 1000),
);
assert.deepEqual(repeatedIntake.receipt.ids, intake.receipt.ids);
assert.equal(repeatedIntake.receipt.runId, intake.receipt.runId);

const firstConfirm = runTrialE2EConfirmation(
  intake.receiptToken,
  secret,
  audience,
  new Date(now.getTime() + 2000),
);
assert.equal(firstConfirm.status, "confirmed");
assert.equal(firstConfirm.cached, false);
assert(firstConfirm.receipt.ids.saleId);
assert(firstConfirm.receipt.ids.visitId);
assert.match(
  firstConfirm.receipt.stages.find((stage) => stage.key === "trial_credit_checked_out")?.label ?? "",
  /simulated/i,
);

const retryConfirm = runTrialE2EConfirmation(
  firstConfirm.receiptToken,
  secret,
  audience,
  new Date(now.getTime() + 3000),
);
assert.equal(retryConfirm.status, "confirmed");
assert.equal(retryConfirm.cached, true);
assert.equal(retryConfirm.receipt.ids.saleId, firstConfirm.receipt.ids.saleId);
assert.equal(retryConfirm.receipt.ids.visitId, firstConfirm.receipt.ids.visitId);
assert.equal(
  retryConfirm.receipt.stages.filter((stage) => stage.key === "idempotent_confirm_retry").length,
  1,
);

const tampered = `${intake.receiptToken.slice(0, -1)}${
  intake.receiptToken.endsWith("a") ? "b" : "a"
}`;
assert.throws(() => verifyTrialE2EReceipt(tampered, secret, now), /signature/i);
assert.throws(
  () => verifyTrialE2EReceipt(intake.receiptToken, secret, new Date("2026-07-22T17:00:00Z")),
  /expired/i,
);

const basePolicy = {
  enabled: "true",
  backend: "fixture",
  accessToken: "fixture-access-token-that-is-at-least-32-chars",
  signingSecret: secret,
  audience,
  nodeEnv: "development",
  localEnabled: "true",
};
assert.equal(evaluateTrialE2EPolicy(basePolicy).allowed, true);
assert.deepEqual(evaluateTrialE2EPolicy({ ...basePolicy, vercelEnv: "production" }), {
  allowed: false,
  reason: "production_forbidden",
});
assert.deepEqual(evaluateTrialE2EPolicy({ ...basePolicy, vercel: "1" }), {
  allowed: false,
  reason: "vercel_preview_required",
});
assert.deepEqual(
  evaluateTrialE2EPolicy({ ...basePolicy, hubspotAccessToken: "pat-prod" }),
  { allowed: false, reason: "production_hubspot_token_present" },
);
assert.equal(isTrialE2EHostAllowed("localhost:3000", undefined), true);
assert.equal(isTrialE2EHostAllowed("127.0.0.1:3000", undefined), true);
assert.equal(isTrialE2EHostAllowed("preview.example.com", undefined), false);
assert.equal(isTrialE2EHostAllowed("preview.example.com", "1"), true);
const proxiedLocalRequest = new Request("http://internal:3000/api/e2e/session", {
  headers: {
    host: "127.0.0.1:3016",
    origin: "http://127.0.0.1:3016",
    "x-forwarded-proto": "http",
  },
});
assert.equal(isTrialE2ESameOriginRequest(proxiedLocalRequest), true);
assert.equal(isTrialE2ERequestSecure(proxiedLocalRequest), false);
assert.equal(
  isTrialE2ESameOriginRequest(
    new Request("https://internal/api/e2e/session", {
      headers: {
        host: "preview.example.com",
        origin: "https://evil.example.com",
        "x-forwarded-proto": "https",
      },
    }),
  ),
  false,
);
assert.equal(
  isTrialE2ERequestSecure(
    new Request("http://internal/api/e2e/session", {
      headers: { "x-forwarded-proto": "https" },
    }),
  ),
  true,
);
const sandboxPolicy = {
  ...basePolicy,
  backend: "mindbody_sandbox",
  mindbodySiteId: "-99",
  mindbodyBaseUrl: "https://api.mindbodyonline.com/public/v6",
  sandboxWritesEnabled: "true",
  redisUrl: "https://e2e-example.upstash.io",
  redisToken: "e2e-redis-token",
};
assert.deepEqual(
  evaluateTrialE2EPolicy({ ...sandboxPolicy, mindbodySiteId: "5748154" }),
  { allowed: false, reason: "sandbox_site_required" },
);
assert.equal(
  evaluateTrialE2EPolicy({
    ...sandboxPolicy,
    vercel: "1",
    vercelEnv: "preview",
  }).allowed,
  true,
);
assert.equal(
  evaluateTrialE2EPolicy({ ...sandboxPolicy, mindbodyBaseUrl: undefined }).allowed,
  true,
);
assert.deepEqual(
  evaluateTrialE2EPolicy({
    ...sandboxPolicy,
    realWritesEnabled: "true",
  }),
  { allowed: false, reason: "real_site_write_gate_present" },
);
assert.deepEqual(
  evaluateTrialE2EPolicy({
    ...sandboxPolicy,
    redisUrl: undefined,
    redisToken: undefined,
  }),
  { allowed: false, reason: "sandbox_store_missing" },
);
assert.deepEqual(
  evaluateTrialE2EPolicy({
    ...sandboxPolicy,
    mindbodyBaseUrl: "https://proxy.example.com/public/v6",
  }),
  { allowed: false, reason: "sandbox_base_url_required" },
);
assert.deepEqual(
  evaluateTrialE2EPolicy({
    ...sandboxPolicy,
    productionRedisUrl: "https://e2e-example.upstash.io/",
  }),
  { allowed: false, reason: "sandbox_store_not_isolated" },
);
assert.deepEqual(
  evaluateTrialE2EPolicy({
    ...sandboxPolicy,
    productionRedisToken: "e2e-redis-token",
  }),
  { allowed: false, reason: "sandbox_store_not_isolated" },
);
const sandboxDescriptor = getTrialE2EPublicDescriptor("mindbody_sandbox");
assert.equal(sandboxDescriptor.notifications.court16HubspotAdapterInvoked, false);
assert(!("mindbodyAccountEmail" in sandboxDescriptor.notifications));

const redisValues = new Map<string, string>();
const redisCommands: string[][] = [];
const redisFetch: typeof fetch = async (_input, init) => {
  const command = JSON.parse(String(init?.body)) as string[];
  redisCommands.push(command);
  if (command[0] === "SET" && command.includes("NX")) {
    if (redisValues.has(command[1])) return Response.json({ result: null });
    redisValues.set(command[1], command[2]);
    return Response.json({ result: "OK" });
  }
  if (command[0] === "SET") {
    redisValues.set(command[1], command[2]);
    return Response.json({ result: "OK" });
  }
  if (command[0] === "GET") {
    return Response.json({ result: redisValues.get(command[1]) ?? null });
  }
  if (command[0] === "EVAL") {
    const key = command[3];
    const expected = command[4];
    const matched = redisValues.get(key) === expected;
    if (matched && command.length >= 7) {
      redisValues.set(key, command[5]);
    } else if (matched) {
      redisValues.delete(key);
    }
    return Response.json({ result: matched ? 1 : 0 });
  }
  return Response.json({ error: "unsupported" });
};
const storeConfig = {
  url: "https://e2e-lock-test.upstash.io",
  token: "dedicated-e2e-token",
  audience,
};
const firstLock = await acquireTrialE2ELock(
  storeConfig,
  `run:${submissionId}`,
  redisFetch,
);
assert(firstLock);
assert.equal(
  await acquireTrialE2ELock(storeConfig, `run:${submissionId}`, redisFetch),
  null,
  "concurrent runs must not acquire the same durable lock",
);
await storeTrialE2EReceipt(
  storeConfig,
  submissionId,
  firstConfirm.receiptToken,
  redisFetch,
);
assert.equal(
  await getStoredTrialE2EReceipt(storeConfig, submissionId, redisFetch),
  firstConfirm.receiptToken,
);
await firstLock.release();
const afterRelease = await acquireTrialE2ELock(
  storeConfig,
  `run:${submissionId}`,
  redisFetch,
);
assert(afterRelease);
await afterRelease.release();

const journal = await openTrialE2EJournal(
  storeConfig,
  {
    submissionId,
    runId: intake.receipt.runId,
    signingSecret: secret,
    createIfMissing: true,
  },
  redisFetch,
);
assert.equal(journal.current().phase, "initialized");
await journal.advance("parent_add_started");
await journal.advance("parent_add_started", { parentClientId: "parent-99" });
await journal.advance("parent_verified", { parentClientId: "parent-99" });
await journal.advance("child_add_started");
await journal.advance("child_add_started", { childClientId: "child-99" });
await journal.advance("family_verified", { childClientId: "child-99" });
const reopenedJournal = await openTrialE2EJournal(
  storeConfig,
  {
    submissionId,
    runId: intake.receipt.runId,
    signingSecret: secret,
    createIfMissing: false,
  },
  redisFetch,
);
assert.equal(reopenedJournal.current().phase, "family_verified");
assert.equal(reopenedJournal.current().parentClientId, "parent-99");
assert.equal(reopenedJournal.current().childClientId, "child-99");
const staleJournal = await openTrialE2EJournal(
  storeConfig,
  {
    submissionId,
    runId: intake.receipt.runId,
    signingSecret: secret,
    createIfMissing: false,
  },
  redisFetch,
);
await reopenedJournal.advance("checkout_started");
await assert.rejects(
  () => staleJournal.advance("service_verified"),
  /changed concurrently/i,
  "a stale journal writer must fail its compare-and-set",
);

const unsignedJournal = createTrialE2EJournal({
  audience,
  submissionId,
  runId: intake.receipt.runId,
  now,
});
assert.throws(
  () => advanceTrialE2EJournal(unsignedJournal, "checkout_started", {}, now),
  /unsafe/i,
);
const signedJournal = signTrialE2EJournal(unsignedJournal, secret);
assert.equal(
  verifyTrialE2EJournal(signedJournal, secret, {
    audience,
    submissionId,
    runId: intake.receipt.runId,
  }, now).phase,
  "initialized",
);
assert.throws(
  () => verifyTrialE2EJournal(`${signedJournal.slice(0, -1)}x`, secret, {
    audience,
    submissionId,
    runId: intake.receipt.runId,
  }, now),
  /signature/i,
);
assert(
  redisCommands.every((command) => !command[1]?.includes(submissionId)),
  "Redis keys must not expose the submission ID",
);

const productionTrial = readFileSync(
  new URL("../app/api/book/trial/route.ts", import.meta.url),
  "utf8",
);
const productionConfirm = readFileSync(
  new URL("../app/api/staff/confirm/route.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(productionTrial, /TRIAL_E2E|e2e\/trial/i);
assert.doesNotMatch(productionConfirm, /TRIAL_E2E|e2e\/trial/i);

const sandboxSource = readFileSync(
  new URL("../lib/trial-e2e/sandbox.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(sandboxSource, /@\/lib\/hubspot|api\.hubapi\.com/i);
assert.match(sandboxSource, /siteId:\s*SANDBOX_SITE_ID/g);
assert.match(sandboxSource, /SendAccountEmails:\s*false/);
assert.match(sandboxSource, /SendScheduleEmails:\s*false/);
assert.match(sandboxSource, /SendEmail:\s*false/);
function assertSourceOrder(before: string, after: string, message: string) {
  const beforeIndex = sandboxSource.indexOf(before);
  const afterIndex = sandboxSource.indexOf(after);
  assert(beforeIndex >= 0, `${message}: missing durable marker`);
  assert(afterIndex >= 0, `${message}: missing vendor mutation`);
  assert(beforeIndex < afterIndex, message);
}
assertSourceOrder(
  'await journal.advance("parent_add_started")',
  "parent = await addClient",
  "parent_add_started must be durable before parent AddClient",
);
assertSourceOrder(
  'await journal.advance("child_add_started")',
  "child = await addClient",
  "child_add_started must be durable before child AddClient",
);
assert(
  sandboxSource.includes('initialPhase === "parent_add_started"') &&
    sandboxSource.includes("reconciliationCompleted"),
  "a parent_add_started retry must stop before downstream child mutation",
);
assertSourceOrder(
  'await journal.advance("checkout_started")',
  "const checkout = await checkoutTrialBooking",
  "checkout_started must be durable before CheckoutShoppingCart",
);
assertSourceOrder(
  'await journal.advance("enrollment_started")',
  "const enrollment = await addClientToClass",
  "enrollment_started must be durable before AddClientToClass",
);

console.log("Protected trial E2E policy, receipt, fixture, and isolation tests passed.");
