// MindBody Public API v6 client — minimal, typed, and paranoid.
//
// Design notes (these matter — BLINK failed exactly here):
//   1. NEVER call AddClient without GetClients first. Duplicate client records
//      are the #1 cause of "sync is broken" support tickets.
//   2. Every write call defaults to Test=true unless MINDBODY_WRITE_MODE === "live".
//      Even in live mode, individual callers can still opt-in to Test=true.
//   3. The StaffUserToken is cached in-process for ~50 minutes (MindBody tokens
//      live for ~60 minutes). In a serverless world this means each cold lambda
//      does one token issue, not four.
//   4. Every call gets a correlation ID in the log stream so we can trace a
//      happy-path run end-to-end.
//
// If you're reading this during Phase 3 planning: the abstractions here
// (`getClientsByEmail`, `upsertClient`, etc.) should move into a real domain
// layer — this file is the MindBody adapter, not the app's business logic.

import type { Logger } from "./logger";

export interface MindbodyConfig {
  apiKey: string;
  siteId: string;
  baseUrl: string;
  staffUsername: string;
  staffPassword: string;
  writeMode: "test" | "live";
}

export function loadConfigFromEnv(): MindbodyConfig {
  const required = ["MINDBODY_API_KEY", "MINDBODY_SITE_ID", "MINDBODY_STAFF_USERNAME", "MINDBODY_STAFF_PASSWORD"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. See .env.example.`,
    );
  }
  const writeModeRaw = process.env.MINDBODY_WRITE_MODE ?? "test";
  if (writeModeRaw !== "test" && writeModeRaw !== "live") {
    throw new Error(`MINDBODY_WRITE_MODE must be "test" or "live", got "${writeModeRaw}"`);
  }
  return {
    apiKey: process.env.MINDBODY_API_KEY!,
    siteId: process.env.MINDBODY_SITE_ID!,
    baseUrl: process.env.MINDBODY_BASE_URL ?? "https://api.mindbodyonline.com/public/v6",
    staffUsername: process.env.MINDBODY_STAFF_USERNAME!,
    staffPassword: process.env.MINDBODY_STAFF_PASSWORD!,
    writeMode: writeModeRaw,
  };
}

// ─── Token cache (per process) ────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const TOKEN_TTL_MS = 50 * 60 * 1000; // MindBody tokens live ~60min, refresh at 50.
let cachedToken: CachedToken | null = null;

export async function issueStaffUserToken(cfg: MindbodyConfig, log: Logger): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    log.debug("mindbody.token.cache-hit");
    return cachedToken.token;
  }
  log.info("mindbody.token.issue.start");
  const res = await fetch(`${cfg.baseUrl}/usertoken/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": cfg.apiKey,
      SiteId: cfg.siteId,
    },
    body: JSON.stringify({ Username: cfg.staffUsername, Password: cfg.staffPassword }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.AccessToken) {
    log.error("mindbody.token.issue.fail", { status: res.status, body });
    throw new MindbodyError("usertoken/issue failed", res.status, body);
  }
  cachedToken = { token: body.AccessToken, expiresAt: Date.now() + TOKEN_TTL_MS };
  log.info("mindbody.token.issue.ok", { tokenPrefix: body.AccessToken.slice(0, 8) });
  return body.AccessToken;
}

// ─── Low-level fetch ──────────────────────────────────────────────────────────

/**
 * Exposed helper for route handlers that want to hit a raw MindBody endpoint
 * under a specific SiteId without copy-pasting the config-load + site-override
 * dance. Loads config from env, sets the SiteId header for this call, and
 * returns the parsed JSON.
 *
 * Pass `consumerMode: true` to SKIP the staff-user-token issue. MindBody
 * treats most GET endpoints (notably /class/classes, /site/sites,
 * /site/locations) as public under "Consumer Mode" — just Api-Key +
 * SiteId is enough. Use this for read-only routes so we don't fail when
 * MindBody's token endpoint 500s or when the Api-Key lacks Go-Live
 * staff-auth privileges but still has Consumer Mode access.
 */
