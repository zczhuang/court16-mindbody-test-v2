# HubSpot Workflows — Court 16 Track 1

The app writes booking state to HubSpot; workflows react to those state
changes. Mindbody remains the only sender of password, verification, and
account-link tokens. HubSpot may remind or explain, but must never construct
or copy a Mindbody credential link.

The existing **form-submission nurture** from Phase 1 must be inventoried
before launch. The Forms API submission can still enroll it, so any customer
confirmation, reminder, or follow-up that overlaps the workflows below must
be suppressed or retired. One event gets one customer-facing sender.

---

## Workflow 1 — Staff trial notification

**Trigger:** `court16_booking_status` is equal to `pending_staff` AND
`court16_intent` is equal to `kid_trial`.

**Action:** Send internal email.

**To:** Branch on `court16_location_slug` and send to the verified owner/queue
for that club. Do not use one Ridge Hill recipient for the six-site rollout.
The location-to-owner map must be approved before a club is enabled.

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
Deny: {{contact.court16_staff_deny_url}}
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

**Classification:** Transactional, subject to Ibtissam's subscription review.
The current connector reports Marketing Email and Workflow access as requiring
reauthorization; do not claim this asset can be edited or activated yet.

---

## Workflow 3 — Parent Mindbody account nudge (DRAFT / OFF)

**HubSpot workflow:** `1820551993`

**HubSpot email:** `212772629316`

**Current safe state (2026-07-17):** workflow is disabled. The revised email
exists only in HubSpot's draft buffer; the old published revision must not be
used.

**Trigger:** Ridge Hill Deal enters `Requested Trial`. Re-enrollment is off.

**Required action order:** wait 60 minutes, read the trusted family status,
branch, and send the associated parent a reminder only when the status is
`parent_claim_pending`. The current disabled revision does not yet have this
safe gate.

**Required gate before activation:**

- Read `court16_family_account_status` from a verified Mindbody readback or an
  explicit staff action tied to the original child Client ID.
- If status is `parent_claim_pending`, send the reminder.
- If status is `parent_claimed`, `child_link_pending`, or `family_complete`, end without sending.
- If status is `manual_review`, or the state is still unknown after 24 hours,
  stop customer messaging and create a staff follow-up task.

Email opens and clicks must not advance the status. They do not prove that the
parent created a password, completed OTP verification, added the child under
Family, or linked the existing child record. A staff action may advance it only
after the staff member observes the matching Mindbody UI/readback for the
original child Client ID—not from a parent reply alone.

**Email rule:** no Court 16 password button and no generic "Forgot password"
instruction. Copy says to find the separate `@mindbodyonline.com` Welcome
email. The child needs no separate password or login.

**Classification check:** HubSpot currently reports the email as
`isTransactional=false`. Ibtissam must review the subscription/transactional
classification in the email UI before activation.

**Activation order:** publish the reviewed email draft, use a tagged and
staff-approved Ridge Hill fixture with an assigned Mindbody cleanup owner,
verify the status gate suppresses claimed parents, then turn on the workflow.

Visual handoff: `public/package-a/06-password-setup-email.html`.

---

## Optional — Workflow 4: manual review / failed alerts

Consolidate into one workflow:

**Trigger:** `court16_booking_status` changes to `manual_review` OR
`failed`.

**Action:** Internal email to the location's verified staff queue with the
correlation ID, `court16_failure_reason`, and only the currently supported
signed actions: `court16_staff_confirm_url`, `court16_staff_reassign_url`, and
`court16_staff_deny_url`. There is no `court16_admin_retry_url` route.

Skip Slack webhook for Track 1; add in Track 3 when volume justifies it.

---

## Testing a workflow

1. Keep the workflow off and use HubSpot's workflow-test function with an
   existing tagged, staff-approved Contact/Deal fixture.
2. A HubSpot sandbox does not sandbox Mindbody. Do not hit `/api/book/trial`
   unless the current multi-site audit gates pass: verified Ridge Hill target,
   eligible occurrence, approved family, original Client-ID log, and named cleanup owner.
3. Verify the workflow selected the intended Contact and branch.
4. Verify the test email rendered correctly without enrolling live recipients.
5. Save the tested asset off. Publish/activate only the individually approved
   workflow after its owner, trigger, suppression branch, classification, and
   duplicate-message audit all pass. Workflow `1820551993` remains off until
   its family-status source is proven.

## Disaster recovery

If a workflow is accidentally deleted, use this document as the intended
contract, then compare it with the latest approved HubSpot asset inventory
before rebuilding. Workflows are not version-controlled by HubSpot; this file
does not prove that a live asset or its current action graph is safe.
