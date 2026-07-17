/**
 * HubSpot marketing-email asset IDs for the Trials Deal pipeline
 * workflows (Package A specs 6 + 7) and the staff-confirm denial
 * email (spec 5).
 *
 * These templates began as drafts on 2026-05-12. Their current live/draft
 * state must be checked in HubSpot rather than inferred from the asset name.
 * In particular, asset 212772629316 has an old published revision plus an
 * unpublished 2026-07-17 draft buffer. Workflow 1820551993 is disabled while
 * Ibtissam reviews that draft. The IDs themselves are stable — editing copy
 * in HubSpot doesn't change the ID.
 *
 * If a template gets archived or replaced, capture the new ID here.
 */

/**
 * AUTOMATED_EMAIL assets — what HubSpot workflows reference for sends.
 *
 * Cloned from Court 16's existing "BK - MINDBODY'S ACCOUNT CREATION
 * PENDING" automated template (id 47835784786) so they inherit the
 * brand styling. Subject lines reset; body copy is template
 * boilerplate until Ibtissam polishes.
 *
 * Earlier history: 4 MARKETING_SINGLE_SEND_API emails (212772627101 /
 * 04 / 28841 / 28844) were created first and archived 2026-05-12 once
 * we discovered workflows can only send AUTOMATED_EMAIL type, not
 * single-send API type. The IDs below replace those.
 */
export const TRIAL_EMAIL_TEMPLATE_IDS = {
  /** Sent to parents after staff-confirm or intro-confirm advances Deal to "Scheduled Trial". */
  confirmation: "212773423758",
  /**
   * Draft reminder sent 1h after Requested Trial. Mindbody—not HubSpot—owns
   * the actual password/claim link. Keep workflow 1820551993 disabled until
   * a parent-claim status gate is implemented and tested.
   */
  passwordSetup: "212772629316",
  /** Sent 24h before the scheduled class. */
  reminder24h: "212773969554",
  /**
   * Legacy single-asset denial email — the one with HUBL `{% if %}` blocks
   * that get stripped by HubSpot's DnD editor. Replaced by the per-reason
   * fan-out below (Stage K / Option B, May 20 decision). Kept here as a
   * historical reference; no longer wired into the denial workflow.
   */
  denial: "212773969562",
} as const;

/**
 * Stage K (Option B): per-reason denial email assets — one HubSpot asset
 * per picklist value from `app/api/staff/deny/route.ts` REASONS. The
 * denial workflow (1820568681) branches on `court16_failure_reason` and
 * sends the matching asset. This replaces the legacy single-asset
 * denial flow with HUBL conditionals (which HubSpot's DnD editor strips
 * during Source Code ↔ WYSIWYG round-trips — caught by Ibtissam on
 * May 19).
 *
 * Each asset was cloned from 212773969562 on May 20 via the
 * `POST /marketing/v3/emails/clone` endpoint and customized with a
 * per-reason paragraph body. State: AUTOMATED_DRAFT, isPublished: false
 * until Ibtissam publishes from the HubSpot UI.
 *
 * Owner: Ibtissam (HubSpot UI). She can edit each per-reason body
 * independently in the HubSpot email editor.
 */
export const TRIAL_DENIAL_EMAILS_BY_REASON = {
  /** Reason `wrong_age_band` from REASONS in app/api/staff/deny/route.ts */
  wrong_age_band: "213263710007",
  /** Reason `no_availability` */
  no_availability: "213269367704",
  /** Reason `parent_cancelled` */
  parent_cancelled: "213269367707",
  /** Reason `duplicate_booking` */
  duplicate_booking: "213263710012",
  /** Reason `other` — catch-all + default for any unrecognized picklist value */
  other: "213263710015",
} as const;

export type TrialDenialReasonKey = keyof typeof TRIAL_DENIAL_EMAILS_BY_REASON;

export type TrialEmailTemplateKey = keyof typeof TRIAL_EMAIL_TEMPLATE_IDS;

/**
 * Pre-built HubSpot workflows. State is external and must be verified in
 * HubSpot before any activation. As of 2026-07-17, workflow 1820551993 is
 * revision 6, Ridge Hill only, and disabled; its action graph is already
 * Delay 60 minutes → Send email 212772629316.
 */
export const PACKAGE_A_WORKFLOW_SHELLS = {
  /**
   * Spec 6 — parent Mindbody account nudge. Keep OFF until the email draft is
   * reviewed and the workflow can suppress parents who already claimed.
   */
  passwordSetup: "1820551993",
  /**
   * Spec 7 — fires when Deal enters Scheduled Trial. Ibtissam adds:
   * (1) Date-based delay (class_date - 24h), (2) Send email = reminder24h asset.
   */
  reminder24h: "1820562947",
  /**
   * Confirmation workflow — fires when Contact court16_booking_status
   * flips to 'confirmed' (after staff-confirm or intro/confirm).
   * Ibtissam adds: Send email = confirmation asset (no delay).
   */
  confirmation: "1820575928",
  /**
   * Denial workflow — fires when Contact court16_booking_status flips
   * to 'failed' (after staff/deny). Per Stage K Option B (May 20):
   * Ibtissam wires a 5-way branch on `court16_failure_reason` value
   * (CONTAINS each label) → Send the matching email from
   * `TRIAL_DENIAL_EMAILS_BY_REASON`. The default branch sends the
   * `other` email (catch-all). No delay between trigger and send.
   *
   * Branch logic (Ibtissam configures in HubSpot UI):
   *   IF court16_failure_reason CONTAINS "Wrong age band"     → send 213263710007
   *   ELSE IF CONTAINS "No availability"                       → send 213269367704
   *   ELSE IF CONTAINS "Parent cancelled"                      → send 213269367707
   *   ELSE IF CONTAINS "Duplicate booking"                     → send 213263710012
   *   ELSE                                                     → send 213263710015 (Other)
   */
  denial: "1820568681",
} as const;
