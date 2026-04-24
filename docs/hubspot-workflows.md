# HubSpot Workflows — Court 16 Track 1

Two workflows own every email the app sends after a form submission. The
app writes `court16_booking_status` transitions on the Contact; workflows
react.

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

## Optional — Workflow 3: manual review / failed alerts

Consolidate into one workflow:

**Trigger:** `court16_booking_status` changes to `manual_review` OR
`failed`.

**Action:** Internal email to `STAFF_NOTIFY_EMAIL` with
`court16_failure_reason` + `court16_admin_retry_url`.

Skip Slack webhook for Track 1; add in Track 3 when volume justifies it.

---

## Testing a workflow

1. Set `HUBSPOT_ENV=sandbox` + use the sandbox portal's access token + form GUID.
2. Open the workflow in HubSpot, put it in History test mode.
3. Hit the app's `/api/book/trial` with a test payload.
4. Verify the workflow enrolled the Contact (by matching email).
5. Verify the outbound email was queued (Workflow history shows the send).
6. Mirror the workflow to production.

## Disaster recovery

If a workflow is accidentally deleted, rebuild from this doc. Trigger,
action, subject, and body are all documented here. Workflows are not
version-controlled by HubSpot — this doc is the canonical copy.
