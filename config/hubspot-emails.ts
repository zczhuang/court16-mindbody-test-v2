/**
 * HubSpot marketing-email asset IDs for the Trials Deal pipeline
 * workflows (Package A specs 6 + 7) and the staff-confirm denial
 * email (spec 5).
 *
 * All four templates were created as DRAFTs via the HubSpot API on
 * 2026-05-12 (state="DRAFT", isPublished=false). Ibtissam edits the
 * body copy + flips published state from the HubSpot UI before the
 * referenced workflows can send. The IDs themselves are stable —
 * editing copy in HubSpot doesn't change the ID.
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
  /** Sent 1h after Deal enters "Requested Trial" — sets up the MindBody password. */
  passwordSetup: "212772629316",
  /** Sent 24h before the scheduled class. */
  reminder24h: "212773969554",
  /** Sent when staff clicks Deny (spec 5). Uses Smart Content keyed on denial_reason. */
  denial: "212773969562",
} as const;

export type TrialEmailTemplateKey = keyof typeof TRIAL_EMAIL_TEMPLATE_IDS;

/**
 * Pre-built workflow shells on HubSpot. Both have the enrollment trigger
 * fully configured (Deal in ANY of the 6 location-specific stages); the
 * v4 flows API rejected rich action graphs (500s on send-email actions),
 * so the 2 action steps per workflow are Ibtissam's drag-in-builder
 * task. Both shells were created with enabled=false.
 */
export const PACKAGE_A_WORKFLOW_SHELLS = {
  /**
   * Spec 6 — fires when Deal enters Requested Trial. Ibtissam adds:
   * (1) Delay 1h, (2) Send email = passwordSetup asset.
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
   * to 'failed' (after staff/deny). Email uses HUBL conditionals on
   * court16_failure_reason to render reason-specific copy. Ibtissam
   * adds: Send email = denial asset (no delay).
   */
  denial: "1820568681",
} as const;
