# HubSpot booking ledger — Court 16 Track 1

The Track 1 app creates one HubSpot Deal for each booking request. That Deal is
the durable, request-scoped ledger. A Contact represents a person and may be
reused for multiple children, bookings, and Court 16 clubs, so Contact custom
request properties are unsafe as booking state. Ledger-v1 code updates only
the Contact's person-scoped name and phone profile; all request state stays on
the Deal.

The optional legacy form switch is
`HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM=true`. Keep it unset/false for the direct CRM
path; the legacy form event can trigger obsolete account-guide and duplicate
Deal workflows.

## Non-negotiable data rules

1. Read booking status, selected class, original child, and Mindbody evidence
   from the correlated Deal. Never reconstruct them from the current Contact.
2. Keep `court16_mindbody_site_id` beside every site-scoped Mindbody ID on the
   same Deal. An ID from one club must never be used against another club.
3. `court16_booking_key` is the unique Deal-only UUID for one logical
   submission, including browser/network retries. `court16_correlation_id`
   remains the human/legacy workflow reference and need not be unique.
   `court16_active_parent_key` is a second unique, privacy-safe key held only
   while that parent email has an unresolved request; terminal actions clear it.
4. A confirmed enrollment requires an exact active Mindbody Visit readback for
   the Deal's original child and class occurrence. An API write response alone
   is not confirmation.
5. Family-account completion is evidence-backed for the original child on the
   Deal. Email delivery, opens, clicks, and password creation are not proof that
   the parent-child link is complete.
6. Every intake or staff mutation must hold the distributed Redis action lock.
   Missing `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN`, Redis errors,
   and lock ambiguity stop the request before HubSpot or Mindbody writes.

## Deal schema sync

The canonical group name and property definitions live in
`lib/hubspot-deal-ledger.ts`. The migration utility imports those definitions;
do not maintain a second hand-written migration list.

```bash
# Offline plan: no token required, no network requests, no writes
node --no-warnings --experimental-strip-types scripts/sync-hubspot-deal-ledger-schema.ts

# Live GET-only comparison
HUBSPOT_ACCESS_TOKEN=... \
  node --no-warnings --experimental-strip-types \
  scripts/sync-hubspot-deal-ledger-schema.ts --verify

# Guarded additive apply, only after the verify output is reviewed and approved
HUBSPOT_ACCESS_TOKEN=... HUBSPOT_DEAL_SCHEMA_APPLY=true \
  node --no-warnings --experimental-strip-types \
  scripts/sync-hubspot-deal-ledger-schema.ts --apply
```

Safety behavior:

- With no flag, the script is an offline plan and cannot call HubSpot.
- `--verify` requires a token and makes only Deal schema `GET` requests. It
  exits nonzero for missing or incompatible definitions.
- `--apply` requires both the token and the exact environment approval
  `HUBSPOT_DEAL_SCHEMA_APPLY=true`.
- Apply reads and validates every existing expected property before its first
  write. It also reads HubSpot's current overall and Deal-specific custom
  property capacity and counts existing unique Deal identifiers against
  HubSpot's ten-per-object limit. It creates only the missing
  `court16_booking` group and missing Deal properties. It never updates, moves,
  archives, or deletes anything.
- Any incompatible existing property stops apply before the first write. A
  failed/ambiguous create also stops immediately; run `--verify` before a
  retry.
- HubSpot does not allow `hasUniqueValue` to be changed after property
  creation. The migration therefore creates separate unique
  `court16_booking_key` and `court16_active_parent_key` properties; it does not
  try to retrofit uniqueness onto the existing `court16_correlation_id`. If
  either pre-existing key property is not explicitly unique, the script stops
  instead of guessing or repairing it.

The verification token needs Deal schema read access; apply additionally needs
Deal schema write access. The application token separately needs Deal and
Contact object read/write access for runtime booking operations.

## Deal property group: `court16_booking`

The group contains the request-scoped properties below. The imported code
definitions, rather than this prose, determine the migration's exact count:

