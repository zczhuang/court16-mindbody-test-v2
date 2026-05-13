// HubSpot client. Two responsibilities in Track 1:
//
//   1. SUBMIT the existing Court 16 trial form via Forms API v3 Integration
//      endpoint. The form is the authoritative entry point Ibtissam already
//      wired up — nurture sequences and lead routing attach to it. We reuse
//      it instead of rebuilding with a custom object.
//
//   2. Update + look up Contacts via the CRM v3 API for the staff
//      confirm/reassign flow (flipping `court16_booking_status` on the
//      contact, which triggers the staff/parent email workflows).
//
// No SDK — the surface is 4 functions of plain fetch.
//
// Form GUID + portal ID live in env vars (see .env.example). Field names
// and option values match what the form serves at
// https://share.hsforms.com/1PpZqxIcuSeybkx8RT6bTmw2vkiy — validated
// 2026-04-18. If Ibtissam edits the form, update lib/config.ts vocabularies.

import type { Logger } from "./logger";

export interface HubspotConfig {
  /** Private App token. Required only for CRM ops, not Forms submit. */
  accessToken?: string;
  portalId: string;
  trialFormGuid: string;
  /** CRM / schemas host. Default https://api.hubapi.com */
  apiBaseUrl: string;
  /** Forms submission host. Default https://api.hsforms.com */
  formsBaseUrl: string;
}

export function loadHubspotConfig(): HubspotConfig | null {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const portal = process.env.HUBSPOT_PORTAL_ID;
  const form = process.env.HUBSPOT_TRIAL_FORM_GUID;
  if (!portal || !form) {
    if (process.env.HUBSPOT_REQUIRED === "true") {
      throw new Error(
        "HubSpot required but HUBSPOT_PORTAL_ID / HUBSPOT_TRIAL_FORM_GUID not set",
      );
    }
    return null;
  }
  return {
    accessToken: token,
    portalId: portal,
    trialFormGuid: form,
    apiBaseUrl: process.env.HUBSPOT_API_BASE_URL ?? "https://api.hubapi.com",
    formsBaseUrl: process.env.HUBSPOT_FORMS_BASE_URL ?? "https://api.hsforms.com",
  };
}

/**
 * Throws a plain Error (not HubspotError) so callers can distinguish
 * "we never called HubSpot" from "HubSpot returned a real 401".
 */
function requireAccessToken(cfg: HubspotConfig): string {
  if (!cfg.accessToken) {
    throw new Error(
      "HUBSPOT_ACCESS_TOKEN not set — CRM reads/writes unavailable; form submit only",
    );
  }
  return cfg.accessToken;
}

export class HubspotError extends Error {
  status: number;
  body: unknown;
  constructor(msg: string, status: number, body: unknown) {
    super(msg);
    this.name = "HubspotError";
    this.status = status;
    this.body = body;
  }
  toJSON() {
    return { name: this.name, message: this.message, status: this.status, body: this.body };
  }
}

