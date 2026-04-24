# Court 16 — MindBody Happy-Path Test

A minimal Next.js 16 app that runs the four MindBody write calls that BLINK got wrong:

1. `GetClients` by email (so we never duplicate a record)
2. `AddClient` for the parent (only if no match)
3. `AddClient` for the child
4. `AddClientRelationship` linking parent → child (Guardian, RelationshipId 20)
5. `AddClientToClass` (optional, only if a ClassId is supplied)

Every write call ships with `Test=true` until you explicitly flip `MINDBODY_WRITE_MODE=live`. Every run gets a short correlation ID that is stamped into every log line and returned in the response, so a single happy-path execution is trivially traceable across the four calls.

This is **not** the Phase 3 app — it's a test harness designed to prove the one thing that broke the previous vendor's build. Once it runs end-to-end in the sandbox, we know the risk is de-risked.

---

## What you need before running

The ONE thing you may not have yet is a **MindBody developer API key**. The sandbox site ID and staff credentials are public; the API key is issued per developer.

1. Go to <https://developers.mindbodyonline.com/> → sign in → register a new developer account if you don't already have one.
2. Create an app → copy the `Api-Key`.
3. Activate your key against sandbox Site `-99` (free; no approval needed).

If you already have a production Court 16 Api-Key, that works too — but keep `MINDBODY_WRITE_MODE=test` and point `MINDBODY_SITE_ID` at `-99` until we're ready for a live dry-run against a real site.

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

## Deploy to Vercel

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
npx vercel env add MINDBODY_WRITE_MODE production         # test  (flip to live later)
npx vercel env add TEST_API_TOKEN production              # optional, recommended
npx vercel --prod
```

Or, via the Vercel dashboard: Import Git repo → Project Settings → Environment Variables → paste the six vars from `.env.example`.

**Recommended:** set `TEST_API_TOKEN` on the deployed instance so random people can't hit your endpoints. Leave it blank locally for convenience.

**Safety switch default:** `MINDBODY_WRITE_MODE=test`. Site `-99` is the MindBody public sandbox and is disposable — you can flip to `live` there without risk to any real Court 16 data. That's the only way to demonstrate the dedup branch via back-to-back same-email runs (in `test` mode, `AddClient` returns `Id: null` and doesn't persist, so the second run's `GetClients` comes back empty).

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

## The safety switch

`MINDBODY_WRITE_MODE` does exactly one thing: controls whether the client sends `Test=true` on every `Add*` call.

| Value  | Behavior                                                        |
|--------|-----------------------------------------------------------------|
| `test` | (default) Every write gets `Test=true`. Nothing is persisted.   |
| `live` | Writes are real. Flip only when we're ready for a live dry-run. |

To flip to live on Vercel: `npx vercel env add MINDBODY_WRITE_MODE production` and paste `live`. Redeploy.

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
- The `MINDBODY_WRITE_MODE` safety gate stays — in production it'll default to `live` but flip to `test` per-environment (staging is always `test`).

Once this harness successfully runs the full sequence twice in a row (second run proving the de-dup works), BLINK's failure mode is formally de-risked and we can greenlight the Phase 3 build.
