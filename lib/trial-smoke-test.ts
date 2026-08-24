import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Server-side gate for the per-site production smoke test.
 *
 * A smoke run books a real occurrence at a real club through the normal intake
 * route, but must not email the family and must mark its CRM records as test
 * data. Suppression is therefore a production behaviour change, and the gate
 * that unlocks it is deliberately narrow:
 *
 * - It is server-side only. A client-supplied field can never suppress a real
 *   parent's Mindbody account email.
 * - Presenting the smoke header is a statement of intent. If the header is
 *   present but anything about it fails to qualify, the request is REJECTED,
 *   never silently downgraded to a normal booking — a mistyped token during an
 *   intended smoke test must not create a real family record and send real
 *   mail.
 * - A request with no smoke header is an ordinary production booking and is
 *   completely unaffected.
 */

export const TRIAL_SMOKE_TEST_HEADER = "x-court16-smoke-test";

/** Mirrors the >=32 char floor already required of STAFF_CONFIRM_SIGNING_SECRET. */
const MIN_SECRET_LENGTH = 32;

export type TrialSmokeTestReason =
  | "malformed_token"
  | "empty_token"
  | "smoke_disabled"
  | "secret_not_configured"
  | "token_mismatch"
  | "site_not_allowlisted";

export type TrialSmokeTestResult =
  | { mode: "production" }
  | { mode: "smoke"; siteId: string }
  | { mode: "rejected"; reason: TrialSmokeTestReason };

interface EvaluateTrialSmokeTestInput {
  siteId: string | number;
  /**
   * Raw value of TRIAL_SMOKE_TEST_HEADER; null/undefined when absent.
   *
   * Typed `unknown` on purpose: this arrives from an untrusted runtime source.
   * App Router's `Headers.get()` yields `string | null`, but a caller wired to
   * Node-style raw headers could hand us `string[]`, and that must resolve to a
   * rejection rather than throwing inside the evaluator.
   */
  headerToken?: unknown;
  smokeEnabled?: string;
  smokeSecret?: string;
  allowedSiteIds?: string;
}

function parseSiteAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/** Constant-time compare over fixed-length digests so length is not leaked. */
function secretEquals(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

export function evaluateTrialSmokeTest({
  siteId,
  headerToken,
  smokeEnabled,
  smokeSecret,
  allowedSiteIds,
}: EvaluateTrialSmokeTestInput): TrialSmokeTestResult {
  // Absent header: an ordinary parent booking. Never touch its behaviour.
  if (headerToken == null) {
    return { mode: "production" };
  }

  // From here the caller has declared smoke intent, so every failure below is
  // a rejection rather than a fallthrough to a real booking.

  // An unexpected header shape (e.g. string[] from Node-style raw headers) is
  // smoke intent we cannot verify. Reject it instead of throwing on .trim().
  if (typeof headerToken !== "string") {
    return { mode: "rejected", reason: "malformed_token" };
  }

  // A present-but-empty header is NOT the same as an absent one. The common
  // case is `curl -H "x-court16-smoke-test: $TOKEN"` with TOKEN unset, which
  // sends the header with an empty value. Treating that as an ordinary booking
  // would create a durable real family record for a fake child and email a real
  // address — exactly what this gate exists to prevent. Whitespace-only is the
  // same mistake.
  if (headerToken.trim() === "") {
    return { mode: "rejected", reason: "empty_token" };
  }

  if (smokeEnabled !== "true") {
    return { mode: "rejected", reason: "smoke_disabled" };
  }
  if (smokeSecret === undefined || smokeSecret.length < MIN_SECRET_LENGTH) {
    return { mode: "rejected", reason: "secret_not_configured" };
  }
  if (!secretEquals(headerToken, smokeSecret)) {
    return { mode: "rejected", reason: "token_mismatch" };
  }

  const normalizedSiteId = String(siteId).trim();
  if (!parseSiteAllowlist(allowedSiteIds).has(normalizedSiteId)) {
    return { mode: "rejected", reason: "site_not_allowlisted" };
  }

  return { mode: "smoke", siteId: normalizedSiteId };
}

export function getTrialSmokeTest(
  siteId: string | number,
  headerToken?: string | null,
): TrialSmokeTestResult {
  return evaluateTrialSmokeTest({
    siteId,
    headerToken,
    smokeEnabled: process.env.TRIAL_SMOKE_TEST_ENABLED,
    smokeSecret: process.env.TRIAL_SMOKE_TEST_SECRET,
    allowedSiteIds: process.env.TRIAL_SMOKE_TEST_SITE_IDS,
  });
}

export class TrialSmokeTestRejectedError extends Error {
  readonly code = "trial_smoke_test_rejected";
  readonly reason: TrialSmokeTestReason;

  constructor(reason: TrialSmokeTestReason) {
    super(`Trial smoke test rejected: ${reason}`);
    this.name = "TrialSmokeTestRejectedError";
    this.reason = reason;
  }
}

/**
 * Mindbody client communication flags for this request.
 *
 * Production intake deliberately sets both true so the Mindbody account-link
 * CTA fires. A smoke run sets both false. There is no third state.
 *
 * A rejected request must already have aborted before reaching here, so this
 * throws rather than answering. Returning production defaults for a rejection
 * would hand a caller who forgot to check `mode` a plausible-looking result and
 * let the booking proceed for real — the exact outcome the gate exists to
 * prevent. Refusing to answer makes that mistake impossible rather than
 * merely discouraged.
 */
export function trialSmokeTestCommunicationFlags(result: TrialSmokeTestResult): {
  SendAccountEmails: boolean;
  SendScheduleEmails: boolean;
} {
  if (result.mode === "rejected") {
    throw new TrialSmokeTestRejectedError(result.reason);
  }
  const smoke = result.mode === "smoke";
  return { SendAccountEmails: !smoke, SendScheduleEmails: !smoke };
}