export async function authedMindbodyGet<T>(
  log: Logger,
  opts: {
    siteIdOverride?: string;
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    consumerMode?: boolean;
  },
): Promise<T> {
  const cfg = loadConfigFromEnv();
  const cfgWithSite = opts.siteIdOverride ? { ...cfg, siteId: opts.siteIdOverride } : cfg;
  if (opts.consumerMode) {
    return consumerFetch<T>(cfgWithSite, log, { path: opts.path, query: opts.query });
  }
  return authedFetch<T>(cfgWithSite, log, { method: "GET", path: opts.path, query: opts.query });
}

/** Unauthenticated GET — Api-Key + SiteId only, no staff user token. */
async function consumerFetch<T>(
  cfg: MindbodyConfig,
  log: Logger,
  opts: { path: string; query?: Record<string, string | number | boolean | undefined> },
): Promise<T> {
  const url = new URL(cfg.baseUrl + opts.path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const started = Date.now();
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": cfg.apiKey,
      SiteId: cfg.siteId,
    },
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as text
  }
  if (!res.ok) {
    log.error("mindbody.consumer.fail", { path: opts.path, status: res.status, ms, body: parsed });
    throw new MindbodyError(`GET ${opts.path} → ${res.status}`, res.status, parsed);
  }
  log.info("mindbody.consumer.ok", { path: opts.path, ms });
  return parsed as T;
}

