# Court 16 kids-trial rollout: access handoff

**Prepared:** July 17, 2026

**Access status updated:** July 20, 2026

**Audience:** Ibtissam, the Mindbody site owner/admin, and the HubSpot Super Admin

**Safety rule:** authorize the existing integrations; never send passwords, API keys, or bearer tokens. Share each short-lived activation link/code only with the intended site owner through an approved secure channel.

## What Cedarwind can access today

| System | Access that works | Access that is missing | Effect |
|---|---|---|---|
| Mindbody — Ridge Hill `5748154` | Staff/source token and the read-only configuration probes return `200` | No upcoming Program `61` trial occurrences were found in the 30-day window | The integration is authorized, but Ridge Hill still needs its trial schedule checked before a live request |
| Mindbody — six rollout sites | All owners approved access; source-token issuance and all six configuration reads return `200` for every Site ID | Verified trial Program, Service price/applicability, schedule, staff write permissions, routing, and end-to-end acceptance | Discovery is unblocked, but all six clubs remain disabled until their individual launch gates pass |
| HubSpot portal `4832170` | CRM Contact/Deal read-write, Marketing Email, properties, and Workflows | No access blocker | The trusted family-status property and a new nudge workflow were saved; every Cedarwind workflow remains off |

## Action 1 — authorize the six Mindbody sites ✅ COMPLETED 2026-07-20

> All six owners approved their activation links; Cedarwind re-verified the
> same day (source token + all six reads `200` per site). The steps below are
> retained for reference and for any future site.

The existing Public API v6 key belongs to Cedarwind's developer application and can be reused. **Do not request or create six new API keys.** Mindbody access is approved separately for each business Site ID.

Repeat these steps for every row:

| Club | Site ID |
|---|---:|
| Allston | `5754600` |
| Downtown Brooklyn | `135479` |
| Fishtown | `5742169` |
| Long Island City | `985499` |
| Manhattan–FiDi | `5728093` |
| Newton | `5751422` |

### Cedarwind

1. Open the private, git-ignored activation handoff at `.private/mindbody-site-activation-links-2026-07-17.md`.
2. Send only the matching **activation link** to the owner/admin for that exact club through an approved secure channel. The link is preferred because the owner signs in directly; never send login credentials.
3. Do not paste the activation links or codes into GitHub, public handoff pages, HubSpot records, or ordinary group email.

### Court 16 owner/admin

1. Open the site-specific link and sign in with the owner account for that exact club.
2. Review and approve the Cedarwind integration.
3. If using a code instead, enter it at **Manager Tools → Mindbody Add Ons → API Integrations**.
4. Tell Cedarwind only that authorization is complete. Do not send a password or token.

### Cedarwind verifies

1. Confirm a green activation success and the Site ID under **Account → Site Permissions**.
2. Issue a fresh staff token for that Site ID. A Ridge Hill token is not treated as proof for another site.
3. Run the read-only audit:

   ```bash
   npm run audit:mindbody-sites
   ```

4. Record each site's own required fields, active gender options, Parent/Guardian and Pays For relationships, kids-trial Program, exact `$0` Service, location, and available trial classes. Never copy Ridge Hill IDs or profile options to another site.

### Mindbody success check

Authorization is complete only when the source token and these six reads return `200` for the exact Site ID:

- `GET /client/requiredclientfields`
- `GET /site/relationships`
- `GET /site/genders`
- `GET /site/programs`
- `GET /class/classes`
- `GET /sale/services`

This is a **read-only preflight**, not launch approval. Each club still needs its `$0` Service price/program/location applicability, Comp checkout, required fields, class capacity, native email settings, staff permissions, and a clean parent/child end-to-end test verified. The controlled write matrix must exercise every gender value offered by that club's public form; catalog presence alone is not treated as write proof.

For live booking, the staff identity also needs the permissions used by the chosen flow. In particular, staff-authenticated unpaid enrollment needs **Make Unpaid Reservation**. If the parent is passed as `PayerClientId`, the site must have the correct **Pays for** relationship before checkout.

## HubSpot access — resolved; review remains

The production private-app token now has the access required for this implementation. On July 17, 2026, Cedarwind verified Contact and Deal read-write access, inspected Marketing Email assets, updated the family-status property description, turned the three previously active Cedarwind workflows off, and saved a new family-status-gated nudge workflow as off.

Current review state:

- new off workflow `1853127851` waits 60 minutes, re-checks `court16_family_account_status`, and sends only when the value is still `parent_claim_pending`;
- legacy Deal shell `1820551993` remains off and unchanged;
- confirmation `1820575928`, denial `1820568681`, reminder `1820562947`, and staff notification `1835369220` are off;
- the older global form-triggered workflow `1735576602` is still live in the portal, so the application now skips that legacy form submission by default; and
- no contact/deal record values were changed during the access verification.

Ibtissam should review the email copy, timing, status contract, and recipient ownership before anyone turns on a Cedarwind workflow. Workflow updates are full replacements, so the current action graph must be read and preserved before any later edit.

## What Ibtissam receives after access

For each club, Cedarwind will return one evidence row containing:

- authorization result;
- exact Program ID and approved age bands;
- exact `$0` Service ID/name, price, Program, and location applicability;
- exact Parent/Guardian and Pays For relationship mapping;
- required intake fields;
- upcoming trial class/occurrence IDs and capacity evidence;
- HubSpot pipeline, Requested/Scheduled stages, exact `preferred_location`, and staff owner;
- Mindbody-versus-HubSpot email ownership; and
- parent Client ID, original child Client ID, Deal ID, enrollment/visit proof, email count, and family-account completion proof from the clean test.

Only after those checks pass will the club's `trialBookingEnabled` flag be proposed for activation.

## Official references

- Mindbody: [API keys](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/authentication/api-keys), [accessing business data](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/introduction/accessing-business-data-from-mindbody), [user tokens](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/authentication/user-tokens), and [owner API-integration setup](https://support.mindbodyonline.com/s/article/Setting-up-an-API-integration?language=en_US)
- HubSpot: [manage connected apps](https://knowledge.hubspot.com/integrations/manage-your-connected-apps), [OAuth](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth), and [scope reference](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes)
