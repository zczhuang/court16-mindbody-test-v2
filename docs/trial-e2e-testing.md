# Protected trial automation E2E lane

`/e2e/trial` is a non-production rehearsal for the kids-trial UI and automation
contracts. It uses the real two-panel `TrialRequestForm`, then exposes a signed
test-staff action directly in the browser so no Court 16 staff email is needed.
It is not a silent proof that the complete production intake, HubSpot workflows,
or staff-confirm route executed.

## Safety boundary

- The page and every `/api/e2e/*` route return `404` when `VERCEL_ENV=production`.
- Vercel-hosted runs require `VERCEL_ENV=preview`.
- The E2E deployment refuses to start when `HUBSPOT_ACCESS_TOKEN` is present.
- Site `-99` mode accepts only the official
  `https://api.mindbodyonline.com/public/v6` API base URL.
- Site `-99` mode rejects an E2E Redis URL or token that matches the configured
  production `UPSTASH_REDIS_REST_*` store.
- Hosted runs require exactly `VERCEL=1` and `VERCEL_ENV=preview`. Local runs
  require `NODE_ENV=development`, `TRIAL_E2E_LOCAL_ENABLED=true`, and a loopback
  host. An unknown production host cannot enable the lane with environment vars.
- Access requires an HTTP-only, signed, eight-hour session cookie.
- Sessions and receipts are bound to the configured audience and backend;
  rotating the access key revokes existing sessions. Receipts use a separate
  HMAC secret, expire after 24 hours, and contain no family names, email, phone,
  address, or date of birth.
- The public `/api/book/trial` and `/api/staff/confirm` routes have no E2E switch.

## Backends

### `fixture`

The default backend is deterministic and has no vendor network adapter. It
rehearses the browser form and isolated API contract, runs the production
Deal-ledger serializer/parser/state validator, and simulates the shapes of the
Contact, family, checkout, enrollment, and visit stages. Its direct test-staff
action exercises signed receipt transitions and deterministic retry behavior.
Every simulated vendor stage is labeled as such. The production intake and
staff-confirm routes, HubSpot, Mindbody permissions, and vendor readbacks do not
run in this mode.

### `mindbody_sandbox`

This optional backend performs real writes only against Mindbody Site `-99`:

- Site `-99` (`LastSpot`, `America/Chicago`)
- Program `26`, runtime Schedule `2180`
- Location `1`
- `$0` Service `1377`
- Parent/Guardian relationship `-6`

The occurrence `ClassId` is always discovered and verified at runtime. Parent
and child share a unique, non-deliverable `@court16-test.invalid` address. New
AddClient requests set all six client communication flags to `false`; an
explicit AddClientToClass fallback sends `SendEmail:false`. Checkout can return
an already-created Visit without exposing that per-enrollment flag, so the
receipt reports request-side controls rather than claiming mailbox delivery.
Before every vendor mutation, a signed Redis write-ahead journal durably records
the started phase. A compare-and-set transition advances only after exact client,
service, or Visit readback. Any ambiguous `*_started` retry is read-only and
returns a reconciliation-required response instead of repeating the mutation.
A successful recovery of an upstream started phase also ends that request; one
fresh click is required before any downstream vendor mutation can begin.
A separately configured E2E Redis lock serializes normal requests, while the
journal protects the run even if that lock expires; the same store also retains
the latest signed receipt.

Site `-99` is shared and disposable, but its records can remain visible until
Mindbody resets it. It must not be treated as an instant rollback.

## Required Preview variables

```text
TRIAL_E2E_ENABLED=true
TRIAL_E2E_BACKEND=fixture                 # or mindbody_sandbox
TRIAL_E2E_AUDIENCE=court16-trial-e2e-preview
TRIAL_E2E_ACCESS_TOKEN=<32+ chars>
TRIAL_E2E_SIGNING_SECRET=<32+ chars>
HUBSPOT_ACCESS_TOKEN=                     # must be absent
```

For `mindbody_sandbox`, also configure the normal Mindbody API/source
credentials, set `MINDBODY_SITE_ID=-99`, keep `MINDBODY_REAL_WRITES_ENABLED`
false or absent, leave `MINDBODY_BASE_URL` unset or set it exactly to the
official URL below, and set:

```text
TRIAL_E2E_MINDBODY_WRITES_ENABLED=true
MINDBODY_BASE_URL=https://api.mindbodyonline.com/public/v6
E2E_UPSTASH_REDIS_REST_URL=<dedicated E2E database>
E2E_UPSTASH_REDIS_REST_TOKEN=<dedicated E2E token>
```

The E2E Redis URL and token must differ from `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`; the policy rejects the sandbox backend otherwise.

## Rehearsal result

The page automatically submits staff confirmation twice. The first request
must produce a confirmed receipt. The second must return cached, read-only
evidence with the same sale and visit IDs. The downloaded JSON bundle contains
both the receipt and its HMAC token; retain its run ID with the release evidence.

Notification evidence is request-side, not mailbox telemetry. The receipt can
show that the isolated route has no Court 16 HubSpot/staff/admin adapter and can
record the Mindbody controls each request actually supplied. It records
external delivery as `not_observed`; it does not fabricate a mailbox count.

Neither backend proves Court 16 production workflow routing. That final boundary
requires a separately approved production fixture with controlled recipients
and an explicit cleanup owner.