async function authedFetch<T>(
  cfg: MindbodyConfig,
  log: Logger,
  opts: {
    method: "GET" | "POST";
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    includeTestFlag?: boolean; // only applies when method === POST
  },
): Promise<T> {
  const token = await issueStaffUserToken(cfg, log);
  const url = new URL(cfg.baseUrl + opts.path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  // Inject Test=true on writes unless writeMode === "live".
  let finalBody: unknown = opts.body;
  if (opts.method === "POST" && opts.includeTestFlag) {
    const shouldTest = cfg.writeMode !== "live";
    finalBody = { ...(opts.body as object), Test: shouldTest };
  }

  const started = Date.now();
  const res = await fetch(url.toString(), {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      "Api-Key": cfg.apiKey,
      SiteId: cfg.siteId,
      Authorization: `Bearer ${token}`,
    },
    body: opts.method === "POST" ? JSON.stringify(finalBody) : undefined,
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as text
  }

  if (!res.ok) {
    log.error("mindbody.request.fail", {
      path: opts.path,
      status: res.status,
      ms,
      body: parsed,
    });
    throw new MindbodyError(`${opts.method} ${opts.path} → ${res.status}`, res.status, parsed);
  }

  log.info("mindbody.request.ok", { path: opts.path, ms });
  return parsed as T;
}

// ─── Typed wrappers ───────────────────────────────────────────────────────────

export interface MindbodyClient {
  Id: number | string;
  UniqueId?: number;
  FirstName?: string;
  LastName?: string;
  Email?: string;
  CreationDate?: string;
  [k: string]: unknown;
}

export interface GetClientsResponse {
  PaginationResponse?: { RequestedLimit: number; RequestedOffset: number; PageSize: number; TotalResults: number };
  Clients?: MindbodyClient[];
}

/** Search clients by email. Returns [] if none. */
export async function getClientsByEmail(
  cfg: MindbodyConfig,
  log: Logger,
  email: string,
): Promise<MindbodyClient[]> {
  const res = await authedFetch<GetClientsResponse>(cfg, log, {
    method: "GET",
    path: "/client/clients",
    query: { SearchText: email, Limit: 5 },
  });
  return res.Clients ?? [];
}

export interface AddClientInput {
  FirstName: string;
  LastName: string;
  Email: string;
  BirthDate?: string; // ISO "YYYY-MM-DD"
  MobilePhone?: string;
  ReferredBy?: string;
  /**
   * Inline client relationships (v6 has no dedicated AddClientRelationship
   * endpoint — relationships ride on AddClient / UpdateClient). Each entry
   * needs BOTH `RelationshipName` AND the nested `Relationship` object;
   * MindBody validates both layers and rejects if either is missing.
   * For Guardian: RelationshipName = "Guardian", Relationship.Id = 20,
   * RelationshipName1 = "Guardian", RelationshipName2 = "Dependent".
   */
  ClientRelationships?: Array<{
    RelatedClientId: string | number;
    RelationshipName: string;
    Relationship: {
      Id: number;
      RelationshipName1: string;
      RelationshipName2: string;
    };
  }>;
}

/** Canonical Guardian relationship descriptor. Pass as `Relationship` inside a ClientRelationships entry. */
export const GUARDIAN_RELATIONSHIP = {
  Id: 20,
  RelationshipName1: "Guardian",
  RelationshipName2: "Dependent",
} as const;

export interface AddClientResponse {
  Client: MindbodyClient;
}

/** Create a new client record. ALWAYS call getClientsByEmail first. */
export async function addClient(
  cfg: MindbodyConfig,
  log: Logger,
  input: AddClientInput,
): Promise<MindbodyClient> {
  const res = await authedFetch<MindbodyClient & { Client?: MindbodyClient }>(cfg, log, {
    method: "POST",
    path: "/client/addclient",
    body: input,
    includeTestFlag: true,
  });
  return res.Client ?? (res as MindbodyClient);
}

export interface AddRelationshipInput {
  ClientId: string | number; // parent
  RelatedClientId: string | number; // child
  RelationshipId: number; // 20 = Guardian in MindBody's default relationship catalog
}

/**
 * Add a Guardian relationship between two existing clients via UpdateClient.
 *
 * MindBody Public API v6 does NOT expose a standalone AddClientRelationship
 * endpoint — every path variant returns 404 (confirmed against the -99
 * sandbox). Relationships ride on the Client object itself. This helper
 * issues an UpdateClient to `ClientId` with a ClientRelationships array
 * pointing to `RelatedClientId`.
 *
 * Prefer the inline form on `addClient` when creating a new child that
 * already knows its parent's ID — it saves a round-trip.
 */
export async function addClientRelationship(
  cfg: MindbodyConfig,
  log: Logger,
  input: AddRelationshipInput,
): Promise<unknown> {
  const clientPayload = {
    Id: input.ClientId,
    ClientRelationships: [
      {
        RelatedClientId: String(input.RelatedClientId),
        RelationshipName: GUARDIAN_RELATIONSHIP.RelationshipName1,
        Relationship: { ...GUARDIAN_RELATIONSHIP },
      },
    ],
  };
  // CrossRegionalUpdate defaults to true, which errors on single-site
  // subscribers ("The current site does not belong to a region"). Force
  // false — this always works whether the site is in a region or not.
  return authedFetch(cfg, log, {
    method: "POST",
    path: "/client/updateclient",
    body: { Client: clientPayload, CrossRegionalUpdate: false },
    includeTestFlag: true,
  });
}

export interface ClassDescription {
  ClassId?: number;
  Id?: number;
  StartDateTime?: string;
  EndDateTime?: string;
  ClassDescription?: { Name?: string };
  Staff?: { Name?: string };
  Location?: { Id?: number; Name?: string };
  MaxCapacity?: number;
  TotalBooked?: number;
}

export interface GetClassesResponse {
  Classes?: ClassDescription[];
  PaginationResponse?: unknown;
}

/** List upcoming classes — useful to grab a real ClassId to test booking against. */
export async function getClasses(
  cfg: MindbodyConfig,
  log: Logger,
  opts: { startDateTime?: string; endDateTime?: string; limit?: number } = {},
): Promise<ClassDescription[]> {
  const res = await authedFetch<GetClassesResponse>(cfg, log, {
    method: "GET",
    path: "/class/classes",
    query: {
      StartDateTime: opts.startDateTime,
      EndDateTime: opts.endDateTime,
      Limit: opts.limit ?? 20,
    },
  });
  return res.Classes ?? [];
}

export interface AddClientToClassInput {
  ClientId: string | number;
  ClassId: number;
  /** Pricing option / service id. Optional — MindBody will pick the first applicable pricing if omitted. */
  ClientServiceId?: number;
  /** If true, waitlist if class is full instead of erroring. */
  SendEmail?: boolean;
  Waitlist?: boolean;
  CrossRegionalBookingClientId?: string | number;
}

/** Book a client into a class. Respects Test=true gate. */
export async function addClientToClass(
  cfg: MindbodyConfig,
  log: Logger,
  input: AddClientToClassInput,
): Promise<unknown> {
  return authedFetch(cfg, log, {
    method: "POST",
    path: "/class/addclienttoclass",
    body: input,
    includeTestFlag: true,
  });
}

export interface ClientService {
  Id?: number;
  Count?: number;
  Remaining?: number;
  Name?: string;
  PaymentDate?: string;
  ActiveDate?: string;
  ExpirationDate?: string;
  [k: string]: unknown;
}

export interface GetClientServicesResponse {
  ClientServices?: ClientService[];
  PaginationResponse?: unknown;
}

/**
 * List the pricing options / service credits on a client. Used after an
 * adult's intro-offer payment to verify the purchase landed before calling
 * AddClientToClass.
 */
export async function getClientServices(
  cfg: MindbodyConfig,
  log: Logger,
  clientId: string | number,
): Promise<ClientService[]> {
  const res = await authedFetch<GetClientServicesResponse>(cfg, log, {
    method: "GET",
    path: "/client/clientservices",
    query: { ClientId: String(clientId), Limit: 50 },
  });
  return res.ClientServices ?? [];
}

/**
 * Build a MindBody cart URL for an adult intro-offer checkout.
 *
 * IMPORTANT (spike result, 2026-04-18): the classic cart at
 * `clients.mindbodyonline.com/classic/ws` responds with
 * `X-Frame-Options: SAMEORIGIN` and cannot be iframe-embedded. Tier C's
 * embedded-widget plan needs a MindBody-side choice (Anthony sets up a
 * Healcode / Branded Web Tools widget per location) OR a custom
 * Stripe-to-MindBody integration on our side. Until one of those lands,
 * this helper returns a REDIRECT URL — the UI opens it in a new window or
 * redirects the parent directly instead of iframing it.
 *
 * URL format is the classic MindBody embed-shopping-cart deep link:
 * https://clients.mindbodyonline.com/classic/ws?studioid={siteId}&stype=-8&sTG=50&sTrn={serviceId}
 * The return URL is handled via MindBody's "Return URL" site setting
 * (configured per site by the owner) — not a URL param.
 */
export function buildAdultCartUrl(opts: {
  siteId: string | number;
  serviceId: number;
  clientId?: string | number;
}): string {
  const params = new URLSearchParams();
  params.set("studioid", String(opts.siteId));
  params.set("stype", "-8"); // MindBody's internal code for "buy service"
  params.set("sTG", "50"); // "add to cart"
  params.set("sTrn", String(opts.serviceId));
  if (opts.clientId) params.set("clientId", String(opts.clientId));
  return `https://clients.mindbodyonline.com/classic/ws?${params.toString()}`;
}

/** In-process age-band filter for class lists. MindBody has no server-side age filter. */
export function filterClassesByAgeBand(
  classes: ClassDescription[],
  ageMin: number | undefined,
  ageMax: number | undefined,
): ClassDescription[] {
  if (ageMin === undefined && ageMax === undefined) return classes;
  return classes.filter((c) => {
    const name = c.ClassDescription?.Name ?? "";
    const m = name.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) return true;
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (ageMin !== undefined && hi < ageMin) return false;
    if (ageMax !== undefined && lo > ageMax) return false;
    return true;
  });
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class MindbodyError extends Error {
  status: number;
  body: unknown;
  constructor(msg: string, status: number, body: unknown) {
    super(msg);
    this.name = "MindbodyError";
    this.status = status;
    this.body = body;
  }
  toJSON() {
    return { name: this.name, message: this.message, status: this.status, body: this.body };
  }
}

// ─── Auth helper for API routes ───────────────────────────────────────────────

/**
 * If TEST_API_TOKEN is set in the environment, require the caller to send
 * `Authorization: Bearer <token>`. No-op if env var is unset (convenient for
 * local dev). Does NOT apply to the public home page.
 */
export function checkCallerToken(req: Request): { ok: true } | { ok: false; status: number; reason: string } {
  const required = process.env.TEST_API_TOKEN;
  if (!required) return { ok: true };
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || token !== required) {
    return { ok: false, status: 401, reason: "Missing or invalid Bearer token (set TEST_API_TOKEN)" };
  }
  return { ok: true };
}
