// HubSpot client. Two responsibilities in Track 1:
//
//   1. OPTIONALLY submit the legacy Court 16 trial form via Forms API v3.
//      The new booking path must leave this disabled because that form event
//      enrolls old account-creation and Deal-creation workflows in addition
//      to the app's own CRM upsert + Deal write.
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
import {
  HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES,
  assertExistingTrialDealMatches,
} from "./hubspot-deal-ledger.ts";

export interface HubspotConfig {
  /** Private App token. Required only for CRM ops, not Forms submit. */
  accessToken?: string;
  portalId: string;
  trialFormGuid: string;
  /** CRM / schemas host. Default https://api.hubapi.com */
  apiBaseUrl: string;
  /** Forms submission host. Default https://api.hsforms.com */
  formsBaseUrl: string;
  /** Explicit compatibility switch for the old form-triggered workflows. */
  submitLegacyTrialForm: boolean;
}

export function loadHubspotConfig(): HubspotConfig | null {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const portal = process.env.HUBSPOT_PORTAL_ID;
  const form = process.env.HUBSPOT_TRIAL_FORM_GUID;
  const submitLegacyTrialForm = process.env.HUBSPOT_SUBMIT_LEGACY_TRIAL_FORM === "true";
  if (!portal || (submitLegacyTrialForm && !form)) {
    if (process.env.HUBSPOT_REQUIRED === "true") {
      throw new Error(
        "HubSpot required but HUBSPOT_PORTAL_ID or the enabled legacy form GUID is not set",
      );
    }
    return null;
  }
  if (process.env.HUBSPOT_REQUIRED === "true" && !token) {
    throw new Error("HubSpot required but HUBSPOT_ACCESS_TOKEN is not set");
  }
  return {
    accessToken: token,
    portalId: portal,
    trialFormGuid: form ?? "",
    apiBaseUrl: process.env.HUBSPOT_API_BASE_URL ?? "https://api.hubapi.com",
    formsBaseUrl: process.env.HUBSPOT_FORMS_BASE_URL ?? "https://api.hsforms.com",
    submitLegacyTrialForm,
  };
}

/**
 * Throws a plain Error (not HubspotError) so callers can distinguish
 * "we never called HubSpot" from "HubSpot returned a real 401".
 */
function requireAccessToken(cfg: HubspotConfig): string {
  if (!cfg.accessToken) {
    throw new Error(
      "HUBSPOT_ACCESS_TOKEN not set — CRM reads/writes unavailable; only explicitly enabled legacy form submission can run",
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
  /** Single `YYYY-MM-DD` date string. HubSpot form rejects the 3-part split
   * (`child_date_of_birth__YYYY/MM/DD`) with "Required field is missing"; the
   * form field's internal name is the un-suffixed `child_date_of_birth`. */
  child_date_of_birth: string;
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

  // Our Track 1 state-machine properties. The direct Contact upsert is the
  // primary writer; the optional legacy Forms API accepts these names too.
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
  /**
   * Human-readable class metadata mirrored to the Contact record so staff
   * can read the class slot in HubSpot without cross-referencing
   * court16_class_id in MindBody. Added May 22 after smoke #M3 surfaced
   * that staff only saw "court16_class_id: 15673" without name/time/coach.
   * Companion Contact properties live in the court16_booking group on
   * portal 4832170 (created via /crm/v3/properties/contacts).
   */
  court16_class_name?: string;
  court16_class_day_time?: string;
  court16_coach_name?: string;
  court16_location_full?: string;
  court16_waiver_version?: string;
  court16_offer_key?: string;
  court16_mindbody_parent_id?: string;
  court16_mindbody_child_id?: string;
  court16_family_account_status?:
    | "parent_claim_pending"
    | "parent_claimed"
    | "child_link_pending"
    | "family_complete"
    | "manual_review";
  court16_staff_confirm_url?: string;
  court16_staff_reassign_url?: string;
  court16_staff_deny_url?: string;
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

const BOOKING_CONTACT_PROPERTY_NAMES = [
  "email",
  "firstname",
  "lastname",
  "phone",
  "court16_correlation_id",
  "court16_intent",
  "court16_booking_status",
  "court16_failure_reason",
  "court16_class_id",
  "court16_location_slug",
  "court16_class_name",
  "court16_class_day_time",
  "court16_coach_name",
  "court16_location_full",
  "court16_waiver_version",
  "court16_mindbody_parent_id",
  "court16_mindbody_child_id",
  "court16_family_account_status",
] as const;

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
      properties: BOOKING_CONTACT_PROPERTY_NAMES,
    },
  });
  return res.results[0] ?? null;
}

