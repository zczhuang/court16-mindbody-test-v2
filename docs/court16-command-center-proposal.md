# Court 16 Marketing Command Center — Proposal

**Prepared for:** Anthony, Marketing — Court 16
**Prepared by:** Stuart / Cedarwind
**Date:** May 31, 2026

---

## 1. Executive summary

Court 16 runs marketing across three systems that don't talk to each other. **HubSpot** captures leads, sends campaigns, and tracks email opens/clicks. **MindBody** is where the money actually happens — trial bookings, attendance, first purchases, memberships, and recurring revenue across all 6 clubs. **Ad spend** (Meta and Google) lives only inside the ad platforms; none of it is connected anywhere.

The result: you can see how many people opened an email, but **not whether that campaign produced a single signed-up member or a single dollar.** The campaign console we already built for you (live at court16-campaigns.vercel.app) makes this concrete — it shows email engagement beautifully, but it has zero connection to MindBody revenue. The one question marketing exists to answer — *"what's working, where do I double down, where do I cut?"* — cannot be answered today with money attached.

**What we propose:** join HubSpot + MindBody (+ ad spend) into one source of truth, keyed to **club × campaign × customer-lifecycle × date**, and put a decision-grade command center on top of it. The headline outcome for you:

> One screen that says, in dollars: *"Ridge Hill paid-social drove 14 new members at $140 each against a $210 blended average — shift budget here. The Chelsea Google brand campaign is losing money — pause it."*

We are deliberately right-sizing this for a 6-club SMB, not an enterprise. The plan starts with the cheapest tool that produces the answer, proves value in 2–3 weeks, and only adds infrastructure when it earns its place. The first and highest-value deliverable — wiring MindBody revenue to leads and trials so you can finally see signups and dollars per club — does **not** require a full data-warehouse build to ship.

---

## 2. What Court 16 has today — the honest baseline

| System | What it does today | The gap |
|---|---|---|
| **HubSpot** (portal 4832170, STANDARD tier, ~134K contacts) | Trial-form lead capture (Forms API), Contacts CRM, 6 location-specific deal pipelines, marketing emails + campaigns, nurture workflows. Hardened API client already built in the booking app. | No revenue. Contacts are **not club-tagged** (lifecycle counts are portal-wide). STANDARD tier means multi-touch *revenue* attribution is Enterprise-gated — not available to you. |
| **MindBody** (6 sites, all IDs confirmed) | System of record for clients, bookings, visits, memberships, and **all revenue**. The booking app reads clients/classes and writes one $0 trial sale. | The app **reads zero revenue, visits, or membership data** today. No historical sales/attendance/contract data is extracted by any code. This is the single biggest gap. |
| **court16-campaigns** (LIVE) | Next.js/Vercel + Upstash Redis. Campaign calendar, approval workflow, Google OAuth + RBAC, HubSpot campaign/email-engagement sync, and a transparent double-down/investigate/cut recommendations engine. | Recommendations run on **email opens/clicks and form leads only** — no revenue, no spend, no trials/enrollments. It is a document store (KV), not a warehouse: it cannot do SQL joins, and it has **no MindBody connection of any kind**. |
| **Ad spend** (Meta, Google) | Presumed running. | **Not connected anywhere.** Not even a data field exists. Spend in the console is a manual number someone types in. |

**Three corrections to common assumptions, verified in the code, that shape this plan:**

1. **All 6 MindBody Site IDs are confirmed**, scraped from court16.com/login on 2026-04-18 with documented per-club provenance (`config/locations.ts`). This is **not** an open blocker. The real footprint is: **Brooklyn (135479), LIC (985499), FiDi (5728093), Ridge Hill / Yonkers (5748154), Fishtown / Philadelphia (5742169), Newton / MA (5751422)**.
2. **The club list in our original brief was wrong.** It listed Ridgehill/Chelsea/Tribeca/LIC/Rockville Centre/Scarsdale. The live code footprint is **Brooklyn / LIC / FiDi / Ridge Hill / Fishtown / Newton**. We build against the code — but **please confirm this is your current 6-club footprint** before go-live (see §8).
3. **The campaign console never had revenue/spend fields that got "stubbed."** Those concepts simply don't exist in its data model. The attribution gap is real and complete: there is no `attribution.ts`, no revenue join, no spend feed.

The one hard cross-system join key that exists today: MindBody `Client.Id` is mirrored onto HubSpot as `court16_mindbody_parent_id` / `court16_mindbody_child_id` at booking time — but **only for app-driven trial bookings**, not walk-ins, phone leads, or legacy members. Email is the practical secondary key.

