# Court 16 kids-trial rollout: access handoff

**Prepared:** July 17, 2026

**Audience:** Ibtissam, the Mindbody site owner/admin, and the HubSpot Super Admin

**Safety rule:** authorize the existing integrations; never send passwords, API keys, or bearer tokens. Share each short-lived activation link/code only with the intended site owner through an approved secure channel.

## What Cedarwind can access today

| System | Access that works | Access that is missing | Effect |
|---|---|---|---|
| Mindbody — Ridge Hill `5748154` | Staff/source token and the read-only configuration probes return `200` | No upcoming Program `61` trial occurrences were found in the 30-day window | The integration is authorized, but Ridge Hill still needs its trial schedule checked before a live request |
| Mindbody — six rollout sites | None of the site-specific reads; staff/source and consumer probes return `403` | Owner approval for each Site ID | The six clubs remain disabled; Cedarwind cannot discover or safely configure their Program, Service, relationship, or class IDs |
| HubSpot portal `4832170` | CRM Contact and Deal reads | CRM writes, Marketing Email, and Workflows report `REQUIRES_REAUTHORIZATION` | No email/workflow changes will be applied, published, or enabled until an admin reauthorizes the connector |

## Action 1 — authorize the six Mindbody sites

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

1. In the Mindbody Developer Portal, open **Account → Site activation**.
2. Enter one Site ID and generate its activation link/code.
3. Send the **activation link** to the owner/admin for that exact club. The link is preferred because the owner signs in directly; never send login credentials.

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

## Action 2 — reauthorize the HubSpot connector

The app provider must first request the required scopes. An admin cannot grant permissions the app does not ask for.

Minimum scopes for the current implementation and draft review:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.objects.deals.read`
- `crm.objects.deals.write`
- `marketing-email`
- `automation`

### HubSpot Super Admin

1. Open **Settings → Integrations → Connected Apps**.
2. Select the Cedarwind/Codex connector used for this project.
3. Under **App access and permissions → Available after Re-authentication**, choose **Re-authenticate**.
4. Approve with a Super Admin, or a user who has App Marketplace Access plus every requested permission.
5. Complete the OAuth return to the connector. Changing the app's settings without completing this flow does not update the existing tokens.

If the connection is a static-token app rather than OAuth, use its **Reinstall URL** after the requested scopes are updated.

### Cedarwind verifies, without publishing

1. Confirm the connector reports Contact/Deal read and write, Marketing Email, and Workflow access.
2. Perform one CRM read and one reversible draft/non-destructive write.
3. Re-open the draft email and workflow inventory; do not publish an email or turn on a workflow.
4. Keep the parent account-nudge workflow off until it has a trustworthy family-status suppression gate.

### HubSpot success check

The handoff is complete when Cedarwind can read the current assets and save a draft/off change, while the live workflows remain unchanged. Workflow access requires the applicable HubSpot Professional or Enterprise subscription. Workflow updates are full replacements, so the current action graph must be read and preserved before any update.

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
