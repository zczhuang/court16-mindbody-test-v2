# Court 16 kids-trial automation: multi-site readiness and handoff

**Audit date:** 2026-07-18

**Scope:** Allston, Downtown Brooklyn, Fishtown, Long Island City, Manhattan–FiDi, Newton, and Ridge Hill.
**Decision rule:** do not enable a club because its Site ID is known. Enable it only after Mindbody authorization, the club's own trial configuration, HubSpot routing, and the full parent/child test all pass.

The copy/paste owner and admin steps are in [the access-authorization handoff](./access-authorization-handoff.md).

## Executive status

Ridge Hill is the only authorized control site. Its Mindbody source-token probe returned `200`, and its known trial configuration is Program `61` plus $0 Service `100328`. The same source-token probe returned `403` (no site access) for the other six clubs. Consumer/API-key read probes on those six clubs also returned `403`, so consumer mode is **not** a safe fallback.

This proves authorization and configuration visibility only; it does not prove a club is ready for families. The reusable 30-day audit on July 17 found Program `61`, Service `100328`, required fields, and family relationships at Ridge Hill, but returned **zero upcoming Program 61 occurrences**. Ridge Hill is therefore also disabled from public trial requests. The live HubSpot family-status dropdown now exists, but a trustworthy Mindbody claim/link completion readback still does not.

Labels used below:

- **Verified** — observed in the live Mindbody API, live HubSpot API, or current application configuration.
- **Recorded** — present in source control but not re-opened from its source system during this audit.
- **Unknown** — must be obtained from the club or read from Mindbody after access is granted. No ID should be guessed or copied from Ridge Hill.

## Seven-club readiness matrix

The live API evidence used source `CedarWindSolutionsLLC`. For the six blocked sites, both the source-token request and the consumer read probes failed with `403`.

| Club | Mindbody Site ID | Live API authorization | Kids-trial Program / $0 Service | HubSpot Deal routing in code | Readiness |
|---|---:|---|---|---|---|
| **Allston** | `5754600` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Partial:** live `preferred_location` value is `Allston - Massachusetts`; no verified pipeline or stages | **Blocked** |
| **Downtown Brooklyn** | `135479` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `default`; `appointmentscheduled` → `qualifiedtobuy` | **Blocked** |
| **Fishtown** | `5742169` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `1818411`; `6445996` → `1031324174` | **Blocked** |
| **Long Island City** | `985499` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `1460258`; `5321400` → `11096161` | **Blocked** |
| **Manhattan–FiDi** | `5728093` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `2477627`; `8517561` → `8517634` | **Blocked** |
| **Newton** | `5751422` | **Verified blocked:** source `403`; consumer reads `403` | **Unknown / unknown** | **Recorded:** pipeline `873061120`; `1307706690` → `1307706693` | **Blocked** |
| **Ridge Hill** | `5748154` | **Verified:** source token and all six read probes `200`; zero Program 61 occurrences in the next 30 days | **Verified live:** Program `61`; Service `100328`; required fields and family relationships visible | **Verified live:** pipeline `830977386`; `1231873814` → `1231873816`; customer workflows remain off | **Disabled control; inventory, routing test, E2E acceptance, and design approval required** |

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

### Published Mindbody automation limit

Mindbody's published Public API exposes client records and business
`ClientRelationships`, but no password/account-claim flag, consumer-account
owner/dependent list, or “Manage Family Account” status. A successful
`sendpasswordresetemail` request proves only that Mindbody accepted the request.
Likewise, `client.updated` and merge webhooks are reevaluation signals, not
family-completion proof.

Two supported decision paths follow from that limit:

1. **Native-email path:** write `parent_claim_pending` after both original
   Client IDs are persisted; staff verifies `parent_claimed`,
   `child_link_pending`, and `family_complete` in Mindbody.
2. **OAuth option:** after consumer consent, call Client Complete Info with the
   `consumer-identity-token` and advance to `parent_claimed` only if the returned
   Client ID exactly matches the stored parent ID and expected site. This still
   cannot prove the child is manageable; `family_complete` remains staff-attested.