async function hsFetch<T>(
  log: Logger,
  opts: {
    url: string;
    method: "GET" | "POST" | "PATCH";
    headers?: Record<string, string>;
    body?: unknown;
    label: string;
  },
): Promise<T> {
  const started = Date.now();
  const res = await fetch(opts.url, {
    method: opts.method,
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  if (!res.ok) {
    log.error("hubspot.request.fail", { label: opts.label, status: res.status, ms, body: parsed });
    throw new HubspotError(`${opts.method} ${opts.label} → ${res.status}`, res.status, parsed);
  }
  log.info("hubspot.request.ok", { label: opts.label, ms });
  return parsed as T;
}

// ─── 1. Forms API — submit the existing trial form ──────────────────────────

export interface TrialFormFields {
  // Parent (standard contact properties)
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;

  // Form-required child 1 fields (internal names match the form)
  preferred_location: string;
  child_name: string;
  child_1___last_name: string;
  childage: string;
  child_date_of_birth__YYYY: string;
  child_date_of_birth__MM: string;
  child_date_of_birth__DD: string;
  child_1___playing_level: string;
  school: string;
  lead_source: string;

  // Form optional child 2
  child_2___first_name?: string;
  child_2___last_name?: string;
  child_age?: string;
  child_2___dob__cloned___YYYY?: string;
  child_2___dob__cloned___MM?: string;
  child_2___dob__cloned___DD?: string;
  child_2___playing_level?: string;
  child_2___school?: string;

  // Form-optional extras
  referrer?: string;
  any_question_just_let_us_know?: string;

  // Our Track 1 state-machine properties (set up by Ibtissam as Contact
  // custom properties per docs/hubspot-properties.md; the Forms API
  // accepts any contact property name even when not on the form UI).
  court16_correlation_id?: string;
  court16_intent?: "kid_trial" | "adult_intro";
  court16_booking_status?:
    | "pending_staff"
    | "pending_staff_assist"
    | "pending_payment"
    | "confirmed"
    | "failed"
    | "duplicate_email_softwall"
    | "manual_review";
  court16_class_id?: string;
  court16_location_slug?: string;
  court16_waiver_version?: string;
  court16_offer_key?: string;
  court16_mindbody_parent_id?: string;
  court16_mindbody_child_id?: string;
  court16_staff_confirm_url?: string;
  court16_staff_reassign_url?: string;
  court16_admin_retry_url?: string;
  court16_failure_reason?: string;
}

export interface SubmitTrialFormOptions {
  /** Optional HubSpot page context (pageUri, pageName, ipAddress) for attribution. */
  context?: { hutk?: string; pageUri?: string; pageName?: string; ipAddress?: string };
  /** LegalConsentOptions — GDPR consent text. Leave undefined for US traffic. */
  legalConsentOptions?: Record<string, unknown>;
}

/**
 * Submit the Court 16 trial form programmatically via v3 Integration API.
 * reCAPTCHA is enforced only on the embedded/share versions of the form,
 * not this server-to-server endpoint.
 */
export async function submitTrialForm(
  cfg: HubspotConfig,
  log: Logger,
  fields: TrialFormFields,
  opts?: SubmitTrialFormOptions,
): Promise<{ inlineMessage?: string }> {
  const url = `${cfg.formsBaseUrl}/submissions/v3/integration/submit/${cfg.portalId}/${cfg.trialFormGuid}`;
  const body: Record<string, unknown> = {
    fields: Object.entries(stripUndefined(fields as unknown as Record<string, unknown>)).map(
      ([name, value]) => ({ name, value }),
    ),
  };
  if (opts?.context) body.context = opts.context;
  if (opts?.legalConsentOptions) body.legalConsentOptions = opts.legalConsentOptions;

  return hsFetch<{ inlineMessage?: string }>(log, {
    url,
    method: "POST",
    label: `POST /submissions/v3/integration/submit/${cfg.portalId}/${cfg.trialFormGuid}`,
    body,
  });
}

// ─── 2. CRM v3 — Contact lookup + state update ──────────────────────────────

export interface ContactRecord {
  id: string;
  properties: Partial<TrialFormFields & { email: string }> & Record<string, string | undefined>;
}

/** Search Contacts by our correlation ID custom property. Returns the first match or null. */
export async function findContactByCorrelationId(
  cfg: HubspotConfig,
  log: Logger,
  correlationId: string,
): Promise<ContactRecord | null> {
  const res = await hsFetch<{ results: ContactRecord[] }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/contacts/search`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/contacts/search",
    body: {
      filterGroups: [
        {
          filters: [
            { propertyName: "court16_correlation_id", operator: "EQ", value: correlationId },
          ],
        },
      ],
      limit: 1,
      properties: [
        "email",
        "firstname",
        "lastname",
        "phone",
        "court16_correlation_id",
        "court16_intent",
        "court16_booking_status",
        "court16_class_id",
        "court16_location_slug",
        "court16_waiver_version",
        "court16_mindbody_parent_id",
        "court16_mindbody_child_id",
      ],
    },
  });
  return res.results[0] ?? null;
}

/** Look up a Contact by email (exact match). Returns the first match or null. */
export async function findContactByEmail(
  cfg: HubspotConfig,
  log: Logger,
  email: string,
): Promise<ContactRecord | null> {
  try {
    const res = await hsFetch<ContactRecord>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
      method: "GET",
      headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
      label: "GET /crm/v3/objects/contacts/:email",
    });
    return res;
  } catch (e) {
    if (e instanceof HubspotError && e.status === 404) return null;
    throw e;
  }
}

/** PATCH a Contact's properties by contact ID. Used by staff confirm/reassign. */
export async function updateContact(
  cfg: HubspotConfig,
  log: Logger,
  contactId: string,
  patch: Record<string, string | undefined>,
): Promise<{ id: string }> {
  const stripped = stripUndefined(patch as Record<string, unknown>);
  return hsFetch<{ id: string }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
    method: "PATCH",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "PATCH /crm/v3/objects/contacts/:id",
    body: { properties: stripped },
  });
}

// ─── 3. CRM v3 — Contact upsert + Deal creation for the Trials pipeline ─────

/**
 * Idempotent Contact upsert keyed on email. Returns the Contact ID
 * whether the row was newly created or already existed.
 *
 * Sits alongside the public Forms v3 submit path (which fires
 * Ibtissam's nurtures) and serves a second purpose: get a Contact ID
 * back synchronously so we can associate the Deal with the right
 * Contact, AND keep the court16_* property values in sync even when
 * the form endpoint is reCAPTCHA-blocked (which still happens until
 * Ibtissam toggles it off).
 */
export async function upsertContactByEmail(
  cfg: HubspotConfig,
  log: Logger,
  email: string,
  properties: Record<string, string | undefined>,
): Promise<{ id: string }> {
  const stripped = stripUndefined({ ...properties, email });
  const res = await hsFetch<{ results: { id: string }[] }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/contacts/batch/upsert`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/contacts/batch/upsert",
    body: { inputs: [{ idProperty: "email", id: email, properties: stripped }] },
  });
  if (!res.results[0]?.id) {
    throw new Error("HubSpot upsertContactByEmail: no id in response");
  }
  return { id: res.results[0].id };
}