---

## 3. Target architecture

### 3.1 Build recommendation: start lean, graduate deliberately

There are two valid architectures here. The research and the pragmatism review converge on a clear sequencing: **build the cheapest thing that answers the question now, graduate to the fuller warehouse only when ad spend makes it a genuine multi-source join.**

| Phase | Stack | Monthly cost | Trigger |
|---|---|---|---|
| **Lean (Phase 1)** | Managed Postgres (Neon/Supabase free tier) **or** BigQuery + a scheduled TypeScript sync script reusing the existing `lib/mindbody.ts` / `lib/hubspot.ts` clients + SQL views + Looker Studio | **$0–5** | Now |
| **Full (Phase 2+)** | dlt → **BigQuery** (raw) → dbt-core → marts → command center; **Google Ads via free first-party BigQuery Data Transfer**, Meta via dlt/OWOX | **$5–30** | When ad spend connects |
| **Avoid (any phase)** | Fivetran / Airbyte Cloud, Cloud Composer, dbt Cloud production tier | $300–1,000+ | Never, at this scale |

**Why this sequencing.** The entire dataset is tiny in warehouse terms: ~134K HubSpot contacts and low tens of thousands of MindBody rows per club per year. The campaign console's *entire* persisted state is a 265 KB file. With just HubSpot + MindBody, you are joining two tables — Postgres + SQL views does that perfectly and costs nothing to run or maintain. The medallion warehouse (dlt + dbt + BigQuery) is the **correct destination**, but its real value — multi-source modeling discipline, Google's free ad-data transfer, columnar scans — only matters once you're unioning Google + Meta + offline spend + HubSpot + MindBody. **Don't build a warehouse to hold two tables; build it when there are six sources.**

Because BigQuery is where this lands, the data model below is specified in BigQuery terms. If Phase 1 uses Postgres, the same schema maps 1:1 (drop the partition/cluster clauses; the table shapes are identical). We recommend BigQuery from day one **only if** you want to avoid a migration later and are comfortable with the small extra setup (service account, byte caps) — both paths are defensible. Our default recommendation: **BigQuery from the start**, because the migration tax later is real and the setup cost is a few hours once.

### 3.2 Data-flow diagram

```
  SOURCES                         INGEST                    WAREHOUSE (BigQuery)              READ LAYER
  ───────                         ──────                    ────────────────────             ──────────

  HubSpot CRM ───────────┐
  (contacts, deals,      │   dlt HubSpot source ──────►  raw_hubspot ─┐
   forms, campaigns,     │                                            │
   email stats)          │                               raw_mindbody ┤   dbt-core
                         │   custom MindBody extractor                │   ┌──────────┐
  MindBody (6 sites) ────┤   (reuse lib/mindbody.ts:    raw_ads ──────┤   │ staging  │ views
  (clients, sales,       │    token cache + SiteId                    │   │   ↓      │
   visits, contracts) ───┘    fan-out, all 6 sites)                   │   │intermed. │ identity
                                                                      ├──►│   ↓      │ resolution
  Google Ads ────────────────  BigQuery Data Transfer ───────────────┤   │  core    │ dims+facts
                               Service (FREE, first-party)            │   │   ↓      │
  Meta Ads ──────────────────  dlt facebook_ads / OWOX (free) ────────┤   │  marts   │ wide tables
                                                                      │   └────┬─────┘
  Offline/promo spend ───────  manual Google Sheet → BQ external tbl ─┘        │
                                                                               ▼
                                                          mart_marketing_performance
                                                          (date × club × channel × campaign)
                                                                               │
                                                ┌──────────────────────────────┴───────────────┐
                                                ▼                                                ▼
                                  court16-campaigns "Performance" tab            Looker Studio "Detailed Explorer"
                                  (scorecard + double-down/cut cards)            (free, ad-hoc slicing)
                                  reads marts server-side, caches in Upstash
```

Orchestration: one nightly job (`python pipeline.py && dbt build`) on **GitHub Actions cron** or Cloud Scheduler → Cloud Run — mirroring the existing console metrics-sync cron. Nightly batch is sufficient for a marketing command center; no streaming, no Airflow.

### 3.3 The data model

Medallion layout, one BigQuery dataset per layer: `raw_hubspot`, `raw_mindbody`, `raw_ads` (landing) → `staging` (typed views) → `intermediate` (identity resolution, funnel stitching) → `core` (conformed dims + facts) → `marts` (wide tables the command center reads). Materialization: staging/intermediate as **views** (no storage); `core.fct_*` as **incremental tables** partitioned by date, clustered by `club_id`; dims as small full-refresh tables; marts as partitioned tables. Dashboards read **only marts**, never raw events.

