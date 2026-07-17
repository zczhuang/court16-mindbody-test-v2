# Court 16 Booking — archived April 2026 snapshot

> [!CAUTION]
> **ARCHIVED — DO NOT USE THIS FILE TO RUN TESTS, CHANGE AUTOMATION, OR MAKE A GO-LIVE DECISION.**
> This file preserves an April 18 snapshot and contains superseded sandbox, site-access,
> property-count, workflow, and cleanup assumptions. A submission to the current app can
> create durable Mindbody and HubSpot records. Use the
> [current multi-site readiness audit](docs/multi-site-automation-audit.md),
> [Mindbody email and family-link handoff](public/package-a/06-password-setup-email.html),
> and [staff family-account guide](public/package-a/10-family-account-staff-guide.html)
> instead.

**Historical demo URL — do not submit test data:** <https://court16-mindbody-test.vercel.app>
**Snapshot date:** April 18, 2026
**Author:** Stuart Chuang, Cedarwind

---

## What the April snapshot claimed

We built a new online booking experience for Court 16 that replaces the
clunky "12-field form + 11-step MindBody setup + 2-5 days of silence"
flow parents hit today. Two paths — a **free kids trial** and a **paid
adult intro offer** — both collect everything we need in under 2 minutes,
create the MindBody accounts behind the scenes, and hand off to Ibtissam's
existing HubSpot follow-up. At the time, the demo was described as using a
MindBody test sandbox. That statement is historical and must not be used as a
current safety assumption; current production-site test records are durable.

---

## Historical product description

### For parents booking a kids trial

1. Land on the homepage, click **"Start kids trial"**
2. Pick one of the six clubs listed in the April prototype (not a statement of current authorization)
3. Pick their kid's age (dropdown)
4. Browse real MindBody calendar — see which days have available classes, how many spots are open
5. Click a class → a modal pops up asking for name, email, phone (required), child's name, age, optional notes
6. Submit → confirmation screen with a reference number

Historical intended behavior under the hood:
- Checks MindBody for an existing account with that email; this was not proof that duplicates were impossible
- Creates the parent's MindBody account
- Creates the child's MindBody account using the same reachable parent email
- Links the pair with the site's verified Parent/Guardian relationship
- Submits to the existing Court 16 HubSpot trial form, so Ibtissam's nurture automation fires
- Stamps a signed URL that staff can click in an email to one-click confirm the class in MindBody (future)

### For adults booking an intro offer

Same shape:

1. Click **"Start adult intro"** on the homepage
2. Pick a club
3. Pick an offer: **Tennis Intro Special ($75)** or **Pickleball Clinic Intro ($58)**
4. Pick a class
5. Modal collects name, email, phone, date of birth
6. Click "Continue to payment" → redirected to MindBody's secure cart
7. After payment, lands back on a confirmation screen that verifies the payment and books the class

### Design

- Inspired by Court 16's existing brand (black + yellow, playful but clean)
- Uses Google's free **Geist** font for a modern look
- Warm paper-colored background
- The two cards on the homepage have a playful shadow that follows your cursor

---

## April status table — superseded

| Piece | Status |
|---|---|
| Homepage + navigation | ✅ Live |
| Kids trial flow — end to end | ✅ Live (using MindBody's test sandbox) |
| Adult intro flow — through payment redirect | ✅ Live |
| MindBody writes (no more duplicate accounts) | ✅ Proven against sandbox |
| HubSpot form submission + Ibtissam's nurture | ⚠️ Works, but some of our new fields get dropped until Ibtissam adds them (see below) |
| Payment | ⚠️ Redirects to MindBody cart; cart itself needs Anthony's MindBody to be wired for online sales |
| Staff one-click confirm (via email) | ⚠️ Code ready; email templates need Ibtissam |
| Real class data from Court 16's real MindBody sites | ❌ Blocked — currently showing sandbox data |

---

## Historical go-live list — superseded

This was the April work list. Do not execute it as written. Ridge Hill is now
the only authorized control site; the six expansion sites remain unauthorized,
and current per-site/readiness evidence lives in the multi-site audit linked above.

### 🎾 Anthony — MindBody side

**April assumption:** the developer account still needed Mindbody's formal
“Go Live” review. That was the blocker recorded in this snapshot, not the
current access state. Ridge Hill is now authorized; the six expansion sites
still require site-specific authorization and preflight evidence.

1. **Submit Cedarwind's developer account for Go Live review** at
   developers.mindbodyonline.com. Stuart files the paperwork; Anthony's role
   is writing a short email to MindBody confirming "Cedarwind is our
   authorized integration partner for Court 16 booking, please approve their
   developer key." Without this, every real-site API call returns 403 with
   the message *"Before you can use this endpoint, MINDBODY must approve your
   developer account for live access."* (Confirmed 2026-04-18 against all 6
   real Court 16 site IDs.)
2. **Authorize Cedarwind's API key in each site's MindBody admin.** Once Go
   Live approval lands, Anthony's second step: in each of the 6 sites'
   Settings → API Integrations, toggle Cedarwind on. ~2 min per location.
3. **Provide the MindBody "service IDs"** for Tennis Intro Special and
   Pickleball Clinic Intro at each location. Staff can read these from the
   MindBody admin; we plug them into `config/locations.ts`.
4. **Verify the two adult intro offers are set up to sell online** in each
   site's cart settings. If they're staff-only today, flip them to
   "sellable online" so the payment flow completes.

The April plan proposed flipping `MINDBODY_WRITE_MODE=live` and
`MINDBODY_USE_SANDBOX_FALLBACK=false` after those steps. **Do not do that from
this archived checklist.** The current per-site readiness and acceptance gates
must pass first.

