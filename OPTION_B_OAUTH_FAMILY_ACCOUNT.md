# Option B — Full OAuth Family-Account Re-architecture

> Status: scaffold / starting point. Not implemented.
> Branch: `option-b-oauth-family-account`, based on `main`.
> Companion: Option C (hybrid) on `option-c-hybrid-family-account`.

## Goal

Parent gets a real MindBody login (Identity/OAuth); the child is added as a true
family member under that account — shared email **and** payer — so the parent can
self-enroll kids in future programs. Replaces the current server-side
`addClient` + relationship-link approach for the family-account need.

## Why this path

MindBody API Support confirmed (support case 05463499, 2026-06-22) that a true
family account (shared email + payer, parent manages dependents) is only reachable
through the OAuth / MindBody Identity flow — not the server-to-server Public
API-key flow we use today. "Pays for" billing is not automatic via the API; the
payer must be set on each transaction.

## Current baseline (today)

- Trial booking is fully server-side: `app/api/book/trial/route.ts` creates parent +
  child via `addClient` (API key, consumer mode), links child→parent via the `-6`
  Parent/Guardian relationship. (The shared-email child fix lives on
  `fix/trial-child-shared-email` / PR #9 and is compatible but not required here.)
- OAuth scaffolding partially present: env keys `MINDBODY_CLIENT_ID`,
  `MINDBODY_CLIENT_SECRET`, `MINDBODY_OAUTH_SITE_ID`, `MINDBODY_REDIRECT_URI`, `SESSION_SECRET`.
- The parent never logs into MindBody today.

## Target flow

1. Parent fills the trial form (as today).
2. Parent is routed through MindBody OAuth/Identity → creates or logs into their
   MindBody account (email + password).
3. With the parent's consumer token, add the child as a family member under the
   account (shared email + payer).
4. Book the trial class for the child.
5. Staff confirm (longer-term: self-serve).

## Implementation tasks

- [ ] OAuth authorization-code flow against MindBody Identity (redirect, callback,
      token exchange, session persistence). Confirm env credentials + redirect URI are registered.
- [ ] Booking-flow UI: insert a "sign in / create your MindBody account" step;
      handle new vs returning parent.
- [ ] Add-family-member call via the Consumer/OAuth API using the parent token (depends on Q1).
- [ ] Per-transaction payer ("pays for") on paid-program checkouts (`app/api/staff/confirm/route.ts` purchase path).
- [ ] Dedup/migration for parents who already have `addClient`-created records (depends on Q2).
- [ ] Rework staff approve/deny flow given the account/family already exists.
- [ ] Tests + sandbox (`-99`) validation.

## Open dependencies (MindBody API team — case 05463499)

1. Does "add family member" require the parent to interactively authenticate, or can it be done server-side with partner/OAuth credentials?
2. Same-email `addClient` record + later OAuth login → link or duplicate?
3. Exact request/field to set the payer on a checkout.
4. Separate Consumer-API / partner activation needed beyond the current key?

## Effort

Large (~1.5–3 weeks), sensitive to the answers above. Main risk: a login step in
the trial flow adds friction to the highest-volume, lowest-intent action (trial signup).

## Relationship to Option C

Option C reuses all of this OAuth + family-add + payer work but triggers it only at
membership conversion (lower volume), keeping the trial frictionless. If Q1 is
"parent must do it in-app" and Q2 is "duplicates," prefer the hybrid (C) over full B.