/** Fetch one Contact by its numeric HubSpot ID. */
export async function getContactById(
  cfg: HubspotConfig,
  log: Logger,
  contactId: string,
): Promise<ContactRecord | null> {
  const properties = BOOKING_CONTACT_PROPERTY_NAMES.map(encodeURIComponent).join(",");
  try {
    return await hsFetch<ContactRecord>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=${properties}`,
      method: "GET",
      headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
      label: "GET /crm/v3/objects/contacts/:id",
    });
  } catch (e) {
    if (e instanceof HubspotError && e.status === 404) return null;
    throw e;
  }
}

/** Look up a Contact by email (exact match). Returns the first match or null. */
export async function findContactByEmail(
  cfg: HubspotConfig,
  log: Logger,
  email: string,
  /** Extra properties to include beyond HubSpot's defaults (e.g. the stored MindBody ids). */
  properties?: string[],
): Promise<ContactRecord | null> {
  const props = properties?.length ? `&properties=${properties.map(encodeURIComponent).join(",")}` : "";
  try {
    const res = await hsFetch<ContactRecord>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email${props}`,
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
 * This is the primary intake path: it gets a Contact ID synchronously so we
 * can associate the Deal with the right Contact and keep the court16_*
 * property values in sync. The separate legacy Forms v3 event is disabled by
 * default because it also enrolls obsolete account-creation and duplicate
 * Deal workflows.
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

export interface CreateTrialDealArgs {
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
  /**
   * ISO 8601 datetime when the class starts (from MindBody's StartDateTime).
   * Drives workflow 3 (24h reminder)'s date-based delay. Optional — Deal
   * still creates without it, but workflow 3 won't fire on that Deal.
   */
  classStartsAt?: string;
  /** Deal-scoped booking ledger properties. Undefined values are omitted. */
  dealProperties?: Record<string, string | number | undefined>;
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
): Promise<{ id: string; cached: boolean; existing?: DealRecord }> {
  const usesBookingLedger = Boolean(args.dealProperties?.court16_booking_ledger_version);
  const activeParentKey = String(args.dealProperties?.court16_active_parent_key ?? "").trim();
  // 1. Build the complete Deal payload. HubSpot's `class_date`
  //    is a `datetime` property type — internally stored as a long (epoch ms
  //    UTC). ISO string is rejected with INVALID_LONG (caught by smoke #2).
  //    Convert to ms before sending; skip if the slot didn't parse cleanly.
  const properties: Record<string, string> = {
    ...stripUndefined(args.dealProperties ?? {}),
    dealname: args.dealName,
    amount: String(args.amount),
    pipeline: args.pipelineId,
    dealstage: args.stageId,
    court16_correlation_id: args.correlationId,
    ...(usesBookingLedger ? { court16_booking_key: args.correlationId } : {}),
  };
  if (args.classStartsAt) {
    const ms = Date.parse(args.classStartsAt);
    if (!Number.isNaN(ms)) {
      properties.class_date = String(ms);
    } else {
      log.warn("hubspot.createTrialDeal.class_date.unparseable", {
        classStartsAt: args.classStartsAt,
      });
    }
  }

  // 2. The ledger's booking key is a HubSpot unique-ID property, so read it
  //    directly. CRM search is eventually consistent and can miss a Deal that
  //    was just created; direct object lookup is the authoritative replay path.
  const deal = usesBookingLedger
    ? await getDealByBookingKey(cfg, log, args.correlationId)
    : await findLegacyDealByCorrelationId(cfg, log, args.correlationId);
  if (deal) {
    assertExistingTrialDealMatches(deal, args, properties);
    return { id: deal.id, cached: true, existing: deal };
  }
  if (usesBookingLedger && activeParentKey) {
    const activeDeal = await getDealByActiveParentKey(cfg, log, activeParentKey);
    if (activeDeal) {
      if (activeDeal.properties.court16_booking_key === args.correlationId) {
        assertExistingTrialDealMatches(activeDeal, args, properties);
        return { id: activeDeal.id, cached: true, existing: activeDeal };
      }
      throw new HubspotActiveBookingConflictError(activeDeal);
    }
  }

  // 3. Create Deal + Contact association in one call.
  try {
    const deal = await hsFetch<{ id: string }>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/deals`,
      method: "POST",
      headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
      label: "POST /crm/v3/objects/deals",
      body: {
        properties,
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
  } catch (e) {
    // `court16_booking_key` is unique for ledger v1. Concurrent search/create
    // attempts can race; on a uniqueness conflict, fetch and validate the
    // winner. Never PATCH the create payload onto it: that could regress a
    // scheduled Deal to Requested or overwrite immutable booking coordinates.
    if (e instanceof HubspotError && e.status === 409) {
      if (usesBookingLedger) {
        // HubSpot can return the uniqueness conflict before the winning object
        // is readable. Retry only this post-conflict read, with a small bound;
        // normal GET failures and non-conflict create failures are not retried.
        for (const delayMs of [0, 100, 300]) {
          if (delayMs > 0) await delay(delayMs);
          const winner = await getDealByBookingKey(cfg, log, args.correlationId);
          if (winner) {
            assertExistingTrialDealMatches(winner, args, properties);
            return { id: winner.id, cached: true, existing: winner };
          }
          if (activeParentKey) {
            const activeDeal = await getDealByActiveParentKey(cfg, log, activeParentKey);
            if (activeDeal) {
              if (activeDeal.properties.court16_booking_key === args.correlationId) {
                assertExistingTrialDealMatches(activeDeal, args, properties);
                return { id: activeDeal.id, cached: true, existing: activeDeal };
              }
              throw new HubspotActiveBookingConflictError(activeDeal);
            }
          }
        }
      } else {
        const winner = await findLegacyDealByCorrelationId(cfg, log, args.correlationId);
        if (winner) {
          assertExistingTrialDealMatches(winner, args, properties);
          return { id: winner.id, cached: true, existing: winner };
        }
      }
    }
    throw e;
  }
}

export interface DealRecord {
  id: string;
  properties: Record<string, string | undefined>;
  associatedContactIds: string[];
}

export class HubspotActiveBookingConflictError extends Error {
  existingDeal: DealRecord;

  constructor(existingDeal: DealRecord) {
    super("Another active HubSpot booking Deal exists for this parent");
    this.name = "HubspotActiveBookingConflictError";
    this.existingDeal = existingDeal;
  }
}

const STANDARD_DEAL_PROPERTY_NAMES = [
  "dealname",
  "dealstage",
  "pipeline",
  "class_date",
  "denial_reason",
  "denial_note",
] as const;

function dealPropertyQuery(includeBookingLedger: boolean): string {
  return [
    ...new Set([
      ...STANDARD_DEAL_PROPERTY_NAMES,
      ...(includeBookingLedger
        ? HUBSPOT_BOOKING_DEAL_PROPERTY_NAMES
        : (["court16_correlation_id"] as const)),
    ]),
  ]
    .map(encodeURIComponent)
    .join(",");
}

interface HubspotDealResponse {
  id: string;
  properties: Record<string, string | undefined>;
  associations?: { contacts?: { results?: Array<{ id: string }> } };
}

function toDealRecord(deal: HubspotDealResponse): DealRecord {
  return {
    id: deal.id,
    properties: deal.properties,
    associatedContactIds: deal.associations?.contacts?.results?.map((contact) => contact.id) ?? [],
  };
}

/** Fetch a Deal plus its Contact associations by HubSpot ID. */
export async function getDealById(
  cfg: HubspotConfig,
  log: Logger,
  dealId: string,
  options: { includeBookingLedger?: boolean } = {},
): Promise<DealRecord | null> {
  const includeBookingLedger =
    options.includeBookingLedger ?? process.env.HUBSPOT_DEAL_LEDGER_ENABLED === "true";
  const properties = dealPropertyQuery(includeBookingLedger);
  try {
    const deal = await hsFetch<HubspotDealResponse>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${properties}&associations=contacts`,
      method: "GET",
      headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
      label: "GET /crm/v3/objects/deals/:id",
    });
    return toDealRecord(deal);
  } catch (e) {
    if (e instanceof HubspotError && e.status === 404) return null;
    throw e;
  }
}

