# HubSpot Schema Setup — `court16_booking`

This document is the canonical definition of the `court16_booking` custom
object. It's the state machine for every booking request. Every workflow
and every API call reads from or writes to this object.

Set up in the **sandbox** portal first, verify, then mirror to **production**
byte-for-byte. Any schema drift between sandbox and production will cause
silent workflow failures.

---

## Create the custom object

1. HubSpot → Settings → Data Management → Custom Objects → Create custom object
2. Name: `Court 16 Booking` (singular), `Court 16 Bookings` (plural)
3. Primary display property: `correlation_id`
4. Secondary display property: `status`

After creation, HubSpot assigns a **custom object type ID** in the form
`2-12345678`. Copy it and paste into the environment variable:

```
HUBSPOT_CUSTOM_OBJECT_TYPE_ID=2-12345678
```

Repeat for production portal and set the prod env var accordingly.

---

## Properties

All properties live under the `court16_booking` object. Copy the internal
names exactly — the app writes by internal name, not display label.

| Internal name | Label | Type | Required | Field options | Notes |
|---|---|---|---|---|---|
| `correlation_id` | Correlation ID | Single-line text | Yes | Must have unique value: **yes** | Primary lookup key |
| `intent` | Intent | Dropdown | Yes | Options: `kid_trial`, `adult_intro` | |
| `status` | Status | Dropdown | Yes | Options: `pending_staff`, `pending_payment`, `confirmed`, `failed`, `duplicate_email_softwall`, `manual_review` | Workflow triggers on changes here |
| `location_id` | Location | Single-line text | Yes | | Location slug (e.g. `nyc-brooklyn`) |
| `class_id` | MindBody Class ID | Single-line text | No | | Stored as string for consistency |
| `offer_key` | Offer key | Single-line text | No | | Adult flow only |
| `mindbody_parent_id` | MindBody Parent ID | Single-line text | No | | |
| `mindbody_child_id` | MindBody Child ID | Single-line text | No | | |
| `mindbody_adult_id` | MindBody Adult ID | Single-line text | No | | |
| `waiver_version` | Waiver version | Single-line text | Yes | | e.g. `v1.0` |
| `staff_confirm_url` | Staff confirm URL | Single-line text | No | | Signed, 24h expiry |
| `staff_reassign_url` | Staff reassign URL | Single-line text | No | | Signed, 24h expiry |
| `admin_retry_url` | Admin retry URL | Single-line text | No | | Signed, 24h expiry |
| `payload_json` | Payload JSON | Multi-line text | No | | Full request body for replay |
| `failure_reason` | Failure reason | Multi-line text | No | | |
| `last_mindbody_response` | Last MindBody response | Multi-line text | No | | Truncated to 4000 chars |

### Contact custom properties

These go on the standard `contacts` object (NOT on the custom object).

| Internal name | Label | Type | Notes |
|---|---|---|---|
| `court16_intent` | Court 16 intent | Single-line text | Mirrors `intent` above |
| `court16_child_name` | Court 16 child name | Single-line text | Kids only |
| `court16_child_age` | Court 16 child age | Single-line text | Kids only |
| `court16_location` | Court 16 location | Single-line text | |
| `court16_correlation_id` | Court 16 correlation ID | Single-line text | Latest booking's ID |
| `court16_waiver_version` | Court 16 waiver version | Single-line text | |

---

## Associations

Create a single association type between `court16_booking` and `contacts`.

1. Data Management → Associations → New association
2. Object A: `Court 16 Booking` → Object B: `Contact`
3. Label: `Booking for contact`

The association type ID HubSpot generates will be shown in the API; the
app uses the default `associationTypeId: 0` which maps to the primary
association for custom objects.

---

## Private App scopes

The Private App token in `HUBSPOT_ACCESS_TOKEN` must have:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.schemas.contacts.read`
- `crm.schemas.contacts.write` (to add the `court16_*` contact properties programmatically if needed)
- `crm.objects.custom.read`
- `crm.objects.custom.write`
- `crm.schemas.custom.read`
- `automation` (for Workflow triggers — verify in Ibtissam's tier)

Create the Private App: HubSpot → Settings → Integrations → Private Apps → Create → name it `Cedarwind Booking App`.

---

## Sanity check

Once the schema is live and `HUBSPOT_ACCESS_TOKEN` + `HUBSPOT_CUSTOM_OBJECT_TYPE_ID` are set:

```bash
curl -sS https://api.hubapi.com/crm/v3/schemas/$HUBSPOT_CUSTOM_OBJECT_TYPE_ID \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" | jq '.properties | map(.name)'
```

The output must include every `court16_booking` internal name above. If
any is missing, re-add in the UI before wiring workflows.
