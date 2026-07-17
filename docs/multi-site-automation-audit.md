# Court 16 kids-trial automation: multi-site readiness and handoff

**Audit date:** 2026-07-17

**Scope:** Allston, Downtown Brooklyn, Fishtown, Long Island City, Manhattan–FiDi, Newton, and Ridge Hill.
**Decision rule:** do not enable a club because its Site ID is known. Enable it only after Mindbody authorization, the club's own trial configuration, HubSpot routing, and the full parent/child test all pass.

The copy/paste owner and admin steps are in [the access-authorization handoff](./access-authorization-handoff.md).

## Executive status

Ridge Hill is the only authorized control site. Its Mindbody source-token probe returned `200`, and its known trial configuration is Program `61` plus $0 Service `100328`. The same source-token probe returned `403` (no site access) for the other six clubs. Consumer/API-key read probes on those six clubs also returned `403`, so consumer mode is **not** a safe fallback.

This proves authorization and configuration visibility only; it does not prove a club is ready for families. The reusable 30-day audit on July 17 found Program `61`, Service `100328`, required fields, and family relationships at Ridge Hill, but returned **zero upcoming Program 61 occurrences**. Ridge Hill therefore needs a schedule check before accepting a real request. The parent-claim status gate in HubSpot is also still missing.

Labels used below:

- **Verified** — observed in the live API, live HubSpot change record, or current application configuration.
- **Recorded** — present in source control, but the external HubSpot asset was not re-opened in this audit.
- **Unknown** — must be obtained from the club or read from Mindbody after access is granted. No ID should be guessed or copied from Ridge Hill.

## Seven-club readiness matrix

The live API evidence used source `CedarWindSolutionsLLC`. For the six blocked sites, both the source-token request and the consumer read probes failed with `403`.

| Club | Mindbody Site ID | Live API authorization | Kids-trial Program / $0 Service | HubSpot Deal routing in code | Readiness |
|---|---:|---|---|---|---|
| **Allston** | `5754600` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Unknown and not configured:** no verified pipeline, stages, or `preferred_location` enum value | **Blocked** |
| **Downtown Brooklyn** | `135479` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `default`; `appointmentscheduled` → `qualifiedtobuy` | **Blocked** |
| **Fishtown** | `5742169` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `1818411`; `6445996` → `1031324174` | **Blocked** |
| **Long Island City** | `985499` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `1460258`; `5321400` → `11096161` | **Blocked** |
| **Manhattan–FiDi** | `5728093` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `2477627`; `8517561` → `8517634` | **Blocked** |
| **Newton** | `5751422` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `873061120`; `1307706690` → `1307706693` | **Blocked** |
| **Ridge Hill** | `5748154` | **Verified:** source token and all five read probes `200`; zero Program 61 occurrences in the next 30 days | **Verified live:** Program `61`; Service `100328`; required fields and family relationships visible | **Recorded:** pipeline `830977386`; `1231873814` → `1231873816` | **Authorized control; schedule required before live requests** |

Known Site IDs and existing six-site pipeline mappings are configuration facts. Program IDs, Service IDs, required fields, relationship IDs, email settings, and class inventory are **site-specific** and remain unknown wherever the table says unknown.

The July 17 Ridge Hill readback returned required fields `AddressLine1`, `City`, `State`, `PostalCode`, `MobilePhone`, `BirthDate`, `Email`, and `IsMale`; family candidates `-6` (`Parent/Guardian` ↔ `Child`) and `-4` (`Is Paid For By` ↔ `Pays For`); and two service-name candidates: `100183` (`Complimentary Child Intro Session`) and the configured `100328` (`Kid's Trial`). This is evidence for Ridge Hill only, not a template of IDs for another site.

## Mindbody enablement checklist — repeat for every club

### 1. Grant API access and prove it

The existing Public API v6 key is application-level; the six clubs do not need six new keys. Cedarwind must generate one activation link/code per Site ID, and the owner/admin for that club must approve source `CedarWindSolutionsLLC`. After activation, issue a fresh staff token for the exact Site ID and verify any staff permissions required by the chosen flow, including **Make Unpaid Reservation** when applicable.

