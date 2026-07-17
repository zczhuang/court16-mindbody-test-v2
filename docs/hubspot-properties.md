# HubSpot Contact Properties — Court 16 Track 1

The Track 1 app now upserts the Contact directly and creates its own correlated
Deal. Legacy form `3e966ac4-872e-49ec-9b93-1f114fa6d39b` remains in portal
`4832170`, but new-path submission is disabled by default because its event
fires the obsolete account-creation guide and duplicate Deal workflows. This
doc lists the Contact fields used by the direct CRM path.

The optional legacy compatibility switch is
`HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM=true`; do not set it for the new booking flow.

---

## Shared Contact fields (already exist — no action needed)

The app writes these through its direct Contact upsert. They are also fields on
the legacy form, but that form event is skipped by default:

| Internal name | Type | Notes |
|---|---|---|
| `firstname`, `lastname`, `email`, `phone` | Standard | |
| `preferred_location` | Dropdown | Live options verified July 17 for seven clubs, including `Allston - Massachusetts`; pipeline readiness is separate |
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

If Ibtissam edits any matching HubSpot dropdown options, update
`lib/trial-reporting.ts` to match (the app validates writes against these exact
vocabularies). Form-specific validation matters only when legacy compatibility
is explicitly enabled.

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

### Live family-status property — do not automate completion from inference

Trusted-status workflow `1853127851` uses this property; the superseded
Deal-based shell `1820551993` remains off:

| Internal name | Label | Type | Options | Safety rule |
|---|---|---|---|---|
| `court16_family_account_status` | Court 16 family account status | Dropdown | `parent_claim_pending`, `parent_claimed`, `child_link_pending`, `family_complete`, `manual_review` | Opens, clicks, and email delivery must never advance this field. Update only from a verified Mindbody readback or an explicit staff completion action tied to the original child Client ID. |

The dropdown was created in live portal `4832170` on 2026-07-17. The application
may write `parent_claim_pending` only after it has verified successful new parent
and child creation with the inline Parent/Guardian relationship. It still does
not have a reliable Mindbody claim/family-link completion readback, so it must
not infer later states. Keep the nudge workflow off.

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
also needs `court16_offer_key`; the family-status property is separate. Its
initial `parent_claim_pending` write is implemented, but a trustworthy source
for later claim/link states is not.

Do not submit a trial merely to check this schema. A controlled integration
test requires an approved tagged Ridge Hill family, a verified Mindbody target
and eligible class occurrence, a pre-write log of the original Client IDs, and
a named cleanup owner. After that approved test, look up the Contact in HubSpot
and verify the app-written fields on the Contact and correlated Deal.

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
- **HubSpot option drift.** If someone edits the matching dropdown values, CRM
  writes or an explicitly re-enabled form submission can fail validation. Keep
  `lib/trial-reporting.ts` constants in lock-step.
