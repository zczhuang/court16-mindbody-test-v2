# HubSpot Workflows — Court 16 Booking

Five workflows own every email the app sends. The app writes status
transitions on the `court16_booking` custom object; workflows react.

**Requires:** HubSpot Marketing Hub Professional or higher for custom-object
triggers. Verify with Ibtissam before relying on this design.

---

## 1. Staff trial notification

**Trigger:** `court16_booking.status` is equal to `pending_staff` AND
`court16_booking.intent` is equal to `kid_trial`.

**Action:** Send internal email.

**To:** `STAFF_NOTIFY_EMAIL` (single recipient for Track 1 — upgrade to
per-location once `staff_notify_email_override` is wired in
`lib/config.ts`).

**Subject:** `New trial request for {{court16_booking.correlation_id}}`

**Body (template):**

```
New trial request received.

Correlation: {{court16_booking.correlation_id}}
Location: {{court16_booking.location_id}}
Class ID: {{court16_booking.class_id}}

Parent: {{associated_contact.firstname}} {{associated_contact.lastname}}
Email: {{associated_contact.email}}
Phone: {{associated_contact.phone}}

Child: {{associated_contact.court16_child_name}}
Age: {{associated_contact.court16_child_age}}

One-click actions:
Confirm: {{court16_booking.staff_confirm_url}}
Reassign: {{court16_booking.staff_reassign_url}}
```

**Classification:** Internal / staff. Not marketing.

---

## 2. Parent trial confirmation

**Trigger:** `court16_booking.status` is equal to `confirmed` AND
`court16_booking.intent` is equal to `kid_trial`.

**Action:** Send email to associated contact.

**Subject:** `Your Court 16 trial is confirmed`

**Body:** Class details merged from the booking record. Include
"what to bring", location address, and a calendar ICS link.

**Classification:** Transactional (requires Transactional Email add-on OR
workflow email classified as transactional in Marketing Hub Pro+). Validate
with Ibtissam.

---

## 3. Adult intro confirmation

**Trigger:** `court16_booking.status = confirmed` AND `intent = adult_intro`.

Same pattern as #2, different subject / template.

---

## 4. Adult manual-review escalation

**Trigger:** `court16_booking.status = manual_review`.

**Action:** Internal email to `STAFF_NOTIFY_EMAIL` with booking details and
the `admin_retry_url` for one-click re-run after manual MindBody cleanup.

---

## 5. Booking failed alert

**Trigger:** `court16_booking.status = failed`.

**Action:**
- Primary: Internal email to `STAFF_NOTIFY_EMAIL` with failure reason +
  admin retry URL.
- Optional: HubSpot webhook action to `SLACK_ALERT_WEBHOOK` if configured.
  Keep payload minimal to respect Slack rate limits.

---

## Testing a workflow

1. In HubSpot, open the workflow and put it in "History" test mode.
2. Hit the app's `/api/book/trial` with a test payload (sandbox env).
3. Verify the workflow enrolled the booking record.
4. Verify the outbound email was queued (Workflow history shows the send).
5. Compare against the same workflow in production sandbox.

---

## Rebuild procedure (disaster recovery)

If a workflow is accidentally deleted:

1. Recreate with the trigger and action defined above.
2. Paste the template body from version control (this file).
3. Run the testing procedure.

Workflows in HubSpot are not version-controlled by HubSpot. This document
IS the version control. Update here whenever you update a workflow.