**What's already confirmed:** Real Court 16 MindBody site IDs have been
scraped from court16.com/login and are now correct in the app's config:

| Club | Site ID |
|---|---|
| Downtown Brooklyn | 135479 |
| Long Island City | 985499 |
| FiDi, Manhattan | 5728093 |
| Ridge Hill, Yonkers | 5748154 |
| Fishtown, Philadelphia | 5742169 |
| Newton, MA | 5751422 |

The Sign in ▾ dropdown in the app already deep-links to each club's
MindBody login page using these IDs.

### 📧 Ibtissam — HubSpot side (~30 minutes total)

1. **Add 12 custom properties on the Contact object** (list documented in
   `docs/hubspot-properties.md` inside the repo). These let the app track
   which booking request a contact corresponds to, the MindBody IDs we created,
   the signed staff-confirm URL, etc. Without them, the extra data from our
   app is silently dropped by HubSpot (the existing form fields still work fine).
2. **Create 2 workflows** (documented in `docs/hubspot-workflows.md`):
   - Staff trial notification — fires when the app flags a trial as pending
     staff confirmation
   - Parent confirmation — fires when staff confirms, sends the "you're in!" email
3. **Add a filter to the existing kids-trial nurture workflow** so it doesn't
   fire for adult submissions (a one-line `intent != kid_trial` rule).
4. **Historical reCAPTCHA proposal — do not execute.** The April list blamed
   a Forms API 400 on the live form's reCAPTCHA setting. Current code does not
   assume that server-to-server submissions require this toggle. Reproduce the
   current behavior and audit website embeds, nurture enrollment, spam controls,
   and the rollback owner before proposing any live-form change.
5. **Optionally: create a Private App API token.** This is what lets the staff
   one-click-confirm emails actually work. Without it, staff will still get
   notified but they'll confirm the class manually in MindBody admin (same as
   today, just with cleaner signup data on their end).

### 🧑‍⚖️ Legal — waiver text (1-2 hours with a lawyer)

- Get a lawyer to review the participation waiver text that parents check a
  box for. The app already stores which version was accepted and when, so the
  legal team just needs to approve the wording.

### 🔒 April final-tuning proposal — do not execute

- The snapshot proposed flipping the write mode, pointing DNS, and updating
  launch copy after one smoke test.
- That sequence is superseded by the current per-site audit, family-account
  acceptance test, authorization gates, and controlled rollout plan.

---

## The one known design tradeoff

We originally planned for the adult payment step to happen **inside a popup on
our page** (parent stays on `app.court16.com` the whole time). During
implementation we discovered that MindBody's classic cart page blocks that
kind of embedding for security reasons.

We had two options:

1. **Redirect** — click "pay" → MindBody's cart opens, payment completes,
   parent is sent back to our confirmation page. What the app does today.
   Slightly less polished because the parent briefly sees MindBody's UI.
2. **Use MindBody's "Healcode" embeddable widgets** — MindBody's own branded
   widget system that's explicitly designed to be embedded. This requires
   Anthony to set up widgets per location in MindBody admin (~15 minutes per
   location). Would give us the fully-embedded experience we originally wanted.

The redirect works today. Healcode is an optional upgrade whenever Anthony wants
the extra polish.

---

## Historical risk assessment — not a current guarantee

The previous vendor (BLINK) tried something similar and failed. The specific
things they couldn't get working are all working here:

- **Duplicate guard prototype** — the April implementation checked before
  creating clients; current acceptance still requires proof that an existing
  child Client ID is reused and connected rather than duplicated
- **Parent/Guardian relationship prototype** — the current flow must use the
  same parent email on both records and the exact relationship verified for
  that Mindbody site
- **Full logging** — every write has a correlation ID traced through logs,
  so debugging a failed booking takes ~60 seconds instead of the "no idea
  what happened" BLINK produced
- **Superseded safety-switch assumption** — `Test=true` is not a deletion or
  expiry guarantee on a real Mindbody site. Treat every current write as durable.

---

## Do not run the former demo walkthrough

The former “try it right now” instructions were removed because they relied on
an obsolete `-99`/sandbox assumption. Do not submit a fake family, click a
signed staff-action URL, or test payment from this document. A controlled write
test requires a staff-approved fixture, a named cleanup owner, the current
per-site readiness gates, and a record of the original parent and child Client
IDs. The HubSpot parent-account nudge remains off until a trustworthy
family-status gate exists.

---

## Questions recorded in April — superseded

1. **Anthony**: are you OK flipping the MindBody Api-Key authorization for
   all 6 sites this week, or would you rather start with one pilot site
   (suggest Downtown Brooklyn) to prove the live flow first?
2. **Ibtissam**: can you add the 12 HubSpot contact properties + 2 workflows
   this week? All instructions are in the repo; no coding required.
3. **Both**: any copy changes to the homepage hero ("Book a Court 16 trial"),
   the path-selection cards, or the confirmation screens before we point
   `app.court16.com` at this?
4. **Legal**: who's the right contact for the participation waiver review?

---

## Appendix — what's in the repo

At the time, the code lived at <https://github.com/zczhuang/court16-mindbody-test>
on branch `track1/new-customer-booking`. That branch reference is historical.
Current handoff sources are linked in the archive warning at the top.

- `README.md` — how to run the app locally, MindBody setup steps
- `docs/hubspot-properties.md` — the exact 12 contact properties to add
- `docs/hubspot-workflows.md` — the 2 workflows with trigger conditions + email templates
- `Court16_Phase3_Ideal_State_PRD.md` (in the parent folder) — the North Star vision
  this slice delivers against

The old claim that the public build mirrored that branch is not a statement of
current deployment state. Do not infer deployment safety from this snapshot.