**Dimensions (`core`):**

- `dim_date` — date spine with a `same_period_ly` column for YoY deltas (tennis/pickleball is seasonal).
- `dim_club` — **6 rows, the canonical crosswalk.** Seeded from `config/locations.ts`. This is the single place every system's club label reconciles: canonical slug ↔ MindBody Site ID ↔ HubSpot pipeline ID ↔ the portal-baked `preferred_location` dropdown string ↔ IANA timezone.
- `dim_channel` — conformed channel taxonomy (`paid_search`, `paid_social`, `email`, `referral`, `print`, `event`, `direct`, `unattributed`). A seed CSV maps HubSpot's 8 `lead_source` self-report values and UTM `utm_medium` onto these.
- `dim_campaign` — union of HubSpot campaigns + ad-platform campaigns, keyed by the UTM taxonomy token (§9) so all systems reconcile on one string.
- `dim_person` — **the identity-resolved hub everything joins to** (see §3.4).

**Facts (`core`), grain stated explicitly:**

| Fact table | Grain | Source | Funnel stage |
|---|---|---|---|
| `fct_lead` | 1 row / HubSpot form submission | HubSpot | Lead |
| `fct_trial` | 1 row / MindBody trial visit (booked + attended flags) | MindBody `/client/clientvisits` | Trial booked → attended |
| `fct_revenue` | 1 row / MindBody sale line item | MindBody `/sale/sales` | First purchase + all revenue |
| `fct_membership_month` | 1 row / active member / club / month | MindBody `/client/clientcontracts` | Active member, MRR & churn spine |
| `fct_email_engagement` | 1 row / (email asset × club × date) | HubSpot (reuse console pulls) | Owned-channel touch |
| `fct_ad_spend` | 1 row / (date × club × platform × campaign) | Google Ads DTS, Meta, offline sheet | Impression / click (net-new) |

### 3.4 Identity resolution — the spine

Everything joins to a hashed surrogate `person_sk`. Resolution is a **deterministic waterfall** — never silent auto-merge on a fuzzy hit (false-merging two real members is reputationally costly for a premium brand):

- **Tier 1 (confidence 1.0):** the hard key — MindBody `Client.Id` == HubSpot `court16_mindbody_parent_id`/`child_id`.
- **Tier 2a (0.95):** normalized email (`LOWER(TRIM(...))`).
- **Tier 2b (0.80):** E.164 phone (`+1`, strip non-digits, drop leading 1, reject <10 digits).
- **Tier 3 (review only):** fuzzy name+club+DOB → **human-review queue, never auto-merged.** Deferred entirely in Phase 1.

The MindBody anchor is **`Client.UniqueId`** (cross-site), not the per-site `Client.Id`, so a member who visits two clubs collapses to **one** `person_sk` with `home_club` + `clubs_visited[]` — otherwise member counts and LTV double-count. A `person_xref` bridge holds the 1-to-many fan-out (one person → N MindBody Client.Ids + 1 HubSpot id). Survivorship: **MindBody is system of record for name/DOB/revenue/contract; HubSpot is system of record for marketing consent/lifecycle/source.** Source lineage is kept so any merge is auditable and reversible.

### 3.5 The one wide mart

**`mart_marketing_performance`** — grain **`date × club_id × channel_id × campaign_sk`**. The single table the scorecard, drill-downs, and recommendations engine read. Spend, funnel counts, and revenue are pre-aggregated; CAC/ROAS/conversion are derived columns. MER and blended CAC are computed at *rollup* time (never summed per-channel — that double-counts). Partitioned by `date`, clustered by `club_id, channel_id`.

### 3.6 Representative DDL