| Purpose | Internal properties | Rule |
|---|---|---|
| Contract and lifecycle | `court16_booking_ledger_version`, `court16_booking_key`, `court16_correlation_id`, `court16_active_parent_key`, `court16_intent`, `court16_booking_status`, `court16_failure_reason` | Booking key identifies one submission; active-parent key enforces one unresolved request per parent email and is cleared only at a terminal transition. |
| Club and product | `court16_location_slug`, `court16_mindbody_site_id`, `court16_mindbody_location_id`, `court16_mindbody_program_id`, `court16_mindbody_service_id`, `court16_mindbody_service_name` | These values define the only permitted Mindbody site, physical sale location, and product context for the request. |
| Class selection | `court16_class_id`, `court16_class_schedule_id`, `court16_class_name`, `court16_class_day_time`, `court16_coach_name` | Class ID is the occurrence used for enrollment; schedule ID is the recurring schedule selected at intake. |
| Family snapshot | `court16_parent_email`, `court16_child_first_name`, `court16_child_last_name`, `court16_child_birth_date`, `court16_child_playing_level`, `court16_child_school`, `court16_waiver_version` | Immutable request snapshot; do not fall back to later Contact edits. |
| Staff actions | `court16_staff_confirm_url`, `court16_staff_reassign_url`, `court16_staff_deny_url` | Signed request-scoped links; default expiry is controlled by `STAFF_TOKEN_TTL_HOURS`. |
| Mindbody clients and family | `court16_mindbody_parent_id`, `court16_mindbody_parent_unique_id`, `court16_mindbody_child_id`, `court16_mindbody_child_unique_id`, `court16_family_account_status`, `court16_family_provisioning_status`, `court16_family_provisioning_started_at` | Persist a write-ahead marker before each AddClient call, then persist each returned ID immediately. Consumer family-account completion still requires verified readback or explicit staff evidence. |
| Purchase and enrollment evidence | `court16_mindbody_client_service_id`, `court16_mindbody_sale_id`, `court16_mindbody_visit_id`, `court16_enrollment_verified_at`, `court16_enrollment_status`, `court16_mindbody_mutation_status`, `court16_mindbody_mutation_started_at` | Record write progress before a mutation and exact IDs after readback; reconciliation state blocks a blind retry. |

Enumeration values are generated from the typed sets in
`lib/hubspot-deal-ledger.ts`. If a value changes, update the application contract
first, review the operational transition, and then run `--verify`. The additive
script deliberately refuses to mutate an existing dropdown.

## Contact fields: person profile only

The app associates exactly one Contact to each Deal and refreshes only these
person-scoped fields after the Deal transition succeeds:

| Internal name | Type | Notes |
|---|---|---|
| `firstname`, `lastname`, `email`, `phone` | Standard | Parent identity/contact details |

The following Contact properties may still contain legacy values from earlier
tests or the Squarespace form, but ledger-v1 intake and staff routes do not
refresh them:

`court16_correlation_id`, `court16_intent`, `court16_booking_status`,
`court16_class_id`, `court16_class_name`, `court16_class_day_time`,
`court16_coach_name`, `court16_location_slug`, `court16_location_full`,
`court16_waiver_version`, `court16_mindbody_parent_id`,
`court16_mindbody_child_id`, `court16_staff_confirm_url`,
`court16_staff_reassign_url`, `court16_staff_deny_url`,
`court16_failure_reason`, and `court16_family_account_status`.

They are not safe booking lookup keys, workflow triggers, or child-reporting
fields. Staff routes and new workflows start from the Deal and use its
associated Contact only as the recipient/person record. The disabled legacy
form path is the only compatibility path that can still populate its own
Contact form fields.

## Workflow migration rule

- Trigger request-specific staff and enrollment automation from the Deal's
  `court16_booking_status`, never a Contact request-state property.
- Send parent email through the Contact associated with that Deal.
- Include the Deal ID/correlation in retry and staff-action paths.
- Write authoritative Deal evidence first; a later failure to refresh the
  Contact's name/phone does not downgrade or rewrite the booking Deal.
- Keep any legacy Contact-ledger fallback explicit, temporary, and off by
  default. Never mix a Contact's current child ID with an older Deal.

## Verification boundary

Schema verification proves only that the expected HubSpot Deal properties are
present and structurally compatible. It does not prove:

- Deal pipeline/stage mappings;
- HubSpot workflow or email enrollment behavior;
- Mindbody program, service, class, or family-link configuration;
- end-to-end parent/child creation, purchase, enrollment, or cleanup.

Do not submit a trial merely to check the schema. A controlled integration test
still requires an approved tagged family, an eligible class occurrence, a
pre-write log of original Mindbody Client IDs, and a named cleanup owner.
