# Option C — Hybrid Family Account (recommended)

> Status: scaffold / starting point. Not implemented beyond Phase 1.
> Branch: `option-c-hybrid-family-account`, based on `fix/trial-child-shared-email` (PR #9 = Phase 1).
> Companion: Option B (full OAuth) on `option-b-oauth-family-account`.

## Goal

Keep the trial booking frictionless **now** (Phase 1, already shipped), and add a
true MindBody family account **only at membership conversion** (Phase 2), where a
parent login is justified anyway. Best-of-both: bank the marketing fix today,
defer the heavy OAuth build to the point where it actually matters.

## Background

MindBody API Support confirmed (support case 05463499, 2026-06-22) that a true
family account — shared email **and** payer, parent manages dependents — is only
reachable through the OAuth / MindBody Identity flow, not the server-to-server
Public API-key flow we use today. "Pays for" billing is not automatic via the
API; the payer must be set on each transaction.

## Phase 1 — now (DONE; this branch's base)

- Trial booking stays fully server-side and frictionless: `app/api/book/trial/route.ts`
  creates parent + child via `addClient`, child shares the parent's real email
  (with automatic placeholder fallback), linked via the `-6` Parent/Guardian
  relationship. No login required.
- Fixes the marketing/mailing-list problem (the child record carries the parent's
  reachable email). See PR #9.
- Per-site acceptance is observable via the `trial.child.emailPath` log line.
- **Nothing more to build in Phase 1.**

## Phase 2 — later, triggered at conversion to a paying member

1. Parent does an OAuth sign-in (same mechanics as Option B; justified at this stage).
2. Child becomes a true family member under the account (shared email + payer).
3. Existing trial records are linked into the account.

## Implementation tasks (Phase 2)

- [ ] OAuth authorization-code flow against MindBody Identity (shared design with Option B).
      Env scaffolding already present: `MINDBODY_CLIENT_ID/SECRET/OAUTH_SITE_ID/REDIRECT_URI`, `SESSION_SECRET`.
- [ ] "Set up your family account" entry point offered **at conversion / via post-trial
      follow-up** — explicitly NOT inside the trial signup path.
- [ ] Add-family-member via the Consumer/OAuth API using the parent token (depends on Q1).
- [ ] Link/merge existing `addClient` trial records into the OAuth account (depends on Q2;
      if a same-email login duplicates, add a merge step).
- [ ] Per-transaction payer ("pays for") on paid memberships (`app/api/staff/confirm/route.ts` purchase path).
- [ ] Tests + sandbox (`-99`) validation.

## Open dependencies (MindBody API team — case 05463499)

Critically **Q2**: does a later OAuth login with the same email **link** to the
existing trial record or **duplicate** it? This makes or breaks the clean hybrid.

1. Does "add family member" require the parent to interactively authenticate, or can it be done server-side with partner/OAuth credentials?
2. Same-email `addClient` record + later OAuth login → link or duplicate?
3. Exact request/field to set the payer on a checkout.
4. Separate Consumer-API / partner activation needed beyond the current key?

## Effort

Phase 1 = 0 (done). Phase 2 = similar scope to Option B, but deferrable, lower
volume, and decoupled from trial signup (smaller blast radius).

## Why recommended

Banks the marketing win immediately, protects trial conversion (no login at
signup), and confines OAuth friction to high-intent converters. Lets us scope the
OAuth build once the API team answers Q2.