```sql
-- core.dim_club  (6 rows, the canonical crosswalk — seeded from config/locations.ts)
CREATE TABLE `court16-warehouse.core.dim_club` (
  club_id                          STRING NOT NULL,  -- canonical slug: ridgehill, lic, ...
  club_name                        STRING,           -- "Ridge Hill, Yonkers"
  mindbody_site_id                 INT64,            -- 5748154  (join key → MindBody facts)
  hubspot_pipeline_id              STRING,           -- "830977386" (join key → deals)
  hubspot_preferred_location_label STRING,           -- "Ridge Hill - Yonkers" (portal dropdown)
  city STRING, state STRING, postal_code STRING,
  timezone                         STRING,           -- IANA; apply to MindBody wall-clock times
  kid_trial_program_id             INT64,            -- 61 for ridgehill, NULL elsewhere
  is_active                        BOOL
);

-- core.fct_revenue  (grain: one MindBody sale line item)
CREATE TABLE `court16-warehouse.core.fct_revenue` (
  sale_line_sk      STRING NOT NULL,
  person_sk         STRING,            -- → dim_person (via RecipientClientId → person_xref)
  club_id           STRING,            -- from site_id
  sale_id           STRING,
  sale_at_utc       TIMESTAMP,         -- site-tz converted
  sale_date         DATE,              -- partition key
  product_name      STRING,
  product_category  STRING,            -- derived: membership / class_pack / trial / camp / retail
  quantity          INT64,
  amount_usd        NUMERIC,
  is_first_purchase BOOL,
  loaded_at         TIMESTAMP
)
PARTITION BY sale_date
CLUSTER BY club_id, person_sk
OPTIONS (require_partition_filter = TRUE);   -- forces date pruning, caps query cost
```

The core attribution join — *how a lead becomes attributed revenue* — runs through `dim_person` as the hub: **HubSpot contact → person_sk (hard key, else email/phone) → MindBody Client.Id(s) via person_xref → sales/visits/contracts.** Campaign attaches via the lead's UTM token (first-touch); spend attaches by matching that same `utm_campaign` + date + club. Where UTM is absent (today), `channel_id` falls back to the `lead_source` self-report — attribution **degrades gracefully to channel level, never breaks.** The 7-stage funnel is encoded as timestamp/flag columns on a person+cohort grain, so every conversion rate is a `COUNT/COUNT` and every retention curve a `GROUP BY cohort_month`.

---

## 4. The command center

### 4.1 Build recommendation: extend the Next.js app, link Looker Studio as a free companion

**Verdict: build the scorecard + recommendation cards as a "Performance" area inside the existing `court16-campaigns` app, reading pre-aggregated BigQuery marts; add a free Looker Studio board as a linked "Detailed Explorer."**

- **Why the custom tab and not pure Looker Studio:** the value you're paying for is the **decision layer** — "pause Chelsea Google, shift to Ridge Hill paid-social" tied to a *named campaign Anthony can then edit and approve in the same login.* That already lives in `court16-campaigns` (recommendations engine, campaign records, HubSpot linking, Google OAuth + RBAC, nightly cron). A generic BI tool renders tiles but cannot render an *action tied to a workflow.* One app = one login, one RBAC model, one cron.
- **Why Looker Studio still earns a place (free):** it's the native BigQuery BI tool, zero-ops, pixel-rich, perfect for the ad-hoc slicing you'll inevitably want ("LIC kids camps, Q2, by week"). Building a free-form explorer in React would over-engineer a 6-club shop. So: **custom tab = scorecard + actions; Looker Studio = "Open detailed explorer."** Shared to the same Google identities the app already uses.
- **Pragmatic Phase-1 note:** if we go the lean Postgres path first, the Phase-1 scorecard can be a **Looker Studio board alone** (it has a native Postgres connector), and we add the custom Performance tab in Phase 2 — because the *only* thing it adds over Looker Studio is the recommendation-action layer, which needs spend/ROAS to be fully useful anyway.

**Explicitly rejected:** Metabase Cloud (~$85/mo Starter — only if you later want saved questions + Slack/email alerts beyond Looker Studio); Lightdash/Evidence.dev (add ops for a solo vendor); Cloud Composer (~$300–500/mo budget trap). Confirm all third-party pricing at vendor sites before we commit a number.

### 4.2 Screens

```
TIER 1 — EXEC SCORECARD  (1 screen, no scroll)
  9 KPI tiles · 1 trend chart · "Top 3 actions this week" card
  controls: date range · club filter · compare mode (vs prior period + vs same period last year)
        │ click a tile / breakdown            │ click an action card
        ▼                                       ▼
TIER 2a BY CLUB   TIER 2b BY CHANNEL   TIER 2c FUNNEL (7-stage waterfall + cohort retention)
        │ click a club / channel / stage
        ▼
TIER 3 — BY CAMPAIGN (diagnostic): full attribution chain, campaign → spend → leads → trials
  → attended → members → revenue → ROAS/CAC, sortable, verdict per row, deep-links to HubSpot/MindBody
```

### 4.3 The exec scorecard — 9 tiles

Every tile: big number · period-over-period delta · year-over-year delta · 12-week sparkline · tooltip with definition + source + freshness · "low confidence" badge when sample is below the volume floor.

