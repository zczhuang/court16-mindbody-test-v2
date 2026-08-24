# Court 16 — MindBody Happy-Path Test

> [!IMPORTANT]
> **AI-agent handoff (August 24, 2026):** the default `main` branch is a
> historical harness baseline. The current trial-product candidate is
> [`agent/family-account-handoff`](https://github.com/zczhuang/court16-mindbody-test-v2/tree/agent/family-account-handoff)
> at `ebdf254`, reviewed through draft
> [PR #12](https://github.com/zczhuang/court16-mindbody-test-v2/pull/12).
> Start new work from that branch, not from `main`.

## AI agent: start here

**Business objective:** make the path from family interest to an attended trial
dependable across all seven Court 16 clubs, with clear staff follow-up and no
duplicate or ambiguous bookings.

**Current status:** write-capable canonical candidate, not approved for release.
The August 7 production artifact was recorded from a dirty working tree. A clean
checkout of `ebdf254` must reproduce the intended behavior before merge or
redeploy.

```bash
git fetch origin agent/family-account-handoff
git switch --track origin/agent/family-account-handoff
npm install
npm run dev
```

Run the non-writing checks before proposing a change:

```bash
npm run typecheck
npm run build
npm run validate:trial-config
npm run test:trial-intake
npm run test:hubspot-deal-ledger
npm run test:mindbody-write-guard
```

Start with these files on the handoff branch:

- `app/trial/page.tsx` — family-facing trial journey.
- `app/api/book/trial/route.ts` — guarded trial intake and booking boundary.
- `app/api/staff/confirm/route.ts` — staff confirmation path.
- `lib/hubspot-deal-ledger.ts` — request-state source of truth.
- `lib/mindbody-write-guard.ts` — write authorization checks.
- `config/locations.ts` and `config/kids-trial-readiness.ts` — seven-club setup.
- `docs/multi-site-automation-audit.md` — operating and automation context.

**Non-negotiable boundary:** `MINDBODY_WRITE_MODE=test` is not a universal
kill switch. Some consumer-mode Mindbody calls reject or ignore the `Test`
flag and can persist on real Court 16 sites. Keep real-write gates and public
launch gates off. Never submit a live fixture, enable a HubSpot workflow, or
use customer data without an explicit approver, named test identity, cleanup
owner, result readback, and rollback plan.

**Next decision:** reconcile the clean branch against the deployed artifact,
review PR #12, then run the controlled seven-club acceptance matrix.

---

## Historical `main`-branch harness notes

The material below documents the original narrow Mindbody test harness. It is
retained for provenance and must not be treated as current release guidance.

A minimal Next.js 16 app that runs the four MindBody write calls that BLINK got wrong:

1. `GetClients` by email (so we never duplicate a record)
2. `AddClient` for the parent (only if no match)
3. `AddClient` for the child
4. `AddClientRelationship` linking parent → child (Guardian, RelationshipId 20)
5. `AddClientToClass` (optional, only if a ClassId is supplied)

The harness requests `Test=true` where the endpoint supports it. That flag is
not accepted consistently by consumer-mode create and booking endpoints, so a
real Court 16 site ID must always be treated as write-capable. Every run gets a
short correlation ID for traceability.

This is **not** the Phase 3 app — it's a test harness designed to prove the one thing that broke the previous vendor's build. Once it runs end-to-end in the sandbox, we know the risk is de-risked.

---

## What you need before running

The ONE thing you may not have yet is a **MindBody developer API key**. The sandbox site ID and staff credentials are public; the API key is issued per developer.

1. Go to <https://developers.mindbodyonline.com/> → sign in → register a new developer account if you don't already have one.
2. Create an app → copy the `Api-Key`.
3. Activate your key against sandbox Site `-99` (free; no approval needed).

Use sandbox site `-99` for this historical harness. Do not point the default
branch at a real Court 16 site or assume `MINDBODY_WRITE_MODE=test` prevents
persistent client or booking writes.

> HubSpot and Squarespace creds are **not** needed for this test. The happy path we scoped is MindBody-only. I'll flag this whenever we extend scope.

---

## Run locally

```bash
cd court16-mindbody-test
cp .env.example .env.local
# fill in MINDBODY_API_KEY; other defaults point at the -99 sandbox
npm install
npm run dev
```

Visit `http://localhost:3000`. Fill the form. Use an email you can send to (e.g. `stuart+run1@cedarwind.io`) so the second run tests the "already exists → skip AddClient" branch.

### Get a ClassId to test booking

```bash
curl "http://localhost:3000/api/mindbody/classes?limit=5"
```

Plug any `ClassId` into the form or the curl below.

---

## Historical deployment notes — do not run from this branch

Do not deploy this default branch as the current trial product. The commands
below are retained only to explain the original harness setup.

### One command (recommended)

```bash
bash scripts/deploy.sh
```

That script:
1. Runs `vercel login` if you aren't logged in (opens a browser, one-time)
2. Runs `vercel link` to create a new project on first run
3. Reads every var out of your `.env.local` and pushes it to Vercel production (idempotent — safe to re-run)
4. Deploys to production

Subsequent deploys: same command. It skips steps 1–2 if already done.

Other modes:
- `bash scripts/deploy.sh --env-only` — sync env vars but don't redeploy
- `bash scripts/deploy.sh --skip-env` — redeploy but leave env vars alone

### Manual (if you prefer)

```bash
npx vercel login
npx vercel link
npx vercel env add MINDBODY_API_KEY production
npx vercel env add MINDBODY_SITE_ID production            # -99
npx vercel env add MINDBODY_STAFF_USERNAME production     # mindbodysandboxsite@gmail.com
npx vercel env add MINDBODY_STAFF_PASSWORD production     # Apitest1234
npx vercel env add MINDBODY_WRITE_MODE production         # partial endpoint behavior; not a kill switch
npx vercel env add TEST_API_TOKEN production              # optional, recommended
npx vercel --prod
```

Or, via the Vercel dashboard: Import Git repo → Project Settings → Environment Variables → paste the six vars from `.env.example`.

**Recommended:** set `TEST_API_TOKEN` on the deployed instance so random people can't hit your endpoints. Leave it blank locally for convenience.

**Safety boundary:** use only sandbox site `-99` for these historical recipes.
The environment value controls whether supported endpoints receive `Test=true`;
it does not make a real Court 16 site safe.

---

## curl recipes

### Health check (no auth, no MindBody call)

```bash
curl https://YOUR-APP.vercel.app/api/health | jq
```

Expected:

```json
{
  "ok": true,
  "ts": "2026-04-18T19:12:03.411Z",
  "env": {
    "MINDBODY_API_KEY": true,
    "MINDBODY_SITE_ID": true,
    "MINDBODY_STAFF_USERNAME": true,
    "MINDBODY_STAFF_PASSWORD": true,
    "MINDBODY_BASE_URL": "(default)",
    "MINDBODY_WRITE_MODE": "(default: test)",
    "TEST_API_TOKEN": false
  }
}
```

### Happy path

```bash
curl -X POST https://YOUR-APP.vercel.app/api/mindbody/happy-path \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_API_TOKEN" \
  -d '{
    "parent": {
      "firstName": "Taylor",
      "lastName": "Parent",
      "email": "stuart+run1@cedarwind.io",
      "mobilePhone": "212-555-0123"
    },
    "child": {
      "firstName": "Avery",
      "lastName": "Kid",
      "birthDate": "2017-06-15"
    },
    "classId": 12345
  }' | jq
```

Expected (truncated):

```json
{
  "ok": true,
  "correlationId": "9f1c3a8e2b41",
  "writeMode": "test",
  "parentId": "...",
  "childId": "...",
  "trace": [
    { "step": "getClientsByEmail",        "status": "ok",      "data": { "matched": 0, "clients": [] } },
    { "step": "addClient (parent)",       "status": "ok",      "data": { "Id": "..." } },
    { "step": "addClient (child)",        "status": "ok",      "data": { "Id": "..." } },
    { "step": "addClientRelationship",    "status": "ok" },
    { "step": "addClientToClass",         "status": "ok" }
  ]
}
```

Run the same command a second time — you should see `getClientsByEmail.matched = 1` and `addClient (parent).status = "skipped"`. That's the BLINK fix.

### Just list upcoming classes

```bash
curl "https://YOUR-APP.vercel.app/api/mindbody/classes?limit=5" \
  -H "Authorization: Bearer $TEST_API_TOKEN" | jq
```

### Look up a client by email

```bash
curl "https://YOUR-APP.vercel.app/api/mindbody/get-clients?email=stuart+run1@cedarwind.io" \
  -H "Authorization: Bearer $TEST_API_TOKEN" | jq
```

---

## The historical mode flag

`MINDBODY_WRITE_MODE` controls whether the harness requests `Test=true` on
endpoints that support it. It is not a global write lock.

| Value  | Behavior                                                        |
|--------|-----------------------------------------------------------------|
| `test` | Requests `Test=true` where accepted; real-site consumer calls may still persist. |
| `live` | Requests persistent writes. Use only with explicit authorization. |

Do not change this value or redeploy without explicit authorization and a
named test/cleanup/readback plan.

Before flipping:
- Point at a real site ID (not `-99`)
- Use production staff credentials (not `Siteowner`)
- Run `get-clients` with a known-real email first to confirm auth
- Bake in a synthetic guardrail like sending writes only for emails matching `*+mbtest@*`

---

## Troubleshooting

- **`usertoken/issue failed` with 401** — Api-Key or Siteowner creds are wrong. Try the alternate sandbox login (`mindbodysandboxsite@gmail.com` / `Apitest1234`).
- **`AddClient` returns `duplicate` error on second run** — The `GetClients` branch didn't find the record. Check that `SearchText=<email>` is returning results. In the -99 sandbox, test emails from other developers sometimes collide.
- **`AddClientRelationship` fails with `invalid RelationshipId`** — Some sandbox sites don't seed RelationshipId 20. Post `GET /site/sites` or check the MindBody admin UI to find the "Guardian" relationship type and override `relationshipId` in the request body.
- **`AddClientToClass` returns `ClientServiceId required`** — The class requires a specific pricing option. Use the granular endpoint `/api/mindbody/add-to-class` and pass `ClientServiceId` explicitly. A future iteration of this harness should GetClientServices first.
- **Cold start slowness on Vercel** — First call issues a fresh `StaffUserToken`. Subsequent calls within ~50 minutes of warm-instance life reuse the cached token.

---

## Source layout

```
court16-mindbody-test/
├── app/
│   ├── api/
│   │   ├── health/route.ts              # GET  — env var presence check
│   │   └── mindbody/
│   │       ├── happy-path/route.ts      # POST — the full flow
│   │       ├── classes/route.ts         # GET  — list classes (helper)
│   │       ├── get-clients/route.ts     # GET  — search clients by email
│   │       ├── add-client/route.ts      # POST — create a client
│   │       ├── add-relationship/route.ts# POST — link parent → child
│   │       └── add-to-class/route.ts    # POST — book a client into a class
│   ├── layout.tsx
│   └── page.tsx                          # minimal UI
├── lib/
│   ├── logger.ts                         # correlation-ID-aware structured logger
│   └── mindbody.ts                       # typed client, token cache, Test=true gate
├── .env.example
├── next.config.ts
├── package.json
├── tsconfig.json
└── vercel.json
```

---

## How this maps to Phase 3

This test is the first slice of §6.3 "Account Provisioning" and §6.4 "Booking Execution" from [`Court16_Phase3_Ideal_State_PRD.md`](../Court16_Phase3_Ideal_State_PRD.md). When we build Phase 3 for real:

- `lib/mindbody.ts` gets pulled into a shared `packages/mindbody-adapter/` and grown to include GetClientServices, GetEnrollments, AddClientToEnrollment, and webhook handlers.
- The happy-path route becomes one of several orchestration flows (kids-trial, adult-intro, returning-member-drop-in).
- The correlation-ID log pattern carries forward as the basis for the "observability" requirements in §6.9.
- Treat `MINDBODY_WRITE_MODE` as an endpoint-mode request, not a safety gate;
  site authorization and the branch's explicit real-write guards control risk.

Once this harness successfully runs the full sequence twice in a row (second run proving the de-dup works), BLINK's failure mode is formally de-risked and we can greenlight the Phase 3 build.
