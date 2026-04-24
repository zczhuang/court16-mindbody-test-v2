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
| `preferred_location` | Dropdown | 6 Court 16 locations |
| `child_name` | Single-line | Child 1 first name |
| `child_1___last_name` | Single-line | Child 1 last name |
| `childage` | Dropdown | `"2.5 - 3 yo"` … `"15 and older"` |
| `child_date_of_birth` | Date | Submitted as 3 fragments: `child_date_of_birth__YYYY/__MM/__DD` |
| `child_1___playing_level` | Dropdown | `"New to Tennis"`, `"Played a bit here and there"`, `"Has taken formal lessons"` |
| `school` | Single-line | |
| `lead_source` | Dropdown | "Word of Mouth" / "Flyer" / "Friend with a Court 16 member" / "Google" / "Facebook" / "Instagram" / "Other" / "Events" |
| `referrer` | Single-line | Optional — friend's email |
| `any_question_just_let_us_know` | Multi-line | Optional free text |
| `child_2___*` | Various | Optional second child block — handled but not prompted by Track 1 UI |

If Ibtissam edits any of the dropdown options on the form, update
`lib/config.ts` to match (the app validates submissions against these
vocabularies).

---

## New Contact custom properties — Ibtissam action

Create each of these in HubSpot → Settings → Properties → Contact
properties. All are single-line text unless noted.

| Internal name | Label | Type | Options | Notes |
|---|---|---|---|---|
| `court16_correlation_id` | Court 16 correlation ID | Single-line text | — | Must have unique values: **yes**. Primary lookup key for staff confirm/reassign. |
| `court16_intent` | Court 16 intent | Dropdown | `kid_trial`, `adult_intro` | |
| `court16_booking_status` | Court 16 booking status | Dropdown | `pending_staff`, `pending_payment`, `confirmed`, `failed`, `duplicate_email_softwall`, `manual_review` | **Workflow triggers on changes here.** |
| `court16_class_id` | Court 16 class ID | Single-line text | — | MindBody class ID as string |
| `court16_location_slug` | Court 16 location slug | Single-line text | — | App's internal slug; redundant with `preferred_location` but used by staff routes for lookups |
| `court16_waiver_version` | Court 16 waiver version | Single-line text | — | e.g. `v1.0` |
| `court16_mindbody_parent_id` | Court 16 MindBody parent ID | Single-line text | — | |
| `court16_mindbody_child_id` | Court 16 MindBody child ID | Single-line text | — | |
| `court16_staff_confirm_url` | Court 16 staff confirm URL | Single-line text | — | Signed, 24h expiry. Used by workflow 1 (staff notification). |
| `court16_staff_reassign_url` | Court 16 staff reassign URL | Single-line text | — | Signed, 24h expiry |
| `court16_admin_retry_url` | Court 16 admin retry URL | Single-line text | — | Signed, 24h expiry |
| `court16_failure_reason` | Court 16 failure reason | Multi-line text | — | Populated when status = `failed` or `manual_review` |

That's 12 new Contact properties. Creating them takes ~15 minutes.

### Private App scopes

The `HUBSPOT_ACCESS_TOKEN` Private App must have:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
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

Should print all 12 `court16_*` property names.

Submit a test trial from the app (with `HUBSPOT_ACCESS_TOKEN` set), then
look up the Contact in HubSpot — you should see all the app-written
properties populated alongside the form-written ones.

---

## Known limitations (Track 1)

- **One booking per Contact at a time.** Each submission overwrites the
  previous correlation ID + status on the Contact. Returning users are
  softwalled in Track 1 before they ever reach the submission, so this is
  effectively "new customer, one kid, one trial" scope. Track 2's
  magic-link flow + multi-child support will either move to custom objects
  or use an associations-based approach.
- **Form option drift.** If someone edits the form dropdown values, the
  app's submissions will fail validation on the HubSpot side. Keep
  `lib/config.ts` constants in lock-step.