1. **Marketing Spend** (blended, all channels)
2. **Leads / Trials Booked**
3. **Trials Showed** (MindBody `SignedIn=true`)
4. **New Members**
5. **New-Member Revenue + MRR Added**
6. **Blended CAC** = total spend ÷ new members
7. **Trial → Member %**
8. **MER (blended ROAS)** = total revenue ÷ total ad spend
9. **Member Retention / Churn**

**Lead with MER, not per-channel ROAS.** Meta and Google each *claim* overlapping conversions on their own attribution windows, so summed per-channel ROAS double-counts and inflates. MER = total revenue ÷ total spend can't be gamed and needs **zero attribution model** — it's computable the day MindBody revenue lands plus one hand-entered spend number. Per-channel ROAS lives on the Tier-2 drill-down, labeled **directional**.

Trend chart: New Members (bars) + Spend (line) + Revenue (faint line) over 12 weeks — one glance answers "are we spending more and getting more?"

### 4.4 The "double down / cut" logic

We **evolve** the existing transparent recommendations engine (deterministic, no LLM, every call cites its numbers) from email-only to money-aware. New output is a structured `Recommendation { scope, entity, verdict, metrics{spend,revenue,roas,mer,cac,trialToMember,sampleSize}, reason, confidence, rank }`. Thresholds are **named, tunable config constants** — auditability is the selling point.

- **DOUBLE DOWN** when *all* hold: ROAS ≥ target (≥3:1, validate against Court 16 actuals) **AND** CAC < blended CAC **AND** Trial→Member% > portfolio median **AND** volume above floor (min spend + min trials).
  → *"Ridge Hill paid-social: $4.2k spend → $18.6k member revenue (4.4× ROAS), CAC $140 vs $210 blended, 46% trial→member vs 33% median. Shift budget here."*
- **CUT / PAUSE** when *any* holds with material spend: ROAS < 1× (losing money) **OR** CAC > LTV/3 (violates 3:1 LTV:CAC) **OR** bottom-quartile Trial→Member% with spend above floor.
  → *"Chelsea Google brand: $1.9k spend, 0.6× ROAS, CAC $480 vs $210 blended. Pause and reallocate."*
- **INVESTIGATE** when signals conflict: good ROAS but broken trial→member conversion, or high spend with low volume, or one club lagging peers on the *same* campaign.
  → *"Tribeca camp campaign: strong 3.8× ROAS but only 19% trial→member vs 41% network — audit the front-desk trial-to-signup handoff."*

**Ranking** drives "Top 3 this week" by dollar impact × confidence, so Anthony sees the biggest levers first. **Small-sample safety** is critical at 6-club scale: volume floors, a confidence flag (low-confidence recs never enter Top 3), and trailing 4-week windows — mirroring the existing engine's guards, now money-aware.

**Phase-1 degraded mode (before ad spend):** ROAS cells render *"connect ad accounts,"* never a fake number. The engine still runs on **MER + Trial→Member% + blended CAC** (blended CAC needs only total spend from the manual sheet + new members — available day one), plus the existing email diagnostics unchanged.

### 4.5 Access

Reuse the app's Google OAuth + RBAC: **viewers/copywriters** see the scorecard + drill-downs (read-only); **approvers** also get recommendation action buttons (e.g. "create a campaign to double down here" hands off into the existing approval workflow); **admin** tunes thresholds. Anthony is admin/approver; club managers and leadership are viewers. Recommendation-driven actions flow through the existing `Activity` audit log.

---

## 5. Metrics catalog

| Metric | Definition / formula | Grain | Sources needed | Phase |
|---|---|---|---|---|
| **Marketing Spend** | Σ spend across Google + Meta + offline | date × club | Ad platforms + offline sheet | P1 (manual) → P2 (auto) |
| **Leads** | COUNT of HubSpot form submissions | date × club | HubSpot | P1 |
| **Trials Booked** | COUNT of MindBody trial visits with future start | date × club | MindBody | P1 |
| **Trials Showed** | COUNT of MindBody trial visits, `SignedIn=true`, not late-cancel/no-show | date × club | MindBody | P1 |
| **New Members** | COUNT DISTINCT persons who started a contract/autopay in period | month × club | MindBody | P1 |
| **New-Member Revenue** | Σ first-purchase sale amounts | date × club | MindBody | P1 |
| **MRR** | Σ active recurring contract monthly value at month-end | month × club | MindBody | P1 |
| **Blended CAC** | total marketing spend ÷ new members | month × club | Spend + MindBody | P1 |
| **MER (blended ROAS)** | total revenue ÷ total marketing spend | month × club | Spend + MindBody | P1 |
| **Trial → Member %** | members who started as trial ÷ attended trials | cohort-month × club | MindBody | P1 |
| **Monthly Churn** | members lost in month ÷ active members at month start | month × club | MindBody | P1 |
| **Retention** | 1 − monthly churn; + 90-day retained % | month × club | MindBody | P1 |
| **LTV (membership)** | avg monthly margin × (1 ÷ monthly churn rate) | cohort × club | MindBody | P1 |
| **Payback (months)** | CAC ÷ monthly margin per member | month × club | Spend + MindBody | P1 |
| **Cost per Lead / Trial** | spend ÷ leads (or attended trials) | date × club × channel | Spend + HubSpot/MindBody | P2 |
| **Per-channel ROAS** | attributed revenue ÷ channel spend (directional only) | date × club × channel | Spend + UTM + attribution | P2 |
| **Per-channel CAC** | channel spend ÷ members attributed to channel | month × club × channel | Spend + UTM + attribution | P2 |

