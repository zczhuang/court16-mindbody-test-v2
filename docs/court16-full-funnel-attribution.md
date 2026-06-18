# Court 16 Full-Funnel Attribution — Threading GTM ↔ HubSpot ↔ MindBody

**Prepared for:** Anthony, Marketing — Court 16
**Prepared by:** Stuart / Cedarwind
**Date:** June 18, 2026
**Companion to:** `docs/court16-command-center-proposal.md` (this is the top-of-funnel instrumentation that makes the proposal's Phase 2 real)

---

## 1. Executive summary

You now have Google Tag Manager access for court16.com (container `GTM-KBNVWWQ`, workspace 64). GTM is the missing **top-of-funnel instrument** — the one piece that captures *where a visitor came from* (the ad click, the campaign) and hands it to HubSpot at the moment they become a known lead. Once that identity is on the HubSpot contact, the hard MindBody key your booking app already writes carries it all the way to revenue.

The whole funnel becomes one funnel if you stitch it at **two seams**:

- **Seam 1 — web → lead.** GTM captures the click/session identifiers (`gclid`, `utm_*`, the GA4 `client_id`) in the browser and injects them into the trial form at submit, so they land on the HubSpot contact. Email becomes the identity at this moment.
- **Seam 2 — lead → revenue.** Email + the hard `Client.Id ↔ court16_mindbody_*_id` key (already written at booking time) carries the contact to MindBody trials, sales, and memberships.

The payoff is not just *measurement* — it's *optimization*: once MindBody confirms someone became a paying member, you push that conversion back to Google (and later Meta) so the ad platforms bid on **real members and revenue, not form-fills**.

**The good news from auditing your live site: you're further along than expected.** GTM, the HubSpot tracking code, and Google Ads conversion tagging are *already deployed* on court16.com. The real gaps are narrow and specific (§2).

---

## 2. The honest baseline — what's actually live on court16.com today

Audited directly from the live court16.com HTML on June 18, 2026:

| Tag | Status | What it means |
|---|---|---|
| **GTM `GTM-KBNVWWQ`** | ✅ live | Your single injection point for everything below. Account 6003379218 / container 41554898 / workspace 64. |
| **HubSpot tracking `4832170`** | ✅ live (`js.hs-scripts.com/4832170`) | The `hubspotutk` visitor cookie is **already set** on `www.court16.com`. HubSpot-native source stitching half-works today — it just doesn't reach the booking app. |
| **Google Ads `AW-955662958`** | ✅ live + `gtag('config', …)` | An Ads account is already tagged. This makes **Enhanced Conversions for Leads the fast loopback win** — no new ad account plumbing. |
| **GA4 (`G-XXXXXXXX`)** | ❓ **not found in page HTML** | Either fired inside the GTM container (you can confirm — you have access) or not configured at all. **This is step 0.** |
| **Universal Analytics `UA-158765342-1`** | ⚠️ present but **dead since July 2023** | A stale tag collecting nothing. Remove it to avoid confusion. |
| **Meta Pixel** | ❌ none detected | No Pixel on the static page → Meta CAPI is a *later* phase that needs a Pixel installed first. Google goes first. |
| **Site platform** | **Squarespace** (canonical `www.court16.com`) | Changes *how* you inject/manage tags (Code Injection / GTM) and how consent interacts. |
| **Booking app** | `app.court16.com` (Next.js, this repo) | A **subdomain** of court16.com — not a separate domain (this materially simplifies the stitching). Confirm the alias is actually live; it did not respond to an external request during the audit. |

**The three real gaps, precisely:**

1. **GA4 is unconfirmed.** There is a dead UA tag but no visible GA4. Confirming (or creating) the GA4 tag in your GTM container is the literal first step — and it's the spine of the BigQuery join later.
2. **The booking app inherits nothing.** `app.court16.com` is a different subdomain from `www.court16.com`, and it has **no GA/GTM snippet and no HubSpot tracking code** today. So neither the GA `client_id` nor the `hubspotutk` cookie reaches the trial form — even though the form code is *already wired* to use them (§4).
3. **Zero click/campaign capture.** No `gclid`/`utm_*`/`ga_client_id` is collected anywhere, and there's no field to hold it. This is net-new — but small.

---

## 3. The identity model — two seams, one funnel

Each system sees a different slice; they only become one funnel at the two seams.

```
  ANONYMOUS WEB                 KNOWN LEAD                    REVENUE
  ─────────────                 ──────────                    ───────
  GTM + GA4                     HubSpot                       MindBody (6 sites)
  (www.court16.com)             (portal 4832170)              (Client.Id)
       │                             │                             │
  sees: gclid, utm_*,           sees: email (identity),       sees: trial attended,
  fbclid, _ga client_id,        lead_source, deal pipeline,   first sale, membership,
  landing page, referrer        original/latest source        MRR, churn, revenue
       │                             │                             │
       │   SEAM 1                    │   SEAM 2                     │
       │   GTM injects the click +   │   email  +  the hard key    │
       │   session ids into the      │   court16_mindbody_*_id     │
       │   trial form at submit;     │   (already written at       │
       │   email becomes identity    │   booking time)             │
       └────────────►────────────────┴────────────►───────────────┘
                          join key:                    join key:
                  ga_client_id (→ user_pseudo_id    email  +  Client.Id
                   in BigQuery) + hubspotutk        (hard, app-driven bookings)

  ◄──────────────────────  LOOPBACK  ──────────────────────────────
  When MindBody confirms "became a member", push the conversion back
  to Google Ads (Enhanced Conversions for Leads, hashed email) and
  later Meta (CAPI). Ads now optimize on members + revenue, not leads.
```

**Why the subdomain detail matters.** `www.court16.com` → `app.court16.com` share the registrable domain `court16.com`. A cookie scoped to `.court16.com` (leading dot) is readable on both, and GA4's default `cookie_domain: 'auto'` already writes the `_ga` cookie at the root. So you get cross-subdomain identity **without** the cross-domain linker — provided you keep one GA4 property, leave `cookie_domain` at `auto`, and add a referral-exclusion entry to avoid self-referrals (verified correction — it is *not* fully zero-config; see §8).

---

## 4. What's already built (and dormant) — the head start

Reading the booking-app code, **Seam 1's HubSpot-native half is already plumbed end-to-end** — it's just starved of input:

- `submitTrialForm(cfg, log, fields, { context: { hutk, pageUri, pageName, ipAddress } })` already exists — `lib/hubspot.ts:186–219`.
- The trial page already reads the cookie and forwards it: `app/trial/page.tsx:187` does `document.cookie.match(/(?:^|;\s*)hubspotutk=([a-f0-9]{32})/i)` and builds `hsContext` at lines 188–192.
- Both booking routes validate + forward it: `app/api/book/trial/route.ts` (`sanitizeHsContext`, def 588–598; `submitTrialForm` at 575) and `app/api/book/intro/route.ts` (def 452–462; submit at 440). The 32-hex `hutk` is regex-validated so a malformed value can't reject the whole submission.

**Why it's dormant:** `hutk` only exists if the HubSpot tracking code set the cookie on the page the visitor is on. It's live on `www.court16.com` but **not on `app.court16.com`**, so the trial form reads an empty `hutk` today. Fixing that (§6, Phase 0) lights up HubSpot-native source attribution with *zero code changes*.

**What's genuinely net-new** is the click/campaign capture (`gclid`, `utm_*`, `ga_client_id`) — there's no field for it yet, and three lead-entry points need it:

1. `app/api/book/trial/route.ts` — kids trial (3 submit sites).
2. `app/api/book/intro/route.ts` — adult intro (4 submit sites).
3. `app/api/chatbot/lead/route.ts` — chatbot lead, which writes via `upsertContactByEmail` (line 115) and currently captures **no** context at all.

---

## 5. The field map — new `court16_*` attribution properties

Following the established `court16_` snake_case convention (matches `court16_correlation_id`, `court16_mindbody_parent_id`, etc.). These become **new HubSpot Contact properties** and **new optional keys on `TrialFormFields`** — the Forms API accepts any contact property, and `submitTrialForm` serializes whatever's on the `fields` object (`stripUndefined`, `lib/hubspot.ts:206`), so no whitelist gates them.

| New HubSpot property | Captured from (browser) | Join / purpose | Touch |
|---|---|---|---|
| `court16_gclid` | `?gclid=` URL param (+ `gbraid`/`wbraid` for iOS) | Google Ads click → optional accuracy booster for Enhanced Conversions | first-touch |
| `court16_fbclid` | `?fbclid=` URL param / `_fbc` cookie | Meta CAPI click match (later phase) | first-touch |
| `court16_utm_source` | `?utm_source=` | maps to `dim_channel` | first-touch |
| `court16_utm_medium` | `?utm_medium=` | maps to `dim_channel` (`paid_search`/`paid_social`/…) | first-touch |
| `court16_utm_campaign` | `?utm_campaign=` | **the single join key** to `dim_campaign` (proposal §9 taxonomy token, verbatim) | first-touch |
| `court16_utm_term` | `?utm_term=` | paid-search keyword | first-touch |
| `court16_utm_content` | `?utm_content=` | creative / ad-set variant | first-touch |
| `court16_ga_client_id` | `gtag('get', 'G-XXXX', 'client_id', cb)` | **joins HubSpot contact → GA4 `user_pseudo_id` in BigQuery** | at submit |
| `court16_ga_session_id` | `gtag('get', 'G-XXXX', 'session_id', cb)` | session-level stitching (optional) | at submit |
| `court16_landing_page` | `location.href` of the first visit | first-touch landing page (incl. query string) | first-touch |
| `court16_first_referrer` | `document.referrer` of the landing visit | first-touch traffic source | first-touch |

**Load-bearing minimum** (ship these first): `court16_gclid`, the four core `court16_utm_*`, and `court16_ga_client_id`.

**Two naming cautions:**
- **`court16_first_referrer`, not `court16_referrer`** — the form already has a human-entered `referrer` field ("who referred you"). Don't collide.
- **Capture model = first-touch wins.** Persist first-touch values to a `.court16.com` cookie on landing so they survive multi-page navigation to the booking form; read the live `ga_client_id` at submit. Because HubSpot upserts on email, mark first-touch properties "do not overwrite" in workflow logic so a re-submission can't clobber the original click.

These reconcile 1:1 with the existing **UTM + campaign-naming taxonomy** (proposal §9 — `{club}_{audience}_{objective}_{channel}_{offer}_{yyyymm}`). Keep storing the lowercase `utm_campaign` token verbatim so it matches `dim_campaign`, and keep the `lead_source` self-report dropdown (8 values: Word of Mouth / Flyer / Friend with a Court 16 member / Google / Facebook / Instagram / Other / Events) as the graceful-degradation fallback where UTM is absent.

---

## 6. Implementation roadmap

### Phase 0 — Foundation (hours, no code; do this first)

All in GTM + settings, no repo changes. Highest leverage because it lights up HubSpot-native attribution immediately.

1. **Confirm or create GA4 in the GTM container.** In workspace 64, check for a GA4 Configuration / Google Tag. If present, record its Measurement ID (`G-XXXX`). If absent, create the GA4 property + the config tag — this is the spine of the BigQuery join later.
2. **Set `cookie_domain: 'auto'`** on the GA4 config (the default) so the `_ga` cookie is written at `court16.com` and shared across subdomains. Do **not** hard-code it to a subdomain.
3. **Deploy the HubSpot tracking code + GA4 config tag on `app.court16.com`** (via the same GTM container or directly in the Next.js app). This sets `hubspotutk` and `_ga` on the booking app — instantly activating the already-built `hutk` path (§4).
4. **Register `app.court16.com` in HubSpot** tracking/domain settings so `hubspotutk` continuity across the subdomain boundary is reliable. Don't double-install the tracking code on any page.
5. **Add a self-referral exclusion** for `court16.com` (and confirm one GA4 property across both subdomains) so the `www → app` hop doesn't fragment sessions.
6. **Remove the dead `UA-158765342-1` tag.**

*Outcome: HubSpot Original/Latest Source attribution works across the full journey with zero code changes; GA4 is confirmed and measuring both subdomains as one user.*

### Phase 1 — Capture the click identity (small build)

1. **GTM "All Pages" capture tag** (§7.1) — reads `gclid`/`gbraid`/`wbraid`/`fbclid`/`utm_*` from the URL + the GA `client_id` via the official `gtag('get', …)` API, and writes one first-touch-preserving cookie `c16_attr` scoped to `.court16.com`.
2. **Create the new HubSpot Contact properties** from §5 (via `/crm/v3/properties/contacts`, same group pattern as the existing `court16_*` properties).
3. **Booking-app wiring** (exact touch points in §10): read `c16_attr` (and `useSearchParams()`) in the page submit handlers, extend the `hsContext`/`TrialRequest`/`IntroBody` types + the two `sanitizeHsContext` validators + the `buildFormFields` mappers to write the new `court16_*` keys onto the submitted `fields`. Do the same for the chatbot route's `ChatbotLeadBody` + `upsertContactByEmail` call.

*Outcome: every lead — trial, intro, and chatbot — carries its ad click, campaign, and GA `client_id` onto the HubSpot contact. Seam 1 closed.*

### Phase 2 — Land it in the warehouse (with the Command Center build)

1. **Turn on GA4 → BigQuery export** (free to enable; daily/batch export is free under 1M events/day for a standard property — far above Court 16's volume). Lands `events_YYYYMMDD` in `analytics_<property_id>`. **Not retroactive** — enable now so history accrues.
2. **Join in BigQuery:** `crm_contact.court16_ga_client_id = ga4_events.user_pseudo_id` to attach full session/source behavior to the contact (`user_pseudo_id` is *normally* the `_ga` `client_id` — see §8 caveat), then contact → MindBody on email + `court16_mindbody_*_id` (Seam 2). This is the `raw_ga4` source the proposal reserved space for.

### Phase 3 — Close the loop back to the ad platforms (the payoff)

1. **Google Ads — Enhanced Conversions for Leads** (do this first; `AW-955662958` already exists). When MindBody confirms a membership, upload the conversion keyed on **hashed email** — no `gclid` plumbing through MindBody required. Spec in §9.1.
2. **Meta — Conversions API** (later; requires installing a Pixel/Dataset first). Send a server-side `Purchase` event keyed on stored `_fbc`/`_fbp` + hashed email. Spec in §9.2.

---

## 7. GTM tag configs (current 2026 patterns)

### 7.1 The capture tag — Custom HTML, fires on All Pages (Initialization / DOM Ready)

```html
<script>
(function () {
  var ATTR = ['gclid','gbraid','wbraid','fbclid',
              'utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
  var qs = new URLSearchParams(location.search);
  var store = {};
  try { store = JSON.parse(decodeURIComponent(
        (document.cookie.match(/(?:^|;\s*)c16_attr=([^;]+)/)||[])[1] || '%7B%7D')); } catch(e){}

  // First-touch wins: only write a key if it isn't already stored
  ATTR.forEach(function(k){ var v = qs.get(k); if (v && !store[k]) store[k] = v; });
  if (!store.landing_page) store.landing_page = location.href;
  if (!store.first_referrer && document.referrer) store.first_referrer = document.referrer;

  function persist(){
    var d = new Date(); d.setTime(d.getTime() + 400*864e5); // Chrome caps writes at 400d
    document.cookie = 'c16_attr=' + encodeURIComponent(JSON.stringify(store)) +
      ';expires=' + d.toUTCString() + ';path=/;domain=.court16.com;SameSite=Lax;Secure';
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event:'c16_attr_ready', c16_attr: store });
  }

  // GA client_id via the OFFICIAL gtag get API — do NOT parse the _ga cookie (format changed May 2025)
  if (typeof gtag === 'function') {
    gtag('get','G-XXXXXXXX','client_id', function(cid){
      store.ga_client_id = store.ga_client_id || cid;
      gtag('get','G-XXXXXXXX','session_id', function(sid){
        store.ga_session_id = store.ga_session_id || sid; persist();
      });
    });
  } else { persist(); }
})();
</script>
```

Read it back on `app.court16.com` with a **1st Party Cookie variable** named `c16_attr` (or straight from `dataLayer`), parse the JSON in the form submit handler.

Notes baked in from the research:
- **One cookie, leading-dot root domain** (`domain=.court16.com`) → readable on both subdomains with no linker.
- **First-touch guard** so a later untagged pageview can't blank the original `gclid`/`utm`.
- **`gtag('get', …, 'client_id', cb)` is the supported API** — Google changed the `_ga`/session cookie format in early May 2025 (the old `GA1.x` dot-split → a new `$`-delimited format), which broke every cookie-scraping script. The `get` API is format-stable. Sequence this tag *after* the GA4 config tag (it's async).

### 7.2 HubSpot tracking — Custom HTML, All Pages

Deploy `js.hs-scripts.com/4832170.js` via GTM on `app.court16.com` (it's already live on `www`). HubSpot officially supports the GTM install. Register `app.court16.com` in HubSpot domain settings; never double-install on a page that already has it.

### 7.3 GA4 config — leave `cookie_domain` at `auto`, gate behind consent

`gtag('config','G-XXXXXXXX')` with default `cookie_domain:'auto'`. Wire Consent Mode v2 so the GA4 tag (and thus the `client_id` capture) only fires after `analytics_storage` is granted (§8).

---

## 8. Consent, privacy & correctness caveats (read before shipping)

These are the verified "gotchas" that will silently break the join if missed:

- **Consent Mode v2 governs the capture.** The `_ga` cookie and a *stable* `client_id` only exist when `analytics_storage = 'granted'`. Under Advanced consent mode, pre-consent pings use a **temporary `client_id` that won't match** BigQuery's `user_pseudo_id`. **Stamp the hidden field only after consent is granted**, or the CRM↔GA4 join silently misses/duplicates.
- **US context still warrants a CMP.** `ad_user_data`/`ad_personalization` enforcement is primarily EEA/UK, but California CPRA + CIPA wiretapping class-action exposure make gating analytics behind consent the prudent default even for US-only traffic. (Squarespace has a native cookie banner; confirm it actually controls the GTM tags, or use a dedicated CMP.)
- **`user_pseudo_id` ≈ `client_id`, not a guaranteed 1:1.** It's the documented general case for standard web streams under granted consent; it can diverge under cookieless pings. Treat the join as "normally matches," and keep email + `court16_mindbody_*_id` as the authoritative spine.
- **Subdomain reality:** no cross-domain **linker** is needed, but it is *not* zero-config — keep `cookie_domain:'auto'`, use one GA4 property/stream across both subdomains, and add a self-referral exclusion. (If `app` ever moves to a different registrable domain — e.g. a MindBody-hosted booking domain — you'd then need the real cross-domain linker.)
- **Safari ITP cookie cap — why it barely bites this architecture.** JS-set cookies (`document.cookie`) are capped at ~7 days on Safari (24h if the landing URL carries `gclid`/`fbclid`). That would matter if you relied on the cookie weeks later — but you don't: the `c16_attr` cookie only needs to survive **from landing until form submit** (minutes/hours), after which the values live permanently on the HubSpot contact. So the cap is a non-issue *for the lead capture*. It only becomes relevant if you later want long-window client-side attribution, which is the case for server-side GTM (§11).
- **PII in BigQuery.** Joining HubSpot consent/marketing data with MindBody revenue/DOB creates a combined PII store — apply column-policy tags on email/phone/DOB and honor HubSpot consent before any reverse-ETL activation (consistent with the proposal's Phase 3).
- **Verify-before-publishing flags** (directionally right, not confirmed against a primary source in this pass): a June 15 2026 Consent Mode change narrowing `ad_storage`'s role for Google Ads data, and GA4's "User-provided data collection" toggle reportedly removing `user_id` from the BigQuery export. Confirm both against the live Google support articles before relying on them.

---

## 9. Offline-conversion loopback specs

### 9.1 Google Ads — Enhanced Conversions for Leads (the near-term win)

Court 16 already has `AW-955662958`, so this is the fastest path to "ads optimize on members."

- **Match key = hashed email**, not `gclid`. Google's 2026-recommended path for CRM-reconciled lead conversions; matches on first-party data, so MindBody never has to carry a `gclid`. (Capturing `court16_gclid` is an optional accuracy booster, not a requirement.)
- **Hashing:** SHA-256 of the normalized email — lowercase + trim whitespace; for `gmail.com`/`googlemail.com` only, strip dots and any `+suffix` from the local part. Hex *or* base64 encoding both accepted.
- **Transport:** `uploadClickConversions` (Google Ads API) **today**; migrate to the **Data Manager API** before **June 15, 2026**, after which the Ads API blocks these uploads for developer tokens that haven't previously sent offline/ECL uploads. *(Court 16's calendar is mid-2026 — treat Data Manager API as the go-forward target now.)*
- **Consent:** required for EEA end users (Google EU User Consent Policy); functionally necessary everywhere for attribution — populate the conversion's `consent` field.

Representative upload (illustrative):

```json
{
  "conversions": [{
    "conversionAction": "customers/CID/conversionActions/AID",
    "conversionDateTime": "2026-06-18 14:05:00-04:00",
    "conversionValue": 189.00,
    "currencyCode": "USD",
    "userIdentifiers": [
      { "hashedEmail": "<sha256(lowercased+trimmed email)>" }
    ],
    "consent": { "adUserData": "GRANTED", "adPersonalization": "GRANTED" }
  }]
}
```

**Trigger:** the MindBody → HubSpot membership signal (a contract/autopay start, reconciled by email) is what fires the upload. That signal is the same one the Command Center's `fct_membership_month` is built on — so this loopback is a thin reader on top of the warehouse work, not a separate integration.

### 9.2 Meta — Conversions API (later; needs a Pixel/Dataset first)

No Pixel is on the site today, so this phase starts with installing a Pixel/Dataset.

- **Capture at form submit:** `fbclid` (build `_fbc` = `fb.1.<ms-timestamp>.<fbclid>` if no `_fbc` cookie exists), the `_fbp` cookie, email, and a self-generated `event_id`.
- **Send server-side** to `POST https://graph.facebook.com/v<ver>/<DATASET_ID>/events` when the membership reconciles by email: `event_name:"Purchase"`, `action_source:"system_generated"` (or `"email"`), `user_data` = hashed email + raw `_fbc`/`_fbp`, `custom_data` = value/currency/order_id, plus `event_id`.
- **Do not hash** `fbc`/`fbp`; **do** SHA-256 the email/phone/name fields.
- **Dedup** browser↔server on `event_name` + `event_id` (48h window). The old standalone Offline Conversions API was sunset May 14 2025 — everything flows through the unified Conversions API into the same Dataset.

---

## 10. Code-change map (booking app)

Exact touch points for Phase 1, item 3 — for whoever implements (no changes applied yet):

| File | Change |
|---|---|
| `lib/hubspot.ts` (`TrialFormFields`, ~114–184) | Add the new optional `court16_*` keys from §5. |
| `lib/trial-types.ts` (`TrialRequest.hsContext`) | Extend the carried shape to include the attribution block. |
| `app/trial/page.tsx` (`handleTrialSubmit`, 182–215) | Read `c16_attr` cookie + `useSearchParams()` (the `params` hook is already in scope at line 28), fold values into the POST body alongside the existing `hsContext`. |
| `app/api/book/trial/route.ts` (`sanitizeHsContext` 588–598; `buildFormFields` ~412) | Validate the new fields; map them onto the submitted `fields`. |
| `app/api/book/intro/route.ts` (`sanitizeHsContext` 452–462; `buildFormFields` ~376; `IntroBody` 30–53) | Symmetric treatment for the adult-intro form. |
| `app/api/chatbot/lead/route.ts` (`ChatbotLeadBody` 22–39; `upsertContactByEmail` 115) | Extend the body type; write the new `court16_*` keys (no signature change — `upsertContactByEmail` already accepts an arbitrary property record). |

The cookie/URL reads belong in the **page-level submit handlers**, not in `components/TrialRequestForm.tsx` (which only collects child/parent fields).

---

## 11. Server-side GTM — defer, with eyes open

sGTM adds (a) server-set `HttpOnly` cookies that escape Safari's 7-day cap, and (b) server-to-server forwarding for Enhanced Conversions / Meta CAPI that survives ad blockers and consent gating.

**Recommendation: defer.** Two reasons it's not worth it for Court 16 yet:
- The 7-day Safari cap **doesn't bite this architecture** — you offload attribution to the HubSpot contact at submit (§8), so the cookie only needs to live minutes/hours.
- sGTM "durability" is **not automatic**: since Safari 16.4 (~April 2023) a server-set cookie only keeps its full TTL if the tagging server's IP prefix matches the site's. A CNAME to a cloud host fails silently and Safari re-caps it to 7 days. You'd pay for sGTM and still get capped unless you solve same-IP first-party serving (or Google Tag Gateway).

Revisit sGTM only when paid spend is high enough that recovering the last few percent of conversions pays for the cloud server + ongoing maintenance, and you're ready to solve the IP-matching prerequisite.

---

## 12. Dependencies & open questions for Court 16

| # | Item | Why it matters | Who |
|---|---|---|---|
| 1 | **Grant GA4 Admin/Viewer access** (separate from GTM). Confirm the GA4 Measurement ID, or create the property if none exists. | The audit found no GA4 in the page and only a dead UA tag. GA4 is the spine of the BigQuery join. GTM access alone does not include GA4 data access. | Anthony |
| 2 | **Confirm `app.court16.com` is the live booking domain/alias.** It didn't respond to an external request during the audit. | All cross-subdomain cookie logic assumes `app.court16.com`. If it's a different host, the cross-domain linker *is* needed. | Anthony / Cedarwind |
| 3 | **Confirm the consent/CMP setup on the Squarespace site.** Does the cookie banner actually gate the GTM tags? | Consent Mode v2 governs whether a stable `client_id` is even captured (§8). | Anthony |
| 4 | **Who runs the ads — in-house or agency? Grant Google Ads access** to `AW-955662958` (and Meta Business Manager when Meta phase starts). | Enhanced Conversions uploads need Ads API/Data Manager access; agency-run ads with no UTMs are the likeliest blocker. | Anthony |
| 5 | **Adopt the UTM + campaign-naming taxonomy** (proposal §9) on all live ad links going forward. | Without it, per-channel attribution degrades to date+geo. The cheapest, highest-leverage process fix. | Anthony / whoever builds campaigns |
| 6 | **Decide Meta priority.** No Pixel exists today; CAPI needs one installed first. | Determines whether Phase 3 is Google-only for now. | Anthony |
| 7 | **Plan the Data Manager API migration** for Google offline uploads (June 15 2026 cutoff). | The Ads API path is closing for new tokens. | Cedarwind |

---

## 13. Recommended next step

Phase 0 is hours of GTM/settings work and delivers an immediate win — it lights up HubSpot-native source attribution across the whole journey and confirms GA4 — with zero code. I'd suggest:

1. You confirm GA4 access (dep #1) and the `app.court16.com` alias (dep #2).
2. Cedarwind does Phase 0 (GA4 confirm + deploy HubSpot/GA4 on the booking app + remove the dead UA tag) and builds the Phase 1 capture tag + booking-app wiring.
3. Phase 2/3 fold into the Command Center build — the BigQuery export and the Enhanced-Conversions loopback are thin readers on top of the same MindBody revenue/membership work.

This turns "we can see opens and clicks" into "this campaign drove N members and $X — bid more here," with Google Ads optimizing on real revenue.

---

*Source grounding: live court16.com tag audit (2026-06-18); booking-app code (`lib/hubspot.ts`, `app/trial/page.tsx`, `app/api/book/{trial,intro}/route.ts`, `app/api/chatbot/lead/route.ts`, `config/locations.ts`, `config/hubspot-deals.ts`); `docs/court16-command-center-proposal.md` §3/§5/§9. External mechanics (GA4→BigQuery, Google Enhanced Conversions for Leads, Meta Conversions API, GTM/ITP) verified against current 2026 official Google/HubSpot/Meta documentation with an adversarial fact-check pass; items explicitly flagged "verify before publishing" in §8 were not confirmable against a primary source in this pass.*
