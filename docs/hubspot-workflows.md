# HubSpot Workflows — Court 16 Track 1

The app writes booking state to HubSpot; workflows react to those state
changes. Mindbody remains the only sender of password, verification, and
account-link tokens. HubSpot may remind or explain, but must never construct
or copy a Mindbody credential link.

The live Phase 1 inventory was completed on 2026-07-17. Workflow `1735576602`
is ON and sends one of six published “Step by Step Account Creation” emails
whenever legacy form `3e966ac4-872e-49ec-9b93-1f114fa6d39b` is submitted.
Six live location workflows also create Deals from that same form event. The
booking app already upserts the Contact and creates its own correlated Deal.
This branch now skips the legacy Forms API submission unless
`HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM=true`; keep that switch false for the new
path. Do not bulk-disable the legacy flows while the existing Squarespace form
still depends on them.

---

## Workflow 1 — Staff trial notification

**Live asset:** `1835369220`, verified **OFF** on 2026-07-17 (revision `5`).
Its current trigger is only `court16_booking_status=pending_staff`; the required
`court16_intent=kid_trial` filter and per-club recipient routing are not built.

**Proposed replacement (build and test OFF):** Deal-based workflow. Trigger
when Deal `court16_booking_status=pending_staff` AND
`court16_intent=kid_trial`. Require `court16_booking_ledger_version=1` and
exactly one associated Contact before sending.

**Action:** Send internal email.

**To:** Branch on `court16_location_slug` and send to the verified owner/queue
for that club. Do not use one Ridge Hill recipient for the six-site rollout.
The location-to-owner map must be approved before a club is enabled.

**Subject:** `New trial request — {{deal.court16_correlation_id}}`

**Body fields:** use the Deal for correlation, location, class, child snapshot,
Mindbody IDs, and all three signed staff URLs. Use the associated Contact only
for current parent name, email, and phone. Do not copy the Contact's current
child/class fields into this email; the same parent can have another request.

```
New trial request received.

Correlation: {{deal.court16_correlation_id}}
Location: {{deal.court16_location_slug}}
Class: {{deal.court16_class_name}}
Class ID: {{deal.court16_class_id}}

Parent: {{contact.firstname}} {{contact.lastname}}
Email: {{contact.email}}
Phone: {{contact.phone}}

Child: {{deal.court16_child_first_name}} {{deal.court16_child_last_name}}
Experience: {{deal.court16_child_playing_level}}
School: {{deal.court16_child_school}}
DOB: {{deal.court16_child_birth_date}}

One-click actions:
Confirm: {{deal.court16_staff_confirm_url}}
Reassign: {{deal.court16_staff_reassign_url}}
Deny: {{deal.court16_staff_deny_url}}
```

**Classification:** Internal notification. Not marketing.

---

## Workflow 2 — Parent trial confirmation

**Live asset:** workflow `1820575928`, email `212773423758`; verified **OFF**
on 2026-07-17 (revision `6`). Its current trigger is Ridge Hill-only and the
email is a published automated, non-transactional asset.

**Proposed replacement (build and test OFF):** Deal-based workflow. Trigger
when Deal `court16_booking_status=confirmed`, `court16_intent=kid_trial`,
`court16_enrollment_status=enrollment_verified`, and
`court16_mindbody_visit_id` is known. Send to the one associated Contact.

**Action:** Send email to contact (the parent).

**Subject:** `Your Court 16 trial is confirmed`

**Body:** Class details merged from the Deal; parent name/email come from the
associated Contact. Include
"what to bring", location address, and (when we add it) a calendar ICS
link.

**Classification:** intended as transactional, but the live asset reports
`isTransactional=false`; Ibtissam must review subscription classification.

---

## Workflow 3 — Parent Mindbody account nudge (LEGACY DRAFT OFF; REPLACE)

**HubSpot workflow:** `1853127851`

**Superseded shell:** `1820551993` remains off and unchanged; it is Deal-based
and has no trusted family-status branch.

**HubSpot email:** `212772629316`

**Current safe state (2026-07-17):** the Contact-based workflow is disabled at revision `1`.
The current API-visible email is published automated and reports
`isTransactional=false`; no send can occur through this workflow while it is
off. Ledger-v1 code no longer writes request or family state onto Contacts, so
this workflow must not be enabled as-is. Confirm any separate UI draft before
approving copy.

**Proposed replacement (build and test OFF):** Deal-based workflow. Trigger
when Deal has `court16_family_account_status=parent_claim_pending`,
`court16_intent=kid_trial`, `court16_booking_ledger_version=1`, and exactly one
associated Contact. Re-enrollment is off.

**Replacement action order:** wait 60 minutes, re-read the trusted Deal family status,
and send the parent email only when the status is still
`parent_claim_pending`. Every other value and unknown state ends without a send.