/** Read a booking-ledger Deal by its unique `court16_booking_key`. */
export async function getDealByBookingKey(
  cfg: HubspotConfig,
  log: Logger,
  bookingKey: string,
): Promise<DealRecord | null> {
  const properties = dealPropertyQuery(true);
  try {
    const deal = await hsFetch<HubspotDealResponse>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/${encodeURIComponent(bookingKey)}?idProperty=court16_booking_key&properties=${properties}&associations=contacts`,
      method: "GET",
      headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
      label: "GET /crm/v3/objects/deals/:bookingKey",
    });
    return toDealRecord(deal);
  } catch (e) {
    if (e instanceof HubspotError && e.status === 404) return null;
    throw e;
  }
}

/** Read the Deal currently holding a parent's unique active-booking fence. */
export async function getDealByActiveParentKey(
  cfg: HubspotConfig,
  log: Logger,
  activeParentKey: string,
): Promise<DealRecord | null> {
  const properties = dealPropertyQuery(true);
  try {
    const deal = await hsFetch<HubspotDealResponse>(log, {
      url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/${encodeURIComponent(activeParentKey)}?idProperty=court16_active_parent_key&properties=${properties}&associations=contacts`,
      method: "GET",
      headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
      label: "GET /crm/v3/objects/deals/:activeParentKey",
    });
    return toDealRecord(deal);
  } catch (e) {
    if (e instanceof HubspotError && e.status === 404) return null;
    throw e;
  }
}