Do not continue until these tests pass for that Site ID:

1. `POST /usertoken/issue` for the source-staff identity returns `200`.
2. Read `GET /client/requiredclientfields`; save the actual required-field list.
3. Read `GET /site/relationships`; save the site's exact Parent/Guardian and, if used, Pays For descriptors and IDs.
4. Read `GET /site/genders`; save the active values configured by that club. Configure the form from that per-site list, then include every offered value in the controlled launch-write matrix; the read-only audit does not prove `AddClient` acceptance by itself.
5. Read `GET /class/classes` for the launch window; confirm the source can see the intended trial occurrences.
6. Read `GET /sale/services`; identify the intended $0 kids-trial Service.

A consumer-mode `403` does not justify bypassing source authorization. Do not attempt live writes while any preflight read is blocked.

### 2. Build or verify the club's trial inventory

In that club's Mindbody site, staff must:

1. Create or identify the dedicated **Kid's Trials** Program.
2. Create the approved age-band Class Descriptions under that Program.
3. Schedule only the trial-eligible occurrences that parents may select.
4. Create or identify a `$0` Service/pricing option tied to that Program.
5. Confirm `Comp` checkout is allowed for the staff/source identity; the confirm route uses `/sale/checkoutshoppingcart` before enrollment.
6. Confirm the Service is valid for every trial Class Description and location used by the public calendar.
7. Give Cedarwind the **observed** Program ID, Service ID, intended class schedule/occurrence IDs, and location ID. Never reuse `61`, `100328`, or Ridge Hill relationship IDs by analogy.

### 3. Lock the account and family behavior

For a clean new-family test:

1. The API creates the parent first with the parent's email and `SendAccountEmails=true`.
2. The API creates one child record using the same reachable parent email and stores the site's verified Parent/Guardian relationship inline.
3. Exactly one valid native Mindbody Welcome/account-claim email reaches the parent. Do **not** separately invoke `ConsumerWelcomeEmail`; the live Ridge Hill test produced a duplicate message with a broken/empty key.
4. The parent claims the account, signs in, and adds the child under **Account Info → Family → Add Member** using the existing child's exact identity.
5. Staff uses **Connect Mindbody Account** on the original child record. Mindbody sends its own secure link email; HubSpot never copies the token.
6. Completion means the **original child Client ID** shows **Manage Family Account**, the parent is account owner, and the child appears under Family Members. A shared email or a relationship row alone is not completion.

If a duplicate is created, stop. Do not merge, deactivate, reassign, or delete production records through an untested automation. Mindbody test writes are real and there is no supported API delete in this implementation; use tagged fixtures and an agreed staff cleanup procedure.

### 4. Record only verified per-site values

After the preceding checks pass, add that club's:

- `kidTrialProgramId`;
- `trialServiceId`;
- any deliberately enforced trial class/schedule allowlist;
- verified relationship descriptor/ID mapping;
- exact required-client-field behavior;
- Mindbody login URL and location details; and
- HubSpot pipeline, Requested/Scheduled stage IDs, and exact `preferred_location` enum value.

Keep the club disabled until the acceptance suite below passes.

## HubSpot workflow inventory

The HubSpot connection in this audit could read CRM contacts/deals, but it did not expose Marketing Email or workflow access and needs reauthorization before a definitive live inventory or any live change. The table therefore distinguishes the one verified safe state from source-controlled records.

Reauthorization requires the app to request `crm.objects.contacts.read/write`, `crm.objects.deals.read/write`, `marketing-email`, and `automation`, followed by **Settings → Integrations → Connected Apps → [connector] → Re-authenticate** in HubSpot. The OAuth return must finish; changing scopes alone does not update existing tokens. See the [access handoff](./access-authorization-handoff.md) for the owner/admin split and verification steps.

