# HubSpot Workflows — Court 16 Track 1

The app writes booking state to HubSpot; workflows react to those state
changes. Mindbody remains the only sender of password, verification, and
account-link tokens. HubSpot may remind or explain, but must never construct
or copy a Mindbody credential link.

The existing **form-submission nurture** that Ibtissam built in Phase 1
stays attached to the form. The Forms API submission keeps firing it —
nothing to change there.

---

## Workflow 1 — Staff trial notification

**Trigger:** `court16_booking_status` is equal to `pending_staff` AND
`court16_intent` is equal to `kid_trial`.

**Action:** Send internal email.

**To:** `STAFF_NOTIFY_EMAIL` (app env var — see `.env.example`). For
Track 1 a single recipient is fine; per-location routing using
`court16_location_slug` is a Track 2 improvement.

**Subject:** `New trial request — {{contact.court16_correlation_id}}`

**Body (template, using contact-property merge tokens):**

```
New trial request received.

Correlation: {{contact.court16_correlation_id}}
Location: {{contact.preferred_location}}
Class ID: {{contact.court16_class_id}}

Parent: {{contact.firstname}} {{contact.lastname}}
Email: {{contact.email}}
Phone: {{contact.phone}}

Child: {{contact.child_name}} {{contact.child_1___last_name}}
Age: {{contact.childage}}
Experience: {{contact.child_1___playing_level}}
School: {{contact.school}}
DOB: {{contact.child_date_of_birth}}

Lead source: {{contact.lead_source}}

One-click actions:
Confirm: {{contact.court16_staff_confirm_url}}
Reassign: {{contact.court16_staff_reassign_url}}
```

**Classification:** Internal notification. Not marketing.

---

## Workflow 2 — Parent trial confirmation

**Trigger:** `court16_booking_status` is equal to `confirmed` AND
`court16_intent` is equal to `kid_trial`.

**Action:** Send email to contact (the parent).

**Subject:** `Your Court 16 trial is confirmed`

**Body:** Class details merged from the Contact record. Include
"what to bring", location address, and (when we add it) a calendar ICS
link.

**Classification:** Transactional. Stuart has Marketing Email permissions,
so workflow-email with transactional classification is available.

---

## Workflow 3 — Parent Mindbody account nudge (DRAFT / OFF)

**HubSpot workflow:** `1820551993`

**HubSpot email:** `212772629316`

**Current safe state (2026-07-17):** workflow is disabled. The revised email
exists only in HubSpot's draft buffer; the old published revision must not be
used.

**Trigger:** Ridge Hill Deal enters `Requested Trial`. Re-enrollment is off.

**Actions:** wait 60 minutes, then send the associated parent a reminder to
use the separate secure email sent by Mindbody.

**Required gate before activation:**

- If family-account status is `parent_claim_pending`, send the reminder.
- If status is `parent_claimed` or later, end without sending.
- If the state is still unknown after 24 hours, create a staff follow-up task.

Email opens and clicks must not advance the status. They do not prove that the
parent created a password, completed OTP verification, added the child under
Family, or linked the existing child record.

**Email rule:** no Court 16 password button and no generic "Forgot password"
instruction. Copy says to find the separate `@mindbodyonline.com` Welcome
email. The child needs no separate password or login.

**Classification check:** HubSpot currently reports the email as
`isTransactional=false`. Ibtissam must review the subscription/transactional
classification in the email UI before activation.

**Activation order:** publish the reviewed email draft, test one new Ridge
Hill family, verify the status gate suppresses claimed parents, then turn on
the workflow.

Visual handoff: `public/package-a/06-password-setup-email.html`.

---

## Optional — Workflow 4: manual review / failed alerts

Consolidate into one workflow:

**Trigger:** `court16_booking_status` changes to `manual_review` OR
`failed`.

**Action:** Internal email to `STAFF_NOTIFY_EMAIL` with
`court16_failure_reason` + `court16_admin_retry_url`.

Skip Slack webhook for Track 1; add in Track 3 when volume justifies it.

---

## Testing a workflow

1. Set `HUBSPOT_ENV=sandbox` + use the sandbox portal's access token + form GUID.
2. Keep the workflow off and use HubSpot's workflow test function.
3. Hit the app's `/api/book/trial` with a test payload.
4. Verify the workflow enrolled the Contact (by matching email).
5. Verify the outbound email was queued (Workflow history shows the send).
6. Publish/activate only after the result is reviewed.

## Disaster recovery

If a workflow is accidentally deleted, rebuild from this doc. Trigger,
action, subject, and body are all documented here. Workflows are not
version-controlled by HubSpot — this doc is the canonical copy.