Never advance from a shared email, email delivery/open/click, account-email
preference, relationship row, generic profile modification time, password-reset
success, or merge event alone. See Mindbody's
[client schema](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/models/structures/client-with-suspension-info),
[password-reset endpoint](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/api-endpoints/client/send-password-reset-email),
and [webhook documentation](https://developers.mindbodyonline.com/WebhooksDocumentation).

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

The production private-app token was read directly on July 17 and has live CRM schema, Marketing Email, and Automation API access. The optional Codex HubSpot connector still asks for reauthorization for those write surfaces, but that no longer limits this inventory. Portal `4832170` currently contains 137 workflows and 5,519 marketing-email assets; the table below is the filtered kids-trial set.

The live audit also found the main redundancy: the booking app upserts its Contact and creates its own Deal, then used to submit legacy form `3e966ac4-872e-49ec-9b93-1f114fa6d39b`. That form event enrolls both the old account-creation guide and location Deal-creation workflows. This branch now skips the legacy form by default; `HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM=true` is an explicit compatibility escape hatch and must remain false for the Squarespace cutover.

| Communication / workflow | Asset IDs | Current evidence | Required change before multi-site use |
|---|---|---|---|
| Legacy step-by-step Mindbody account creation | Workflow `1735576602`; six published emails `201846047028`, `201818042541`, `201847007517`, `201559543656`, `201818042284`, `210974631011` | **Verified ON:** any completion of the legacy trial form branches by six locations and sends “Welcome! Please Create Your Profile to Book Your Kids Trial.” No Allston branch exists | Preserve for the current legacy form only. Exclude the new API-created-account path before cutover so parents do not receive the obsolete 11-step instructions |
| Legacy location Deal creation | Brooklyn `67896418`; LIC `177727332`; FiDi `395103245`; Fishtown `1734544004`; Ridge Hill `1734818196`; Newton `1790080829` | **Verified ON:** all six enroll from the same legacy form and create trial Deals, while the booking app already creates a correlated Deal directly | Do not let the new app emit the legacy form event; otherwise duplicate Deal creation remains possible. Do not disable these while the old form is still production intake |
| Staff new-request notification | Workflow `1835369220` | **Verified OFF** on July 17, revision `5`; pending-staff trigger and one internal-email action retained | Add `court16_intent=kid_trial`, branch recipients by club, verify owners, then test off before any activation |
| Parent trial confirmation | Workflow `1820575928`; email `212773423758` | **Verified OFF** on July 17, revision `6`; Ridge Hill-only confirmed/status trigger; email is published automated and non-transactional | Review classification and sender; branch by canonical club only after merge data and duplicate-message audit pass |
| Parent Mindbody account nudge | Contact draft `1853127851`; superseded Deal shell `1820551993`; email `212772629316` | **Verified OFF:** Contact workflow revision `1` waits 60 minutes and re-checks pending, but ledger-v1 no longer writes family/request state to Contacts. Both workflows remain off. Email is published automated and non-transactional | Replace with a Deal-based pending-family workflow; review copy/classification and test every stop branch before enabling |
| 24-hour reminder | Workflow `1820562947`; email `212773969554` | **Verified OFF**, revision `6`; Ridge Hill Scheduled stage, `class_date - 24h`, then the stated email | Re-check status immediately before send and prevent a duplicate Mindbody reminder; branch/clone per verified pipeline |
| Trial denied | Workflow `1820568681`; four wired emails plus unwired `213263710015` default candidate | **Verified OFF** on July 17, revision `11`; Ridge Hill-only failed/status trigger; four exact failure branches, but no default branch | Add safe default/manual review, verify picklist labels, route by club, and test every reason off |
| Manual-review / failed alert | No dedicated live workflow verified | **Not built** | Consolidate into one internal workflow with club owner, failure reason, correlation ID, and only supported staff links |

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
7. **Allston CRM routing is incomplete.** The exact live `preferred_location` value is now `Allston - Massachusetts`, but no verified pipeline or Requested/Scheduled stages exist. Do not fall back to Brooklyn/default.
8. **Family completion is not automated end to end.** Shared email + Parent/Guardian relationship do not create the consumer family view. The parent claim/Add Member and staff Connect steps still require stateful follow-up.
9. **HubSpot has a Deal family-status field but no trustworthy completion feed.** Opens/clicks still do not prove claim, OTP, Add Member, or child link completion. The existing Contact-based draft is incompatible with ledger-v1 and stays off; build/test a Deal-based replacement only after later-state evidence exists.
10. **Legacy HubSpot form workflows overlap the new app.** The old account guide and six Deal-creation workflows are ON. They remain necessary for the current form, so isolate the new API path instead of bulk-disabling production automation.
11. **Production test records are durable.** There is no safe API-delete path; every write test needs unique tags, named owners, and a cleanup list approved by staff.
12. **The distributed lock is implemented but not operationally verified.** Intake and all staff mutations now acquire a privacy-safe, cross-instance Redis lock with `SET NX EX` and token-checked release. Missing credentials, transport errors, and ambiguous responses fail closed before writes. `durableMutationLockVerified` remains false for every club until the production Redis credentials are installed and a two-instance concurrency test proves one winner and one blocked request.
13. **`MINDBODY_WRITE_MODE=test` is not a global safety switch.** Consumer-mode `AddClient` and `AddClientToClass` reject Mindbody's `Test` flag on real sites, and the `$0` checkout is also persistent. The application now blocks those operations unless the server-wide real-write flag is true and the exact Site ID is allowlisted.
14. **Contact-scoped duplicate history remains transitional.** New requests and staff actions now use a request-scoped Deal ledger, but the intake duplicate guard still consults the Contact's latest site/Client-ID mirror for older families. It fails closed across clubs and sends ambiguous records to manual review. Replace that remaining guard with associated historical Deal lookup before repeat-family automation is considered complete.

## Safety changes implemented in this branch

- Added all seven Site IDs to the shared location registry. All seven are now `trialBookingEnabled=false`; Ridge Hill's verified static IDs remain recorded while its missing live evidence stays explicit.
- Added a default-off global public launch gate plus per-club dated evidence for Mindbody authorization, upcoming inventory, HubSpot routing, end-to-end acceptance, and design-owner approval. Static IDs alone can no longer expose a club.
- Added a server-only irreversible-write gate: real Mindbody writes require `MINDBODY_REAL_WRITES_ENABLED=true` and the exact Site ID in `MINDBODY_REAL_WRITE_SITE_IDS`. Production refuses the `-99` sandbox as a write target, and all four mutation helpers enforce the guard.
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
- Generate one browser UUID per logical form session, store it as the unique Deal `court16_booking_key`, and reuse it across network retries. A cached Deal is read-only: intake never repeats Mindbody `AddClient` calls for that booking key.
- Added an additive, read-only-by-default Deal schema utility. It plans offline, verifies with GET only, and requires `HUBSPOT_DEAL_SCHEMA_APPLY=true` before creating missing fields; it never edits or deletes existing definitions.
- Made the Deal the sole request-state authority for confirm, reassign, and deny. Staff routes validate the Deal's Site, Program, Service, physical Location, class occurrence, original child, signed booking identity, and exactly one associated Contact; they do not read or write Contact booking-state mirrors.
- Added Deal write-ahead states before checkout and class enrollment. A timeout or ambiguous response moves the request to reconciliation and blocks a second automatic checkout.
- Changed the new-credit path to Mindbody checkout with the selected physical `LocationId`, `EnforceLocationRestrictions`, `ClassIds`, and correlation-tagged `SalesNotes`, then require an exact active Visit readback for Site, Location, client, class, Service product, and ClientService instance before confirming.
- Added a unique privacy-safe active-parent key on the Deal so one unresolved request per normalized parent email wins even across separate server instances. Confirm and deny release the key; reassign/manual reconciliation retain it.
- Made staff confirmation fail closed on intent, booking state, exact operational site/service mapping, current Mindbody write authorization, the correct child/adult Client ID, and an exact match between the per-request Deal pipeline and the Contact's ID-owning club. The public-launch switch is intentionally not part of this staff gate, so stopping new intake does not strand already accepted requests.
- Changed staff confirm/reassign links so GET only renders an explicit confirmation form; only POST mutates. Intake, confirm, reassign, and deny now use the server-only Upstash REST lock and fail closed if it is unavailable. Launch evidence remains false until production configuration and cross-instance concurrency are verified.
- Added best-effort IP/email signup throttling. A distributed edge/WAF limit is still required for production-scale abuse protection.
- Disabled adult payment offers until each displayed price is reconciled to the live Mindbody SKU; payment return now also requires signed state and an exact recent ClientService match.
- Disabled legacy HubSpot form submission by default for both kids-trial and adult-intro routes. Direct Contact upsert + correlated Deal creation remain the durable intake path; the old form event can be restored only with explicit `HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM=true`.
- Restricted ledger-v1 Contact updates to person-scoped parent name and phone. Child, class, family, Mindbody, action-link, and booking-state values remain on the request Deal so a sibling or later request cannot overwrite reporting or staff-email tokens.
- Made the stored Mindbody-ID duplicate guard site-aware. IDs from a Contact's previous club—or legacy IDs with no owning-site slug—are never verified or reused against a different Site ID, and the original ID/slug pairing is not overwritten by the manual-review request.

## Live HubSpot safety changes made on July 17

- Created Contact dropdown `court16_family_account_status` with `parent_claim_pending`, `parent_claimed`, `child_link_pending`, `family_complete`, and `manual_review`.
- Corrected the live descriptions for the per-occurrence class ID, seven location slugs, 72-hour signed staff URLs, legacy Deal deny URL, and denial-reason routing. No Contact or Deal values were changed.
- Turned OFF the five pre-existing Cedarwind workflows (`1820551993`, `1820562947`, `1820575928`, `1820568681`, `1835369220`) and created trusted-status workflow `1853127851` OFF. The six legacy form/Deal workflows and global step-by-step workflow were not changed.
- Verified 14 all-time Contacts with `court16_intent=kid_trial` and 13 Deals carrying a Court 16 correlation ID; they appear to be Ridge Hill test fixtures. No records were deleted or edited.

## Phased rollout and acceptance tests

### Phase 0 — decisions and access

- Ibtissam approves the single-owner email map, family-account state model, and per-club staff owner.
- Mindbody grants the six missing site authorizations.
- HubSpot direct API inventory is complete; all Cedarwind workflows remain off. Reauthorize the optional connector separately only if Ibtissam wants edits through that connected app.

**Exit:** every club has named owners and the six read-only Mindbody preflights return `200`.

### Phase 1 — configure one club at a time

- Build/verify Program, age bands, curated occurrences, $0 Service, Comp checkout, required fields, relationship catalog, and native email settings.
- Capture exact Mindbody and HubSpot IDs; add config behind a per-club disabled flag.

**Exit:** the public API returns only intended trial occurrences for that club, and no unknown/fallback ID is used.

### Phase 2 — draft HubSpot routing

- Create/verify the club's Deal pipeline and exact enum value.
- Route staff tasks to one club owner.
- Branch approved emails using canonical `court16_location_slug` values.
- Use the existing family states: `parent_claim_pending`, `parent_claimed`, `child_link_pending`, `family_complete`, `manual_review`.
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
6. **Allston CRM setup:** provide the exact HubSpot pipeline, Requested/Scheduled stage IDs, public launch status, and owning inbox. The live `preferred_location` value is already verified as `Allston - Massachusetts`; unknown routing values must remain disabled.
7. **Per-club routing:** name the single accountable staff recipient/queue and backup for each location.
8. **Test-data cleanup:** choose who may merge/deactivate duplicates in Mindbody and how test Client IDs are logged. No automated deletion is assumed.
9. **Rollout order:** select the first newly authorized pilot club after Ridge Hill and approve the five-family acceptance threshold.

Until those decisions and the per-site tests are complete, the safe state is: **no Squarespace cutover; all seven public kids-trial locations disabled; Ridge Hill retained only as the authorized test control; all Cedarwind workflows off; legacy form workflows unchanged.**