| Communication / workflow | Asset IDs | Current evidence | Required change before multi-site use |
|---|---|---|---|
| Existing form-submission nurture | Existing Phase 1 workflow; ID not recorded here | **Recorded:** Forms API submission still enrolls it | Decide whether this is the sole “request received” message; remove overlapping acknowledgements |
| Staff new-request notification | No live workflow ID verified | **Specified, live state unknown:** trigger `court16_booking_status=pending_staff` and `court16_intent=kid_trial` | Route by `court16_location_slug` to one accountable club queue/owner and set an SLA |
| Parent trial confirmation | Workflow `1820575928`; email `212773423758` | **Recorded:** Ridge Hill trigger/config; current on/off and action graph not reverified | Clone or branch by canonical club only after per-site merge data and sender are tested |
| Parent Mindbody account nudge | Workflow `1820551993`; email `212772629316` | **Verified safe state:** workflow **OFF**. Revised copy is an unpublished draft; the older published revision remains. Email was reported `isTransactional=false` | Add a real family-status gate; review subscription classification; publish approved draft; test suppression before enabling |
| 24-hour reminder | Workflow `1820562947`; email `212773969554` | **Recorded:** Ridge Hill-only shell; live state/wiring not reverified | Use `Deal.class_date - 24h`, re-check Scheduled status immediately before send, and prevent a duplicate Mindbody reminder |
| Trial denied | Workflow `1820568681`; emails `213263710007`, `213269367704`, `213269367707`, `213263710012`, `213263710015` | **Recorded:** five-reason fan-out; live branch and publication state not reverified. Legacy `212773969562` should remain unwired | Verify branch labels against the live picklist and route by club; test every reason plus default |
| Manual-review / failed alert | No live workflow ID verified | **Specified, live state unknown** | Consolidate into one internal workflow with club owner, failure reason, correlation ID, and retry link |

### Recommended single-owner communication design

| Event | One sender/owner | Suppress in the other system |
|---|---|---|
| Secure Welcome, password, OTP, account claim, and family-link token | **Mindbody** | HubSpot contains no password button, generic reset link, or copied token |
| Trial request received | **HubSpot** (the existing form nurture, if Ibtissam approves it) | Do not add a second booking-app acknowledgement |
| Staff request/action queue | **HubSpot** | Do not rely on a consumer email as the staff task |
| Trial confirmed and what-to-bring details | **HubSpot** | Configure the booking action/site notifications so Mindbody does not send a duplicate class confirmation, unless Ibtissam explicitly chooses Mindbody instead |
| Schedule changed or cancelled in Mindbody | **Mindbody** as scheduling system of record | HubSpot should not infer a change it cannot verify; a later sync can update CRM state |
| 24-hour trial reminder | **HubSpot** | Disable any overlapping Mindbody automated reminder for the same trial |
| Trial declined | **HubSpot** | Mindbody sends no denial campaign |
| “Please finish your family account” nudge | **HubSpot**, but only from a verified pending state | Mindbody remains the only source of the secure action link |

The application owns orchestration and IDs, not customer email. HubSpot owns Court 16 messaging and staff work. Mindbody owns credentials and the scheduling state it alone can guarantee.

## Current blockers and unsafe fallbacks