**Evidence rules before activation:**

- Read `court16_family_account_status` from a verified Mindbody readback or an
  explicit staff action tied to the original child Client ID.
- If status is `parent_claim_pending`, send the reminder.
- If status is `parent_claimed`, `child_link_pending`, or `family_complete`, end without sending.
- If status is `manual_review`, or the state is still unknown after 24 hours,
  stop customer messaging. A separate staff follow-up task is recommended but
  is not part of workflow `1853127851` yet.

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

**Activation order:** approve the reviewed email revision/classification, use a tagged and
staff-approved Ridge Hill fixture with an assigned Mindbody cleanup owner,
verify the status gate suppresses claimed parents, then turn on the workflow.

Visual handoff: `public/package-a/06-password-setup-email.html`.

---

## Optional — Workflow 4: manual review / failed alerts

Consolidate into one workflow:

**Trigger:** Deal `court16_booking_status` changes to `manual_review` OR
`failed` and ledger version is `1`.

**Action:** Internal email to the location's verified staff queue with the
Deal correlation ID, `court16_failure_reason`, and only the currently supported
signed actions: `court16_staff_confirm_url`, `court16_staff_reassign_url`, and
`court16_staff_deny_url`. There is no `court16_admin_retry_url` route.

Skip Slack webhook for Track 1; add in Track 3 when volume justifies it.

## Additional live shells — all OFF

- 24-hour reminder `1820562947`, revision `6`: Ridge Hill Scheduled stage,
  wait until `class_date - 24h`, then email `212773969554`.
- Trial denial `1820568681`, revision `11`: Ridge Hill failed status and four
  wired exact-reason branches. Email `213263710015` exists for “Other” but is
  not wired as a default branch.

Both need final status rechecks, canonical club routing, classification review,
and off-state tests before activation.

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
   duplicate-message audit all pass. Workflow `1853127851` remains off until
   its family-status transitions and suppression test are proven.

## Disaster recovery

If a workflow is accidentally deleted, use this document as the intended
contract, then compare it with the latest approved HubSpot asset inventory
before rebuilding. Workflows are not version-controlled by HubSpot; this file
does not prove that a live asset or its current action graph is safe.

## Stuck-request reconciliation runbook

Which requests can be resolved where:

- **Intake-stage `manual_review` Deals** (failure reason says no Mindbody
  write was attempted, `court16_family_provisioning_status` is `not_started`
  or `child_created`): use the signed **Deny** link. Denial is terminal — it
  records the reason and releases `court16_active_parent_key`, so the parent
  can submit again. Deny also marks a stale-active legacy Contact
  `court16_booking_status` mirror as `failed` so the shared email is not
  auto-held on the next request.
- **Pre-write confirm failures** (`[confirm_retry]` failure reason while
  enrollment and mutation status are still pre-write): the Deal is unchanged.
  Retry the same Confirm link, or Deny to resolve and release.
- **Post-write states** (`checkout_started`, `add_to_class_started`,
  `reconciliation_required`, or a half-provisioned family status): the app
  will not deny and will never request a **second checkout/credit**. One
  nuance: for a Deal stopped at `checkout_started`, the Confirm link can
  still finish the remaining enrollment using the already-granted credit it
  reads back — that completes the original booking, not a duplicate charge.
  A person must reconcile in this order:
  1. In Mindbody, check the client's account for the trial credit
     (ClientService) and the class roster for an active Visit that matches the
     Deal's class, location, and service.
  2. If the enrollment **did** commit: use the Confirm link — it performs a
     read-only readback and, on an exact Visit match, records the evidence and
     completes the Deal without a second write.
  3. If it provably did **not** commit (no credit, no visit): correct the Deal
     by hand in HubSpot — set `court16_enrollment_status` and
     `court16_mindbody_mutation_status` back to `not_started` — then either
     Deny, or, to retry via the Confirm link, also set
     `court16_booking_status` back to `pending_staff` (Confirm only accepts
     `pending_staff` Deals or its own `[confirm_retry]` reconciliation
     states; a hand-reset `manual_review`/`failed` Deal without that status
     change is deniable but not confirmable). Only do this after the Mindbody
     check above; these fields are what stops a double-charge.
  4. If a duplicate or partial family record was created
     (`court16_family_provisioning_status` is a `*_started` or
     `reconciliation_required` value): resolve the client records in Mindbody
     first, record the surviving original Client IDs on the Deal
     (`court16_mindbody_parent_id` / `court16_mindbody_child_id`,
     provisioning status `child_created`), then Deny or Confirm.

Never clear `court16_active_parent_key` by hand as a shortcut: it is the only
guard that stops the same parent from opening a second concurrent request
while the first is unresolved.