**Honest constraint:** per-channel ROAS and per-channel CAC are **not computable today** and won't be until (a) `gclid`/`fbclid`/UTM are persisted on contacts at form submit, and (b) an ad-spend feed exists. Day-one truth metrics are **MER + blended CAC + trial→member%** — none of which need per-click attribution. Seed every threshold/target from Court 16's *own* MindBody historicals; external benchmarks (LTV:CAC ~3:1, fitness trial-to-member ~30–50%, gym churn ~25–50%/yr) are sanity rails only, labeled as such.

---

## 6. Phased roadmap

### Phase 1 — "Dollars per club, from data we already have" (~2–3 weeks)

The goal: give Anthony the trial→enrollment→revenue answer the console can't produce today, using only HubSpot + MindBody. No ad spend required.

- **MindBody read-side extractor** (the genuinely net-new engineering): typed wrappers for `GET /sale/sales`, `/client/clientvisits`, `/client/clientcontracts` per SiteId, reusing the existing token-cache / SiteId-fan-out / pagination scaffolding in `lib/mindbody.ts`. All 6 site IDs are present, so all 6 clubs are queryable on day one. Nightly date-windowed incremental pull, paced for the ~2,000 calls/site/day limit (initial historical backfill chunked).
- **Deterministic identity join only** — email + the existing hard MindBody-id key. No fuzzy matching, no human-review queue (deferred).
- **Funnel/cohort table** (person × month) → SQL views producing trial→member %, new members, new-member revenue, MRR, churn — all sliceable by the 6 clubs.
- **Day-one north-star metrics: MER + blended CAC** (need only revenue + one hand-entered total-spend number), plus trial→member %.
- **Read-only scorecard** (Looker Studio on the lean path, or the Performance tab if BigQuery from the start): ~8 tiles + per-club drill-down, shared to existing Google identities.
- **Manual spend Google Sheet** loaded as an external table — unblocks Spend/CAC/MER immediately.

*Outcome: the brief's critical gap closed at the blended level. "We can see opens/clicks" becomes "this club drove N members and $X at what cost."*

### Phase 2 — Ad spend + per-channel attribution (~3–4 weeks, gated on ad access + UTM discipline)