1. **Six sites are unauthorized.** Source and consumer read paths both return `403`; retrying consumer mode cannot make them launch-ready.
2. **Unknown per-site IDs.** Program, Service, relationship, required-field, and class inventory values are unknown outside Ridge Hill. Hard-coding Ridge Hill IDs across sites would corrupt relationships or fail checkout/enrollment.
3. **Unsafe calendar fallback was present and is now blocked in this branch.** Previously, a site without `kidTrialProgramId` fell back to a broad “children” filter that could expose regular classes. The current branch adds an explicit `trialBookingEnabled` gate and requires both Program and Service IDs before either calendar retrieval or client creation. Keep every non-verified club disabled.
4. **Per-site intake can still differ.** The kids-trial route now collects a real household address and separate parent/child Mindbody gender values instead of writing the studio address or a hard-coded value. Ridge Hill's current readback does not require an emergency contact, so the route sends none. Re-probe required fields and the active gender catalog before enabling another club; never add placeholders to satisfy a different site's configuration.
5. **Unverified relationship mapping.** `-6` Parent/Guardian and `-4` Pays For were observed at Ridge Hill only. They are not global constants for rollout purposes.
6. **Paid-program dependency.** A child needs the correct $0 Service before `AddClientToClass`; missing/wrong Service IDs can cause `ClassRequiresPayment` or attach the wrong pricing.
7. **Allston CRM routing is absent.** No verified pipeline/stages or exact `preferred_location` option exists in current configuration. Do not fall back to Brooklyn/default.
8. **Family completion is not automated end to end.** Shared email + Parent/Guardian relationship do not create the consumer family view. The parent claim/Add Member and staff Connect steps still require stateful follow-up.
9. **HubSpot has no trustworthy claim-status gate.** Opens/clicks do not prove claim, OTP, Add Member, or child link completion. Keep workflow `1820551993` off until a verified state feeds the branch.
10. **HubSpot live automation access is incomplete.** Reauthorize the connector before treating source-controlled workflow notes as live truth or applying changes.
11. **Production test records are durable.** There is no safe API-delete path; every write test needs unique tags, named owners, and a cleanup list approved by staff.
12. **Irreversible actions need a distributed lock.** This branch prevents email scanners from mutating on GET and rejects duplicate staff POSTs within one running server instance. A durable cross-instance idempotency key/lock is still required before horizontally scaled production traffic.

## Safety changes implemented in this branch

- Added all seven Site IDs to the shared location registry, with only Ridge Hill marked `trialBookingEnabled`.
- Replaced the kids-trial studio-address and hard-coded-gender placeholders with explicit household address plus parent/child Mindbody gender intake; these private fields are written only to Mindbody, not HubSpot.
- Replaced the fabricated HubSpot defaults (`New to Tennis` and `Other`) with required customer selections for playing level and lead source. Optional school remains explicit as `Not provided` when blank.
- Added per-site Mindbody gender options to the readiness contract. The public form and server use only the enabled club's configured list, and the live audit fails an enabled club if any configured value is absent from its active Mindbody catalog.
- Added server-side readiness checks to both the kids calendar and booking submission routes; a disabled or incompletely configured club returns `trial_location_not_ready` before any Mindbody or HubSpot write.
- Made the readiness gate require the club's exact verified Parent/Guardian relationship descriptor as well as Program, Service, HubSpot pipeline, and `preferred_location`; the audit fails if the configured relationship is not present in the live site catalog.
- Removed the effective unfiltered kids-calendar fallback for public trial requests by requiring a verified Program and $0 Service.
- Keyed ordinary Mindbody staff-token caching by Site ID, preventing a token from one club being reused against another.
- Made direct diagnostic client/class/write endpoints fail closed unless `TEST_API_TOKEN` is configured.
- Updated the six published club addresses from Court 16's current location pages; Allston remains disabled because its exact club address is not yet published.
- Re-read the selected class from Mindbody before any write, require the exact occurrence/program/start time and web-bookable capacity, and replace client-supplied class metadata with the live values.
- Create the per-request HubSpot Deal before Mindbody `AddClient`; if the durable work item cannot be created, no Mindbody profile or claim email is attempted.
- Block a second active request for the same Contact so Contact-level workflow fields cannot overwrite an in-flight booking. Deal-centric booking state remains the recommended long-term model.
- Made staff confirmation fail closed on intent, booking state, enabled club, exact site/service mapping, and the correct child/adult Client ID. Adult staff-assist and kids-trial confirmations now take separate guarded branches.
- Changed staff confirm/reassign links so GET only renders an explicit confirmation form; only POST mutates. Confirm, reassign, and deny share one same-instance correlation lock to absorb ordinary double clicks and cross-action races while the distributed-lock requirement remains open.
- Added best-effort IP/email signup throttling. A distributed edge/WAF limit is still required for production-scale abuse protection.
- Disabled adult payment offers until each displayed price is reconciled to the live Mindbody SKU; payment return now also requires signed state and an exact recent ClientService match.

## Phased rollout and acceptance tests

### Phase 0 — decisions and access