async function findLegacyDealByCorrelationId(
  cfg: HubspotConfig,
  log: Logger,
  correlationId: string,
): Promise<DealRecord | null> {
  const res = await hsFetch<{ results: Array<{ id: string }> }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/search`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/deals/search (legacy correlation)",
    body: {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "court16_correlation_id",
              operator: "EQ",
              value: correlationId,
            },
          ],
        },
      ],
      limit: 1,
    },
  });
  const id = res.results[0]?.id;
  return id ? getDealById(cfg, log, id, { includeBookingLedger: false }) : null;
}

/** Find the Deal in the Trials pipeline by correlation ID. Returns null if missing. */
export async function findDealByCorrelationId(
  cfg: HubspotConfig,
  log: Logger,
  correlationId: string,
  options: { includeBookingLedger?: boolean } = {},
): Promise<DealRecord | null> {
  if (!options.includeBookingLedger) {
    return findLegacyDealByCorrelationId(cfg, log, correlationId);
  }
  const ledgerDeal = await getDealByBookingKey(cfg, log, correlationId);
  if (ledgerDeal) return ledgerDeal;
  if (process.env.HUBSPOT_LEGACY_CONTACT_BOOKING_FALLBACK_ENABLED !== "true") {
    return null;
  }
  return findLegacyDealByCorrelationId(cfg, log, correlationId);
}

export const ACTIVE_BOOKING_DEAL_STATUSES = [
  "intake_started",
  "pending_staff",
  "pending_staff_assist",
  "pending_payment",
  "duplicate_email_softwall",
  "manual_review",
] as const;

export interface ActiveBookingDealRecord {
  id: string;
  properties: Record<string, string | undefined>;
}

/**
 * Find active booking-ledger Deals for a parent, excluding the current Deal.
 * The caller must fail closed when this throws: malformed/truncated search
 * results are not safe evidence that no other request exists.
 */
export async function findOtherActiveBookingDealsByParentEmail(
  cfg: HubspotConfig,
  log: Logger,
  parentEmail: string,
  excludeDealId: string,
): Promise<ActiveBookingDealRecord[]> {
  const normalizedEmail = parentEmail.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("HubSpot active booking guard: parent email is empty");

  const response = await hsFetch<unknown>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/search`,
    method: "POST",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "POST /crm/v3/objects/deals/search (active parent bookings)",
    body: {
      filterGroups: [
        {
          filters: [
            { propertyName: "court16_booking_ledger_version", operator: "EQ", value: "1" },
            { propertyName: "court16_parent_email", operator: "EQ", value: normalizedEmail },
            {
              propertyName: "court16_booking_status",
              operator: "IN",
              values: ACTIVE_BOOKING_DEAL_STATUSES,
            },
          ],
        },
      ],
      properties: [
        "court16_booking_ledger_version",
        "court16_booking_key",
        "court16_booking_status",
        "court16_parent_email",
        "court16_location_slug",
        "court16_mindbody_site_id",
        "court16_family_provisioning_status",
      ],
      limit: 200,
    },
  });

  if (!response || typeof response !== "object") {
    throw new Error("HubSpot active booking guard: malformed search response");
  }
  const raw = response as {
    total?: unknown;
    results?: unknown;
    paging?: unknown;
  };
  if (!Number.isSafeInteger(raw.total) || (raw.total as number) < 0 || !Array.isArray(raw.results)) {
    throw new Error("HubSpot active booking guard: missing total or results");
  }
  if (raw.paging || raw.total !== raw.results.length) {
    throw new Error("HubSpot active booking guard: paginated or truncated search result");
  }

  const activeStatuses = new Set<string>(ACTIVE_BOOKING_DEAL_STATUSES);
  const ids = new Set<string>();
  const matches: ActiveBookingDealRecord[] = [];
  for (const candidate of raw.results) {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("HubSpot active booking guard: malformed Deal result");
    }
    const result = candidate as { id?: unknown; properties?: unknown };
    if (typeof result.id !== "string" || !result.id.trim() || ids.has(result.id)) {
      throw new Error("HubSpot active booking guard: missing or duplicate Deal ID");
    }
    ids.add(result.id);
    if (!result.properties || typeof result.properties !== "object") {
      throw new Error("HubSpot active booking guard: missing Deal properties");
    }
    const properties = result.properties as Record<string, unknown>;
    const bookingKey = properties.court16_booking_key;
    const bookingStatus = properties.court16_booking_status;
    const resultEmail = properties.court16_parent_email;
    if (
      properties.court16_booking_ledger_version !== "1" ||
      typeof bookingKey !== "string" ||
      !bookingKey.trim() ||
      typeof bookingStatus !== "string" ||
      !activeStatuses.has(bookingStatus) ||
      typeof resultEmail !== "string" ||
      resultEmail.trim().toLowerCase() !== normalizedEmail
    ) {
      throw new Error("HubSpot active booking guard: Deal does not match the requested fence");
    }
    if (result.id === excludeDealId) continue;
    matches.push({
      id: result.id,
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          typeof value === "string" ? value : undefined,
        ]),
      ),
    });
  }
  return matches;
}

/** PATCH arbitrary Deal properties without changing its pipeline stage. */
export async function updateDealProperties(
  cfg: HubspotConfig,
  log: Logger,
  dealId: string,
  patch: Record<string, string | number | undefined>,
): Promise<{ id: string }> {
  const stripped = stripUndefined(patch as Record<string, unknown>);
  return hsFetch<{ id: string }>(log, {
    url: `${cfg.apiBaseUrl}/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
    method: "PATCH",
    headers: { Authorization: `Bearer ${requireAccessToken(cfg)}` },
    label: "PATCH /crm/v3/objects/deals/:id",
    body: { properties: stripped },
  });
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
  return updateDealProperties(cfg, log, dealId, { dealstage: newStageId, ...(extra ?? {}) });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
