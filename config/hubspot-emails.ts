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

export const TRIAL_EMAIL_TEMPLATE_IDS = {
  /** Sent to parents after staff-confirm or intro-confirm advances Deal to "Scheduled Trial". */
  confirmation: "212772627101", // Court 16 — Trial confirmation
  /** Sent 1h after Deal enters "Requested Trial" — sets up the MindBody password. */
  passwordSetup: "212772627104", // Court 16 — Password setup
  /** Sent 24h before the scheduled class. */
  reminder24h: "212772628841", // Court 16 — Trial reminder (24h)
  /** Sent when staff clicks Deny (spec 5). Uses Smart Content keyed on denial_reason. */
  denial: "212772628844", // Court 16 — Trial declined
} as const;

export type TrialEmailTemplateKey = keyof typeof TRIAL_EMAIL_TEMPLATE_IDS;