- Ibtissam approves the single-owner email map, family-account state model, and per-club staff owner.
- Mindbody grants the six missing site authorizations.
- HubSpot marketing/workflow access is reauthorized for audit; all changes remain draft/off.

**Exit:** every club has named owners and the five read-only Mindbody preflights return `200`.

### Phase 1 — configure one club at a time

- Build/verify Program, age bands, curated occurrences, $0 Service, Comp checkout, required fields, relationship catalog, and native email settings.
- Capture exact Mindbody and HubSpot IDs; add config behind a per-club disabled flag.

**Exit:** the public API returns only intended trial occurrences for that club, and no unknown/fallback ID is used.

### Phase 2 — draft HubSpot routing

- Create/verify the club's Deal pipeline and exact enum value.
- Route staff tasks to one club owner.
- Branch approved emails using canonical `court16_location_slug` values.
- Add family states at minimum: `parent_claim_pending`, `parent_claimed`, `child_link_pending`, `family_complete`, `manual_review`.
- Keep workflows off; test with HubSpot's workflow test function.

**Exit:** each test Deal lands in the correct club pipeline, only the intended owner is notified, and claimed/complete families are suppressed from the claim nudge.

### Phase 3 — end-to-end test for that club

Use a unique, staff-approved email fixture and preserve every ID/screenshot in the test log.

1. Calendar shows only approved kids-trial times and the correct club/timezone.
2. Signup creates exactly one parent and one child, both reachable at the parent email, with the club's verified relationship.
3. HubSpot stores the original parent/child Mindbody IDs and creates one Deal in the correct Requested stage.
4. The parent receives exactly one valid Mindbody Welcome email; no duplicate or broken claim email arrives.
5. Staff confirmation grants the correct $0 Service, enrolls the **original child Client ID** once, and moves the Deal to Scheduled. A repeated confirm is idempotent.
6. Parent claim → Add Member → staff Connect → secure Mindbody link completes with the original child showing **Manage Family Account**.
7. A Mindbody enrollment/attendance report attributes the trial to that original child record.
8. HubSpot sends each approved customer message once; the pending-state nudge is suppressed after claim; denial and manual-review paths notify the correct club owner.
9. Duplicate-email, full/cancelled class, authorization failure, and wrong-Service tests fail safely to `manual_review` without creating an extra child or writing to another Site ID.

**Exit:** Ibtissam and the club manager sign the test log; cleanup of every test record is assigned.

### Phase 4 — controlled production release

Use Ridge Hill as the control, then enable one newly authorized club for a small monitored cohort. Keep a per-club kill switch. Review the first five families for record count, email count, child Client ID, class enrollment, Deal pipeline, and family completion before enabling the next club.

**Exit:** five consecutive clean families at the pilot club, no duplicate profiles/emails, and no manual correction caused by configuration. Repeat per club.

## Decisions required from Ibtissam and staff

1. **Trial inventory:** exact age bands, approved weekly slots, capacity, and the Program/Service owner at each club.
2. **Email ownership:** approve the single-sender map above—especially HubSpot versus Mindbody for confirmation and 24-hour reminders.
3. **Family-state source:** decide who records each state, how it reaches HubSpot, and the SLA for staff to nudge/Connect the child.
4. **Completion definition:** approve “original child Client ID shows Manage Family Account and appears under the parent's Family” as the only completion signal.
5. **Required intake data:** collect real required fields in the form or approve a documented staff-completion process; do not silently expand placeholders.
6. **Allston CRM setup:** provide the exact HubSpot pipeline, Requested/Scheduled stage IDs, `preferred_location` enum value, public launch status, and owning inbox. Unknown values must remain disabled.
7. **Per-club routing:** name the single accountable staff recipient/queue and backup for each location.
8. **Test-data cleanup:** choose who may merge/deactivate duplicates in Mindbody and how test Client IDs are logged. No automated deletion is assumed.
9. **Rollout order:** select the first newly authorized pilot club after Ridge Hill and approve the five-family acceptance threshold.

Until those decisions and the per-site tests are complete, the safe production state is: **Ridge Hill control path only; six additional clubs disabled; HubSpot account-nudge workflow off.**