interface CreateTrialDealArgs {
  contactId: string;
  correlationId: string;
  /** HubSpot pipeline ID (from config/hubspot-deals.ts). */
  pipelineId: string;
  /** Stage ID for "Requested Trial / Intro Offer" (from config/hubspot-deals.ts). */
  stageId: string;
  /** Display name shown in HubSpot's Deals UI. */
  dealName: string;
  /** USD amount — 0 for kid trials, offer.priceUsd for adult intros. */
  amount: number;
}

/**
 * Create a Deal in the location-specific trials pipeline and associate
 * it with an existing Contact. Idempotent: if a Deal with the same
 * `court16_correlation_id` already exists, returns its ID without
 * creating a duplicate.
 *
 * Returns null when the pipeline can't be resolved upstream — callers
 * should treat that as a soft-skip, not a booking failure.
 */
export async function createTrialDeal(
  cfg: HubspotConfig,
  log: Logger,
  args: CreateTrialDealArgs,
): Promise<{ id: string; cached: boolean }> {
  // 1. Idempotency check via unique custom property
  const existing = await hsFetch<{ results: { id: string }[] }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/search`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/deals/search",
    body: {
      filterGroups: [
        {
          filters: [
            { propertyName: "court16_correlation_id", operator: "EQ", value: args.correlationId },
          ],
        },
      ],
      limit: 1,
    },
  });
  if (existing.results[0]) {
    return { id: existing.results[0].id, cached: true };
  }

  // 2. Create Deal + Contact association in one call
  const deal = await hsFetch<{ id: string }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/deals",
    body: {
      properties: {
        dealname: args.dealName,
        amount: String(args.amount),
        pipeline: args.pipelineId,
        dealstage: args.stageId,
        court16_correlation_id: args.correlationId,
      },
      associations: [
        {
          to: { id: args.contactId },
          // Deal → Contact: HubSpot-defined association type ID 3
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        },
      ],
    },
  });
  return { id: deal.id, cached: false };
}

/** Find the Deal in the Trials pipeline by correlation ID. Returns null if missing. */
export async function findDealByCorrelationId(
  cfg: HubspotConfig,
  log: Logger,
  correlationId: string,
): Promise<{ id: string; properties: Record<string, string | undefined> } | null> {
  const res = await hsFetch<{
    results: Array<{ id: string; properties: Record<string, string | undefined> }>;
  }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/search`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/deals/search (by correlation)",
    body: {
      filterGroups: [
        {
          filters: [
            { propertyName: "court16_correlation_id", operator: "EQ", value: correlationId },
          ],
        },
      ],
      limit: 1,
      properties: ["dealname", "dealstage", "pipeline", "court16_correlation_id"],
    },
  });
  return res.results[0] ?? null;
}

/**
 * PATCH a Deal to move it to a different stage. Used by staff
 * confirm/reassign/deny + intro/confirm to advance the Trials Deal
 * through the pipeline.
 */
export async function moveDealStage(
  cfg: HubspotConfig,
  log: Logger,
  dealId: string,
  newStageId: string,
  extra?: Record<string, string | undefined>,
): Promise<{ id: string }> {
  const stripped = stripUndefined({ dealstage: newStageId, ...(extra ?? {}) } as Record<string, unknown>);
  return hsFetch<{ id: string }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
    method: "PATCH",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "PATCH /crm/v3/objects/deals/:id",
    body: { properties: stripped },
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function stripUndefined(o: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}
