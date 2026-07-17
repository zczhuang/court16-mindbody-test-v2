# HubSpot Contact Properties — Court 16 Track 1

The Track 1 app submits to the existing Court 16 trial form
(`3e966ac4-872e-49ec-9b93-1f114fa6d39b`, portal `4832170`) via the Forms
API v3 Integration endpoint. The form already writes most of what we need
to the Contact. This doc lists **additional** Contact custom properties we
need Ibtissam to create so the app can carry its state machine + signed
staff URLs on each Contact.

The Forms API accepts any field name that maps to a valid Contact property
— even fields that don't appear on the form's UI. That means we don't have
to edit the form itself, only add contact properties.

---

## Form fields (already exist — no action needed)

The form writes these to the Contact as part of each submission. Listed
here for reference so you know what ships "for free":

| Internal name | Type | Notes |
|---|---|---|
| `firstname`, `lastname`, `email`, `phone` | Standard | |
| `preferred_location` | Dropdown | Existing portal property; verify its options against the seven known club records before rollout |
| `child_name` | Single-line | Child 1 first name |
| `child_1___last_name` | Single-line | Child 1 last name |
| `childage` | Dropdown | `"2.5 - 3 yo"` … `"15 and older"` |
| `child_date_of_birth` | Date | Submitted as one ISO date field (`YYYY-MM-DD`) |
| `child_1___playing_level` | Dropdown | `"New to Tennis"`, `"Played a bit here and there"`, `"Has taken formal lessons"` |
| `school` | Single-line | |
| `lead_source` | Dropdown | "Word of Mouth" / "Flyer" / "Friend with a Court 16 member" / "Google" / "Facebook" / "Instagram" / "Other" / "Events" |
| `referrer` | Single-line | Optional — friend's email |
| `any_question_just_let_us_know` | Multi-line | Optional free text |
| `child_2___*` | Various | Legacy form fields; the current public Track 1 API accepts exactly one child |

If Ibtissam edits any of the dropdown options on the form, update
`lib/trial-reporting.ts` to match (the app validates submissions against
these exact vocabularies).

---

## New Contact custom properties — Ibtissam action

Create each of these in HubSpot → Settings → Properties → Contact
properties. All are single-line text unless noted.

| Internal name | Label | Type | Options | Notes |
|---|---|---|---|---|
| `court16_correlation_id` | Court 16 correlation ID | Single-line text | — | Must have unique values: **yes**. Primary lookup key for staff confirm/reassign. |
| `court16_intent` | Court 16 intent | Dropdown | `kid_trial`, `adult_intro` | |
| `court16_booking_status` | Court 16 booking status | Dropdown | `pending_staff`, `pending_staff_assist`, `pending_payment`, `confirmed`, `failed`, `duplicate_email_softwall`, `manual_review` | **Workflow triggers on changes here.** |
| `court16_class_id` | Court 16 class ID | Single-line text | — | MindBody class ID as string |
| `court16_class_name` | Court 16 class name | Single-line text | — | Mindbody-owned class description read back by the API |
| `court16_class_day_time` | Court 16 class day/time | Single-line text | — | Human-readable site-local display value |
| `court16_coach_name` | Court 16 coach name | Single-line text | — | Mindbody-owned staff display name |
| `court16_location_slug` | Court 16 location slug | Single-line text | — | App's internal slug; redundant with `preferred_location` but used by staff routes for lookups |
| `court16_location_full` | Court 16 location | Single-line text | — | Human-readable club name |
| `court16_waiver_version` | Court 16 waiver version | Single-line text | — | e.g. `v1.0` |
| `court16_mindbody_parent_id` | Court 16 MindBody parent ID | Single-line text | — | |
| `court16_mindbody_child_id` | Court 16 MindBody child ID | Single-line text | — | |
| `court16_staff_confirm_url` | Court 16 staff confirm URL | Single-line text | — | Signed; 72h default, configurable with `STAFF_TOKEN_TTL_HOURS`. Used by workflow 1. |
| `court16_staff_reassign_url` | Court 16 staff reassign URL | Single-line text | — | Signed; same configurable TTL |
| `court16_staff_deny_url` | Court 16 staff deny URL | Single-line text | — | Signed; same configurable TTL |
| `court16_failure_reason` | Court 16 failure reason | Multi-line text | — | Populated when status = `failed` or `manual_review` |

That's 16 kids-trial Contact properties written by the current implementation.
The adult-intro path additionally uses `court16_offer_key`; keep that property
when auditing the complete shared Contact schema.

### Proposed family-status property — do not automate from inference

Workflow `1820551993` also needs one trustworthy property before activation:

| Internal name | Label | Type | Options | Safety rule |
|---|---|---|---|---|
| `court16_family_account_status` | Court 16 family account status | Dropdown | `parent_claim_pending`, `parent_claimed`, `child_link_pending`, `family_complete`, `manual_review` | Opens, clicks, and email delivery must never advance this field. Update only from a verified Mindbody readback or an explicit staff completion action tied to the original child Client ID. |

The property contract is documented, but the current application does not yet
have a reliable Mindbody claim/family-state readback. Keep the nudge workflow off.

### Private App scopes

The `HUBSPOT_ACCESS_TOKEN` Private App must have:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.objects.deals.read`
- `crm.objects.deals.write`
- `crm.schemas.contacts.read` (to verify properties exist)

No custom-object scopes needed — we dropped that architecture.

---

## Sanity check

After creating the properties + setting `HUBSPOT_ACCESS_TOKEN` in env, verify:

```bash
curl -sS "https://api.hubapi.com/crm/v3/properties/contacts?archived=false" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  | jq '.results | map(.name) | map(select(startswith("court16_")))'
```

Compare the output with the 16 kids-trial fields above. The adult-intro path
also needs `court16_offer_key`; the proposed family-status property is separate
until its source of truth is implemented.

Do not submit a trial merely to check this schema. A controlled integration
test requires an approved tagged Ridge Hill family, a verified Mindbody target
and eligible class occurrence, a pre-write log of the original Client IDs, and
a named cleanup owner. After that approved test, look up the Contact in HubSpot
and verify the app-written fields alongside the form-written ones.

---

## Known limitations (Track 1)

- **One booking state per Contact at a time.** Each submission overwrites the
  previous correlation ID + status on the Contact. For an existing Mindbody
  email, the app creates no new Mindbody client: it preserves the original
  records, writes or updates the HubSpot Contact + Deal with
  `duplicate_email_softwall`, and routes staff to locate and connect the
  original child Client ID. Automatic existing-child resolution is not built.
  A later multi-booking design should use an associations-based object rather
  than treating the Contact as the booking ledger.
- **Form option drift.** If someone edits the form dropdown values, the
  app's submissions will fail validation on the HubSpot side. Keep
  `lib/trial-reporting.ts` constants in lock-step.
