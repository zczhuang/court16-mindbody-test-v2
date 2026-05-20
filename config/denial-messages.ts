/**
 * Per-reason denial message bodies (HTML), rendered server-side at deny
 * time and written to HubSpot Contact property `court16_denial_message`.
 *
 * Why this exists: HubSpot's DnD email editor strips HUBL `{% if %}` blocks
 * during Source Code ↔ WYSIWYG round-trips. The denial email asset
 * (212773969562) was originally written with 5 conditional branches keyed
 * on `contact.court16_failure_reason` — those conditionals didn't survive
 * Ibtissam's edits (May 19 email). Solution: pre-render the per-reason
 * copy on the backend, ship the email asset with a single
 * `{{ contact.court16_denial_message }}` token — zero HUBL conditionals,
 * 100% reliable across DnD editor round-trips.
 *
 * Key is the picklist `value` from `REASONS` in `app/api/staff/deny/route.ts`
 * (snake_case lowercase). The deny route reads the picked value, picks the
 * matching message, substitutes `{{child}}` and `{{note}}` placeholders
 * (NOT HUBL — simple JS string replace), and writes to the Contact.
 *
 * Trade-off: per-reason copy lives in the repo, not HubSpot UI. Ibtissam
 * can't tweak the wording without a code change. Acceptable because the
 * 5 reasons are operationally stable. If frequent copy iteration becomes
 * a real need, escalate to "5 separate email assets + workflow branching"
 * (the Option B fallback).
 *
 * Tokens supported in templates:
 *   {{child}}  - the kid's first name (from Contact's `child_name` property)
 *   {{note}}   - the optional staff-typed note (only used by the "other" reason)
 *
 * Tokens NOT supported (use the email template's own merge tokens for these):
 *   {{ contact.firstname }}, {{ contact.court16_correlation_id }}, etc.
 *   These live in the surrounding email body, not in this per-reason block.
 */

export const DENIAL_MESSAGES: Record<string, string> = {
  wrong_age_band: `<p><strong>The class you picked is for a different age range.</strong> Each Court 16 program is tightly age-gated so kids learn alongside peers of similar size and motor skill. The good news: we have a class that's a perfect fit for {{child}}. Reply to this email and we'll send over the options.</p>`,

  no_availability: `<p><strong>That specific class filled up before we could lock in {{child}}'s spot.</strong> We have other openings this week and next at your preferred location — happy to suggest alternatives. Just reply and we'll send a few times that work.</p>`,

  parent_cancelled: `<p><strong>Per your request, we've cancelled the trial.</strong> If anything changes and you'd like to re-book later, just reply to this email — your details are saved on our end and we can pick up where we left off.</p>`,

  duplicate_booking: `<p><strong>We already had a booking for {{child}} on file.</strong> To avoid sending duplicate confirmations or charging twice, we cancelled this newer request. If you meant to book a different child or a different time, just reply and we'll sort it out.</p>`,

  other: `<p><strong>Detail from our team:</strong> {{note}}</p>`,
};

/**
 * Render a denial message with placeholder substitution.
 *
 *  - `reason` must match a key in `DENIAL_MESSAGES`; unknown reasons fall
 *    back to the "other" template using the raw note (or a generic
 *    "please reply for details" if no note was supplied).
 *  - `child` substitutes for `{{child}}` — pass the Contact's
 *    `child_name` property value, falling back to "your child" if missing.
 *  - `note` substitutes for `{{note}}` — typically only meaningful for
 *    the "other" reason; pass the staff-typed string from the deny form.
 *
 * Output is HTML safe-by-construction: only the kid name + note get
 * substituted; both are escaped via the helper below before insertion.
 */
export function renderDenialMessage(args: {
  reason: string;
  child?: string | null;
  note?: string | null;
}): string {
  const template =
    DENIAL_MESSAGES[args.reason] ??
    DENIAL_MESSAGES.other;
  return template
    .replaceAll("{{child}}", escapeHtml(args.child || "your child"))
    .replaceAll(
      "{{note}}",
      escapeHtml(args.note?.trim() || "Please reply to this email and our team will follow up with specifics."),
    );
}

/**
 * Minimal HTML-escape helper for the two interpolated values. Defensive —
 * the deny form already sanitizes input on submit, but we re-escape here
 * so the rendered HTML is safe even if a staff member somehow injects
 * `<script>` into a denial note.
 */
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
