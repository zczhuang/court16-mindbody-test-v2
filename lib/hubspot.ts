// HubSpot Private App client. Minimal fetch wrapper — no SDK.
//
// Two responsibilities in Track 1:
//   1. Upsert Contact records (CRM of record for the person)
//   2. CRUD on a custom object `court16_booking` (state machine for each
//      booking request). Workflows in HubSpot pick up status transitions and
//      send every email — staff notifications, parent confirmations, nurture.
//
// All functions accept a Logger so calls are traceable via correlation ID.
// When `HUBSPOT_ACCESS_TOKEN` isn't set (e.g. local dev before Ibtissam
// provisions the Private App), calls return a `stub` sentinel instead of
// throwing — this lets the trial/intro routes run end-to-end against
// MindBody without HubSpot wired up yet. Flip `HUBSPOT_REQUIRED=true` in
// env to make HubSpot a hard dependency once it's provisioned.

import type { Logger } from "./logger";

export interface HubspotConfig {
  accessToken: string;
  customObjectTypeId: string; // e.g. "2-12345678"
  baseUrl: string; // default: https://api.hubapi.com
}

export function loadHubspotConfig(): HubspotConfig | null {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const typeId = process.env.HUBSPOT_CUSTOM_OBJECT_TYPE_ID;
  if (!token || !typeId) {
    if (process.env.HUBSPOT_REQUIRED === "true") {
      throw new Error(
        "HubSpot required but HUBSPOT_ACCESS_TOKEN or HUBSPOT_CUSTOM_OBJECT_TYPE_ID not set",
      );
    }
    return null;
  }
  return {
    accessToken: token,
    customObjectTypeId: typeId,
    baseUrl: process.env.HUBSPOT_BASE_URL ?? "https://api.hubapi.com",
  };
}

export type HubspotResult<T> = { ok: true; data: T } | { ok: false; stubbed: true } | { ok: false; error: HubspotError };

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
  cfg: HubspotConfig,
  log: Logger,
  opts: { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown },
): Promise<T> {
  const started = Date.now();
  const res = await fetch(cfg.baseUrl + opts.path, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.accessToken}`,
    },
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
    log.error("hubspot.request.fail", { path: opts.path, status: res.status, ms, body: parsed });
    throw new HubspotError(`${opts.method} ${opts.path} → ${res.status}`, res.status, parsed);
  }
  log.info("hubspot.request.ok", { path: opts.path, ms });
  return parsed as T;
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export interface ContactProps {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  court16_intent?: string;
  court16_child_name?: string;
  court16_child_age?: string;
  court16_location?: string;
  court16_correlation_id?: string;
  court16_waiver_version?: string;
  [k: string]: string | undefined;
}

/**
 * Upsert a Contact by email. Posts to create; on 409 duplicate, falls back
 * to PATCH by email via the idProperty query param.
 */
export async function upsertContact(
  cfg: HubspotConfig,
  log: Logger,
  props: ContactProps,
): Promise<{ id: string }> {
  const { email, ...rest } = props;
  const properties: Record<string, string> = { email, ...stripUndefined(rest) };
  try {
    const created = await hsFetch<{ id: string }>(cfg, log, {
      method: "POST",
      path: "/crm/v3/objects/contacts",
      body: { properties },
    });
    return created;
  } catch (e) {
    if (e instanceof HubspotError && e.status === 409) {
      // PATCH by email idProperty
      const patched = await hsFetch<{ id: string }>(cfg, log, {
        method: "PATCH",
        path: `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
        body: { properties },
      });
      return patched;
    }
    throw e;
  }
}

// ─── Custom object: court16_booking ─────────────────────────────────────────

export interface BookingProps {
  correlation_id: string;
  intent: "kid_trial" | "adult_intro";
  status:
    | "pending_staff"
    | "pending_payment"
    | "confirmed"
    | "failed"
    | "duplicate_email_softwall"
    | "manual_review";
  location_id: string;
  class_id?: string;
  offer_key?: string;
  mindbody_parent_id?: string;
  mindbody_child_id?: string;
  mindbody_adult_id?: string;
  waiver_version: string;
  staff_confirm_url?: string;
  staff_reassign_url?: string;
  admin_retry_url?: string;
  payload_json?: string;
  failure_reason?: string;
  last_mindbody_response?: string;
}

export async function createBooking(
  cfg: HubspotConfig,
  log: Logger,
  props: BookingProps,
  associations?: { contactId?: string },
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { properties: stripUndefined(props as unknown as Record<string, unknown>) };
  if (associations?.contactId) {
    // HubSpot v3 supports associations in the create request.
    body.associations = [
      {
        to: { id: associations.contactId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 0 }],
      },
    ];
  }
  return hsFetch<{ id: string }>(cfg, log, {
    method: "POST",
    path: `/crm/v3/objects/${cfg.customObjectTypeId}`,
    body,
  });
}

export async function updateBookingStatus(
  cfg: HubspotConfig,
  log: Logger,
  bookingId: string,
  patch: Partial<BookingProps>,
): Promise<{ id: string }> {
  return hsFetch<{ id: string }>(cfg, log, {
    method: "PATCH",
    path: `/crm/v3/objects/${cfg.customObjectTypeId}/${encodeURIComponent(bookingId)}`,
    body: { properties: stripUndefined(patch as unknown as Record<string, unknown>) },
  });
}

export async function getBookingByCorrelationId(
  cfg: HubspotConfig,
  log: Logger,
  correlationId: string,
): Promise<{ id: string; properties: Partial<BookingProps> } | null> {
  const res = await hsFetch<{
    results: Array<{ id: string; properties: Partial<BookingProps> }>;
  }>(cfg, log, {
    method: "POST",
    path: `/crm/v3/objects/${cfg.customObjectTypeId}/search`,
    body: {
      filterGroups: [
        {
          filters: [{ propertyName: "correlation_id", operator: "EQ", value: correlationId }],
        },
      ],
      limit: 1,
      properties: [
        "correlation_id",
        "intent",
        "status",
        "location_id",
        "class_id",
        "offer_key",
        "mindbody_parent_id",
        "mindbody_child_id",
        "mindbody_adult_id",
        "waiver_version",
        "staff_confirm_url",
        "staff_reassign_url",
        "admin_retry_url",
        "payload_json",
        "failure_reason",
        "last_mindbody_response",
      ],
    },
  });
  return res.results[0] ?? null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function stripUndefined<T extends Record<string, unknown>>(o: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}
