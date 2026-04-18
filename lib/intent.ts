// Pure intent classifier. Given user type + MindBody state, return the
// single intent we should route to. Matches Ideal-State §4.2 decision
// table and §14.3 pseudo-code.
//
// Track 1 handles only `kid_trial`, `adult_intro`, and `existing_user_softwall`.
// Track 2 handles `kid_enrollment`, `drop_in`. Keeping them all in the union
// so callers compile against the final surface — unsupported intents return
// the softwall state.

export type BookingFor = "kid" | "adult";

export type Intent =
  | "kid_trial"
  | "kid_enrollment"
  | "adult_intro"
  | "adult_class_pack"
  | "drop_in"
  | "existing_user_softwall";

export interface IntentInput {
  bookingFor: BookingFor;
  /** Whether GetClients-by-email found an exact match. */
  mindbodyClientExists: boolean;
  /** Track 2 only. In Track 1 always pass `false`. */
  hasCompletedTrial?: boolean;
  /** Track 2 only. */
  hasCompletedIntro?: boolean;
  /** Track 3 only. */
  hasActiveMembership?: boolean;
}

export function classifyIntent(input: IntentInput): Intent {
  const {
    bookingFor,
    mindbodyClientExists,
    hasCompletedTrial,
    hasCompletedIntro,
    hasActiveMembership,
  } = input;

  // Returning user without auth: softwall until Track 2's magic-link flow ships.
  if (mindbodyClientExists) {
    return "existing_user_softwall";
  }

  if (bookingFor === "kid") {
    // The commented rules are correct — Track 1 never reaches them because
    // we softwalled returning users above, but the logic is here so Track 2
    // can lift `mindbodyClientExists` gating without rewriting this file.
    if (hasActiveMembership) return "drop_in";
    if (hasCompletedTrial) return "kid_enrollment";
    return "kid_trial";
  }

  // adult
  if (hasActiveMembership) return "drop_in";
  if (hasCompletedIntro) return "adult_class_pack";
  return "adult_intro";
}

/**
 * Track 1 only runs three intents. Guard callers from the full union by
 * forcing them to declare support when extending to Track 2/3.
 */
export const TRACK_1_INTENTS: ReadonlySet<Intent> = new Set([
  "kid_trial",
  "adult_intro",
  "existing_user_softwall",
]);

export function isTrack1Intent(intent: Intent): boolean {
  return TRACK_1_INTENTS.has(intent);
}