- **Add a hidden `gclid`/`fbclid`/`utm_*` capture block to the trial form now** (near-zero engineering — `submitTrialForm` already accepts arbitrary fields). Highest-leverage data-quality investment before any ad API connects.
- **Google Ads → BigQuery** via the **free first-party Data Transfer Service** (transfer is free; cost stays inside BigQuery's permanent 10 GB / 1 TB free tier). Remember cost is in **micros — divide by 1e6**.
- **Meta Ads** via dlt's `facebook_ads` source or OWOX (both free), on Cloud Run + Cloud Scheduler. If maintenance burden is too high for a solo vendor through Meta's ~yearly API version bumps, **Windsor.ai (~$19–99/mo managed)** is the cheaper choice in time-vs-dollars — do **not** use Google's native DTS Facebook connector (paid slot-hours since Sept 25, 2025), and do **not** use Fivetran.
- **`fct_ad_spend`** + `dim_geo_club` seed (ZIP/DMA → club) for geo-targeted campaigns without a clean UTM.
- **Light up Tier 2b (by channel), Tier 2c stages 1–2, Tier 3 (by campaign)**; upgrade the recommendations engine to full ROAS/per-channel-CAC rules with dollar-impact ranking.
- If on the lean Postgres path, **this is when we graduate to BigQuery + dbt** — the multi-source join now justifies it.

### Phase 3 — Polish & automation (~2 weeks, ongoing)

- Fuzzy Tier-3 identity matching + human-review queue (only once duplicate drift is observed).
- MindBody client-**merge** webhook consumption (until then, nightly re-resolution is good enough).
- Cohort retention curves, LTV by cohort, payback dashboards.
- BigQuery cost guardrails: `maximum_bytes_billed` cap, partition-expiry on raw tables, a $50/mo budget alert tripwire.
- PII column-policy tags on email/phone/DOB; honor HubSpot consent before any reverse-ETL activation.
- Optional intraday spend sync if Anthony wants live pacing.

**Effort honesty:** Phase 1 is genuinely 2–3 weeks because the API clients already exist. Phase 2 is gated more by *access and UTM discipline* than by engineering — if ads are agency-run with no UTMs, historical spend is only attributable to date+geo no matter how good the warehouse is. Phase 3 is incremental and demand-driven.

---

## 7. Cost

| Component | Lean path (P1) | Full path (P2+) | Notes |
|---|---|---|---|
| **Warehouse** | Neon/Supabase free tier **or** BigQuery free tier | BigQuery on-demand | < 10 GB storage, < 1 TB scans/mo → effectively inside the permanent free tier (10 GB + 1 TB/mo) |
| **Ingestion** | TS sync script on existing cron / GitHub Actions | dlt (free) + GitHub Actions/Cloud Run; **Google Ads DTS free**; Meta dlt/OWOX free | Compute = a few dollars or free |
| **Meta connector (optional managed)** | — | Windsor.ai ~$19–99/mo | Only if not self-maintaining dlt/OWOX |
| **BI** | Looker Studio (free) | Looker Studio (free) + custom Performance tab (in existing app) | Metabase ~$85/mo only if alerts/saved-questions wanted later |
| **Orchestration** | existing Vercel/GitHub cron | GitHub Actions cron or Cloud Scheduler→Cloud Run | **Not** Cloud Composer (~$300–500/mo) |
| **Total monthly run-cost** | **~$0–5** | **~$5–30** (or +$19–99 if managed Meta) | — |
| **Explicitly avoided** | — | Fivetran/Airbyte Cloud ($300–700+), Composer ($300–500+), dbt Cloud prod | Neither Fivetran nor Airbyte even has a MindBody connector — you'd build the revenue half by hand anyway |

All dollar figures are estimates from vendor pages that move; **reconfirm at the cited URLs before quoting Court 16 a committed number.** The two well-sourced facts: Google Ads first-party DTS transfer is free, and BigQuery's 10 GB/1 TB free tier is permanent and almost certainly covers Court 16 entirely. This run-cost excludes Cedarwind build/maintenance time, which is the larger line item and the real reason to keep the stack small.

---

## 8. Dependencies & open questions for Court 16

| # | Item | Why it matters | Who |
|---|---|---|---|
| 1 | **Confirm the 6-club footprint.** Code says Brooklyn / LIC / FiDi / Ridge Hill / Fishtown / Newton. Our brief said Ridgehill/Chelsea/Tribeca/LIC/Rockville/Scarsdale. | `dim_club` and every per-club metric depend on the correct list. We build against the code; please confirm it's current. | Anthony |
| 2 | **Are the 6 MindBody sites linked under one business?** Site IDs are confirmed; this is **not** open. But cross-site `UniqueId` stability is. | If sites are independent, cross-club identity falls back to email/phone (lower confidence) and per-person cross-club LTV can't be promised. | Anthony / MindBody |
| 3 | **Replicate the kid-trial setup at the other 5 clubs.** Only Ridge Hill has Program 61 + the $0 service wired. | Cross-club *trial* attribution depends on each site having a trial program/service. Operational, not just an API call. | Ibtissam / Anthony |
| 4 | **Who runs the ads — in-house or agency? Grant read/analyst access** to Meta Business Manager (ad-account ID) + Google Ads (Customer ID / MCC). | Agency-run ads with no UTMs are the likeliest real blocker. Surface now, not after building a pipe. Frame as read-only to lower approval friction. | Anthony |
| 5 | **HubSpot tier confirmation (STANDARD).** | Multi-touch *revenue* attribution is Enterprise-only — we compute it in the warehouse instead. Don't budget for a HubSpot upsell. | Anthony |
| 6 | **Adopt the UTM + campaign-naming taxonomy** (§9) on all live ad links going forward. | Without it, per-channel attribution silently degrades to date+geo. This is process, not pipeline — the cheapest highest-leverage fix. | Anthony / whoever builds campaigns |
| 7 | **Confirm the live HubSpot trial-form GUID** (env-driven `HUBSPOT_TRIAL_FORM_GUID`). | Pulling form submissions against the wrong GUID returns nothing. | Cedarwind / Anthony |
| 8 | **Who owns ongoing maintenance?** | dlt/dbt-core are self-maintained OSS; Meta's API version-bumps ~yearly will break a hand-rolled source. Decide self-maintain (free) vs Windsor (~$19–99/mo) as a time-vs-dollar tradeoff. | Cedarwind + Anthony |
| 9 | **Confirm MindBody API entitlement** (Owner-level credential per site, any per-call/monthly fees). | The read-side extractor pulls 6 sites of clients/sales/visits/contracts. | Anthony / MindBody |

---

## 9. Appendix — UTM + campaign-naming taxonomy

Lock a **6-field, lowercase, hyphen/underscore-delimited** campaign name and mirror it in UTMs. One string (`utm_campaign`) becomes the single join key across ad platforms, HubSpot, and the warehouse.

**Pattern:** `{club}_{audience}_{objective}_{channel}_{offer}_{yyyymm}`

**Constrained tokens:**
- `club` ∈ { **brooklyn, lic, fidi, ridgehill, fishtown, newton** } or `all` (the confirmed canonical slugs — reconcile per dependency #1 before locking)
- `audience` ∈ { adult, kids, junior, family, brand }
- `objective` ∈ { trial, membership, camp, event, awareness, retarget }
- `channel` ∈ { paidsocial, paidsearch, email, referral, print }
- `offer` = short slug (freeclass, summercamp, openhouse, na)
- `yyyymm` = launch month

**Examples:**
- `ridgehill_adult_trial_paidsocial_freeclass_202606`
- `lic_kids_camp_paidsearch_summercamp_202606`
- `all_brand_awareness_paidsocial_na_202606`

**UTM mapping:**

| Parameter | Value |
|---|---|
| `utm_source` | `facebook` \| `instagram` \| `google` \| `email` \| `referral` \| `print` |
| `utm_medium` | `paid_social` \| `paid_search` \| `email` \| `referral` \| `print` (→ maps to `dim_channel`) |
| `utm_campaign` | the full campaign name above (**the single join key**) |
| `utm_content` | creative / ad-set variant |
| `utm_term` | keyword (paid search only) |

**Offline/promo spend** uses the *same* schema in a shared Google Sheet (date or month, `club_id` [canonical slug], channel ∈ {print, event, referral, other}, `campaign_name` in the same taxonomy, `spend_usd`, notes) — e.g. `scarsdale_family_event_print_openhouse_202606` — so the command center reflects **total** marketing investment, not just digital. Anthony already owns these numbers; it's a monthly process, not an integration.

Deliverable to Anthony: a one-page cheat-sheet plus a fill-in UTM builder (a simple form or a Sheet with formula-built URLs). Always reserve an explicit **`direct-unattributed`** bucket — UTM discipline decays (organic shares, staffer manual links, vendor auto-links), so attribution is never presented as 100% complete.

---

**Recommended next step:** a 45-minute kickoff to confirm dependencies #1–#5 and #9, after which Cedarwind builds the Phase-1 MindBody revenue extractor and the blended-metrics scorecard — putting "dollars per club" in front of you in 2–3 weeks, before a single ad account is connected.

---

Key source files (absolute paths): `/Users/stuartchuang/vibe coding projects/Court16/Court16 Signups/court16-mindbody-test/config/locations.ts` (6 confirmed Site IDs + timezones, seeds `dim_club`), `/Users/stuartchuang/vibe coding projects/Court16/Court16 Signups/court16-mindbody-test/config/hubspot-deals.ts` (6 pipeline IDs + `preferred_location` crosswalk), `/Users/stuartchuang/vibe coding projects/Court16/Court16 Signups/court16-mindbody-test/lib/mindbody.ts` (token/SiteId fan-out to reuse for the read-side extractor; `MindbodyClient.UniqueId`), `/Users/stuartchuang/vibe coding projects/Court16/Court16 Signups/court16-mindbody-test/lib/hubspot.ts` (`court16_mindbody_*_id` hard join key + `court16_correlation_id` booking spine), `/Users/stuartchuang/vibe coding projects/Court16/Court16 Signups/court16-campaigns/lib/recommendations.ts` (engine to evolve), `/Users/stuartchuang/vibe coding projects/Court16/Court16 Signups/court16-campaigns/lib/metrics-sync.ts` (email-only sync confirming the gap).
