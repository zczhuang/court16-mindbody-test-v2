// MindBody Public API v6 client — minimal, typed, and paranoid.
//
// Design notes (these matter — BLINK failed exactly here):
//   1. NEVER call AddClient without GetClients first. Duplicate client records
//      are the #1 cause of "sync is broken" support tickets.
//   2. Every write call defaults to Test=true unless MINDBODY_WRITE_MODE === "live".
//      Even in live mode, individual callers can still opt-in to Test=true.
//   3. StaffUserTokens are cached per SiteId for ~50 minutes (MindBody tokens
//      live for ~60 minutes). A token issued for one club must never be reused
//      against another club during a multi-site serverless invocation.
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
const cachedTokens = new Map<string, CachedToken>();

export async function issueStaffUserToken(cfg: MindbodyConfig, log: Logger): Promise<string> {
  const cached = cachedTokens.get(cfg.siteId);
  if (cached && cached.expiresAt > Date.now()) {
    log.debug("mindbody.token.cache-hit", { siteId: cfg.siteId });
    return cached.token;
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
  cachedTokens.set(cfg.siteId, {
    token: body.AccessToken,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  log.info("mindbody.token.issue.ok", {
    siteId: cfg.siteId,
    tokenPrefix: body.AccessToken.slice(0, 8),
  });
  return body.AccessToken;
}

// ─── Source-Credentials staff token (v6) ─────────────────────────────────────

/**
 * Thrown by `issueSourceStaffToken` when MINDBODY_SOURCE_PASSWORD is not set.
 * Callers catch this specifically and attempt consumer mode; that request can
 * still fail when the API key is not authorized for the Site ID.
 */
export class MindbodySourceCredsMissingError extends Error {
  constructor() {
    super("MINDBODY_SOURCE_PASSWORD env var is not set");
    this.name = "MindbodySourceCredsMissingError";
  }
}

/**
 * Default Source Name on developers.mindbodyonline.com for the Cedarwind
 * developer account. Override via MINDBODY_SOURCE_NAME if a different
 * source name is provisioned later.
 */
const DEFAULT_SOURCE_NAME = "CedarWindSolutionsLLC";

/** Source-derived tokens are JWTs valid ~24h. Refresh at 23h. */
const SOURCE_TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * Cache is keyed by SiteId because the issued JWT carries `subscriberId`
 * in its payload — a token issued against 5748154 won't work against
 * another site. Map lets us hold multiple in-process if we ever fan out
 * to multiple Court 16 sites in a single Lambda.
 */
const cachedSourceTokens = new Map<string, CachedToken>();

/**
 * Issue a staff-level v6 Bearer token using MindBody Source Credentials
 * (developer "Source Name" + Source Password).
 *
 * Why this exists: v6 `/class/classes` filters out classes marked "hidden"
 * in MindBody admin when there's no Authorization header (per MindBody
 * Public API release notes — "GetClasses V6 will no longer return classes
 * that are marked as 'hidden' when there is no authentication header
 * present"). Court 16's Ridge Hill kid-trial Program (id 61) is one such
 * Program. Without this token, /api/mindbody/calendar?intent=kid_trial
 * returns 0 classes and the booking form's calendar is blank.
 *
 * The trick: prefixing the Source Name with an underscore (`_CedarWindSolutionsLLC`)
 * and using the Source Password as the password authenticates against
 * /usertoken/issue and returns a JWT with `access: "Staff"`. This token
 * reveals all hidden classes — verified against site 5748154 May 22,
 * 24 Program 61 occurrences surfaced.
 *
 * This is INTENTIONALLY read-side only — write endpoints (AddClient,
 * AddClientToClass, etc.) keep using consumer mode (Api-Key + SiteId)
 * because (a) consumer mode works for them on real sites and (b) we
 * don't want a single token leak to grant write privileges to all
 * Court 16 sites simultaneously.
 */
export async function issueSourceStaffToken(
  cfg: MindbodyConfig,
  log: Logger,
): Promise<string> {
  const sourcePassword = process.env.MINDBODY_SOURCE_PASSWORD;
  if (!sourcePassword) {
    throw new MindbodySourceCredsMissingError();
  }
  const sourceName = process.env.MINDBODY_SOURCE_NAME ?? DEFAULT_SOURCE_NAME;
  const username = `_${sourceName}`;

  const cached = cachedSourceTokens.get(cfg.siteId);
  if (cached && cached.expiresAt > Date.now()) {
    log.debug("mindbody.source-token.cache-hit", { siteId: cfg.siteId });
    return cached.token;
  }

  log.info("mindbody.source-token.issue.start", { siteId: cfg.siteId, username });
  const res = await fetch(`${cfg.baseUrl}/usertoken/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": cfg.apiKey,
      SiteId: cfg.siteId,
    },
    body: JSON.stringify({ Username: username, Password: sourcePassword }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.AccessToken) {
    log.error("mindbody.source-token.issue.fail", {
      siteId: cfg.siteId,
      status: res.status,
      body,
    });
    throw new MindbodyError("source-staff usertoken/issue failed", res.status, body);
  }
  const expiresAt = Date.now() + SOURCE_TOKEN_TTL_MS;
  cachedSourceTokens.set(cfg.siteId, { token: body.AccessToken, expiresAt });
  log.info("mindbody.source-token.issue.ok", {
    siteId: cfg.siteId,
    tokenPrefix: body.AccessToken.slice(0, 8),
    userType: body.User?.Type,
    expiresAt,
  });
  return body.AccessToken;
}

// ─── Low-level fetch ──────────────────────────────────────────────────────────

/**
 * Exposed helper for route handlers that want to hit a raw MindBody endpoint
 * under a specific SiteId without copy-pasting the config-load + site-override
 * dance. Loads config from env, sets the SiteId header for this call, and
 * returns the parsed JSON.
 *
 * Three auth modes — pick at most one:
 *
 *   • `consumerMode: true` — Api-Key + SiteId only, no Bearer. Fastest path.
 *     Works for /client/clients search, AddClient, AddClientToClass on real
 *     sites. Will MISS classes flagged "hidden" in MindBody admin from
 *     /class/classes.
 *
 *   • `staffMode: true` — Api-Key + SiteId + Bearer derived from MindBody
 *     SOURCE CREDENTIALS (developers.mindbodyonline.com → Source Password,
 *     stored as MINDBODY_SOURCE_PASSWORD). This Bearer carries `access: Staff`
 *     and reveals hidden classes — critical for /api/mindbody/calendar so
 *     Program 61 (Ridge Hill Kid's Trials) occurrences surface in the form's
 *     calendar. If source authentication fails, it attempts consumer mode
 *     and emits a `mindbody.staff-mode.degraded` warning; unauthorized sites
 *     still fail the underlying request.
 *
 *   • default (neither flag) — staff-user token issued from
 *     MINDBODY_STAFF_USERNAME/PASSWORD. Legacy path, kept for the few
 *     endpoints that require it.
 */
export async function authedMindbodyGet<T>(
  log: Logger,
  opts: {
    siteIdOverride?: string;
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    consumerMode?: boolean;
    staffMode?: boolean;
  },
): Promise<T> {
  const cfg = loadConfigFromEnv();
  const cfgWithSite = opts.siteIdOverride ? { ...cfg, siteId: opts.siteIdOverride } : cfg;
  if (opts.staffMode) {
    return staffFetch<T>(cfgWithSite, log, { path: opts.path, query: opts.query });
  }
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

/**
 * Source-credentials GET — Api-Key + SiteId + Bearer JWT issued from the
 * Cedarwind developer Source Name + Source Password. Reveals classes
 * flagged "hidden" in MindBody admin (per the v6 release notes — see
 * `issueSourceStaffToken` doc).
 *
 * Attempts consumer mode when:
 *   • MINDBODY_SOURCE_PASSWORD is unset (e.g. local dev without the password),
 *   • or /usertoken/issue rejects the source credentials (e.g. credentials
 *     rotated, network blip).
 *
 * The follow-up consumer request can still fail when the API key is not
 * authorized for that Site ID. Logs `mindbody.staff-mode.degraded` before
 * attempting the request so the loss of staff visibility is observable.
 */
async function staffFetch<T>(
  cfg: MindbodyConfig,
  log: Logger,
  opts: { path: string; query?: Record<string, string | number | boolean | undefined> },
): Promise<T> {
  let bearer: string | null = null;
  try {
    bearer = await issueSourceStaffToken(cfg, log);
  } catch (err) {
    if (err instanceof MindbodySourceCredsMissingError) {
      log.warn("mindbody.staff-mode.degraded", {
        path: opts.path,
        reason: "source-password-unset",
      });
    } else {
      log.warn("mindbody.staff-mode.degraded", {
        path: opts.path,
        reason: "token-issue-failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const url = new URL(cfg.baseUrl + opts.path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Api-Key": cfg.apiKey,
    SiteId: cfg.siteId,
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const started = Date.now();
  const res = await fetch(url.toString(), { method: "GET", headers });
  const ms = Date.now() - started;
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as text
  }
  if (!res.ok) {
    log.error("mindbody.staff.fail", {
      path: opts.path,
      status: res.status,
      ms,
      bearer: bearer ? "present" : "absent",
      body: parsed,
    });
    throw new MindbodyError(`GET ${opts.path} → ${res.status}`, res.status, parsed);
  }
  log.info("mindbody.staff.ok", {
    path: opts.path,
    ms,
    bearer: bearer ? "present" : "absent",
  });
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
    /**
     * When true, skip the staff-user-token dance and authenticate with
     * Api-Key + SiteId only ("Consumer Mode"). Many v6 endpoints accept
     * this on real production sites (verified May 15 against Court 16
     * Ridge Hill site 5748154 for AddClient, AddClientToClass, and the
     * /client/clients search). Only UpdateClient and similar
     * staff-admin endpoints REJECT consumer mode with
     * `InvalidPermissionConfiguration`.
     *
     * Consumer-mode AddClient on real sites must satisfy the SITE's
     * `RequiredClientFields` config (probe via GET /client/requiredclientfields).
     * The current RH readback returns AddressLine1, City, State, PostalCode,
     * BirthDate, MobilePhone, Email, and Gender. Re-probe every site rather
     * than copying this list into a new club's intake policy.
     */
    consumerMode?: boolean;
  },
): Promise<T> {
  const token = opts.consumerMode ? null : await issueStaffUserToken(cfg, log);
  const url = new URL(cfg.baseUrl + opts.path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  // Inject Test=true on writes unless writeMode === "live". Note: AddClient
  // on real (non-sandbox) sites rejects the Test parameter outright with
  // `Test mode is not allowed for this endpoint` — callers that hit
  // real-site write endpoints should pass includeTestFlag: false.
  let finalBody: unknown = opts.body;
  if (opts.method === "POST" && opts.includeTestFlag) {
    const shouldTest = cfg.writeMode !== "live";
    finalBody = { ...(opts.body as object), Test: shouldTest };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Api-Key": cfg.apiKey,
    SiteId: cfg.siteId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const started = Date.now();
  const res = await fetch(url.toString(), {
    method: opts.method,
    headers,
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
  BirthDate?: string;
  CreationDate?: string;
  [k: string]: unknown;
}

/**
 * Family bookings put the PARENT'S email on both the parent and the child
 * records, so an email search returns the whole family. Pick the account
 * holder: prefer a record whose BirthDate is 18+ years ago; fall back to
 * the first match when birth dates are missing.
 */
export function pickAdultClient(clients: MindbodyClient[]): MindbodyClient | undefined {
  if (clients.length <= 1) return clients[0];
  const YEAR_MS = 365.25 * 24 * 3600 * 1000;
  const adult = clients.find((c) => {
    const born = c.BirthDate ? Date.parse(c.BirthDate) : NaN;
    return Number.isFinite(born) && Date.now() - born >= 18 * YEAR_MS;
  });
  return adult ?? clients[0];
}

export interface GetClientsResponse {
  PaginationResponse?: { RequestedLimit: number; RequestedOffset: number; PageSize: number; TotalResults: number };
  Clients?: MindbodyClient[];
}

/**
 * Look up clients by email. Returns [] if none.
 *
 * Family bookings put the PARENT'S email on the parent AND the child
 * records, so this routinely returns the whole family. Never treat `[0]`
 * as the account holder — use `pickAdultClient()` to select the adult.
 *
 * MindBody's SearchText is a fuzzy search; results are filtered here to
 * exact (case-insensitive) Email matches so "by email" means what it says.
 */
export async function getClientsByEmail(
  cfg: MindbodyConfig,
  log: Logger,
  email: string,
): Promise<MindbodyClient[]> {
  // Staff mode (source-staff bearer): consumer-mode /client/clients search
  // returns 0 results on production sites as of Jul 10 2026 — verified on
  // 5748154 even for months-old records with plain emails — which silently
  // disabled the duplicate softwall. staffFetch degrades to consumer mode
  // when source creds are absent (sandbox), preserving behavior there.
  //
  // CAUTION: even staff-mode SearchText misses some existing records
  // outright (e.g. one of two records sharing an email). Callers must not
  // treat [] as proof of absence — the trial route's ID-first HubSpot
  // guard is the primary duplicate defense; this search is the fallback.
  const res = await staffFetch<GetClientsResponse>(cfg, log, {
    path: "/client/clients",
    // Limit sized for the shared-email world: one family can occupy
    // several rows, and fuzzy matches may pad the page before filtering.
    query: { SearchText: email, Limit: 20 },
  });
  const wanted = email.trim().toLowerCase();
  return (res.Clients ?? []).filter((c) => (c.Email ?? "").trim().toLowerCase() === wanted);
}

/**
 * Direct lookup by MindBody client IDs. Reliable where SearchText is not:
 * ID lookups returned records throughout the Jul 10 investigation while
 * email search returned nothing. Used by the ID-first duplicate guard.
 */
export async function getClientsByIds(
  cfg: MindbodyConfig,
  log: Logger,
  ids: Array<string | number>,
): Promise<MindbodyClient[]> {
  if (ids.length === 0) return [];
  // ClientIds is a repeated query param, which staffFetch's query map
  // can't express — encode it into the path instead.
  const qs = ids.map((id) => `ClientIds=${encodeURIComponent(String(id))}`).join("&");
  const res = await staffFetch<GetClientsResponse>(cfg, log, { path: `/client/clients?${qs}` });
  return res.Clients ?? [];
}

export interface AddClientInput {
  // Always required by AddClient endpoint itself
  FirstName: string;
  LastName: string;

  // Required by site 5748154 (RH) consumer-mode config — probe via
  // GET /client/requiredclientfields. Other sites may differ; callers
  // should provide all of these so the helper works site-agnostic.
  Email: string;
  BirthDate?: string; // ISO "YYYY-MM-DD"
  MobilePhone?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  ReferredBy?: string;
  /**
   * One of MindBody's standard genders. Site 5748154 only accepts the
   * built-ins ("Male", "Female", etc.) without a staff token — custom
   * genders return `InvalidPermissionConfiguration` in consumer mode.
   */
  Gender?: string;
  EmergencyContactInfoName?: string;
  EmergencyContactInfoPhone?: string;
  EmergencyContactInfoEmail?: string;
  EmergencyContactInfoRelationship?: string;

  /**
   * Inline client relationships (v6 has no dedicated AddClientRelationship
   * endpoint — relationships ride on AddClient / UpdateClient). Each entry
   * needs BOTH `RelationshipName` AND the nested `Relationship` object;
   * MindBody validates both layers and rejects if either is missing.
   *
   * Site 5748154's relationship catalog (via GET /site/relationships) uses
   * NEGATIVE IDs for built-ins: -4 "Pays For", -6 "Parent/Guardian", etc.
   * Our pre-Bug-A code used `Id: 20` which doesn't exist on this site
   * (returned "Relationship validation failed" on AddClient).
   *
   * Inline form is required for consumer-mode usage — the standalone
   * `addClientRelationship` helper (UpdateClient-based) returns
   * `InvalidPermissionConfiguration` without a staff token.
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

  // ── Communication preferences (May 25 — see v2 commit dde7e46) ──
  // MindBody has 6 send-* opt-in flags. When AddClient omits them, MindBody
  // defaults them all to FALSE — which silently suppresses the "Add Court 16
  // to your Mindbody account" auto-link email + any other transactional sends.
  // Caught when a v2 smoke against chuangstuart@gmail.com landed clean but
  // no auto-link email arrived; readback showed SendAccountEmails=False.
  SendAccountEmails?: boolean;
  SendScheduleEmails?: boolean;
  SendPromotionalEmails?: boolean;
  SendAccountTexts?: boolean;
  SendScheduleTexts?: boolean;
  SendPromotionalTexts?: boolean;
}

/**
 * Canonical "Pays For" relationship descriptor for site 5748154 (RH).
 * Per MindBody's Family Account docs this is the right semantic for a
 * parent paying for a child's bookings — the parent receives comms,
 * billing routes through them, and the MindBody consumer-app Family
 * Account dashboard surfaces the child under the parent's account.
 *
 * Other sites may use different RelationshipId values. Probe via
 * `GET /site/relationships` per-site before assuming.
 */
export const PAYS_FOR_RELATIONSHIP = {
  Id: -4,
  RelationshipName1: "Is Paid For By",
  RelationshipName2: "Pays For",
} as const;

/**
 * Parent/Guardian → Child relationship for site 5748154 (RH). This is the
 * semantically correct familial link between a parent and their kid —
 * confirmed in the live relationship catalog (`GET /site/relationships`,
 * negative built-in IDs) and verified accepted inline on consumer-mode
 * AddClient (Jun 16: stores bidirectionally — parent reads "Parent/Guardian",
 * child reads "Child").
 *
 * Set on the CHILD's AddClient with RelatedClientId = parent and
 * RelationshipName = RelationshipName2 ("Child"), mirroring how PAYS_FOR was
 * wired. Preferred over PAYS_FOR_RELATIONSHIP (-4), which is a *billing*
 * relationship; if billing attribution is ever needed for paid bookings,
 * both can be sent in the same ClientRelationships array.
 *
 * Note: even this is a peer relationship between two full client records —
 * NOT MindBody's consumer "Add Family Member" custodian/dependent account.
 * True family accounts still require the parent to add the dependent in the
 * consumer app + a staff merge (see docs/court16-family-account-sop.html).
 */
export const PARENT_GUARDIAN_RELATIONSHIP = {
  Id: -6,
  RelationshipName1: "Parent/Guardian",
  RelationshipName2: "Child",
} as const;

/**
 * @deprecated Use PAYS_FOR_RELATIONSHIP. The old `Id: 20` Guardian value
 * does NOT exist in site 5748154's relationship catalog and triggers
 * "Relationship validation failed" on AddClient. Kept as an export
 * temporarily because two routes import it; remove after Stage G ships.
 */
export const GUARDIAN_RELATIONSHIP = {
  Id: 20,
  RelationshipName1: "Guardian",
  RelationshipName2: "Dependent",
} as const;

export interface AddClientResponse {
  Client: MindbodyClient;
}

/**
 * Create a new client record. ALWAYS call getClientsByEmail first.
 *
 * Uses Consumer Mode (Api-Key only — no staff user token) which works on
 * real MindBody sites including production Court 16 (verified May 15).
 * AddClient on real sites also rejects the Test parameter outright, so
 * we omit it — every consumer-mode AddClient on a non-sandbox site is
 * a real write. Caller must use clearly-marked test fixtures and have
 * a cleanup plan (Ibtissam deactivates via MindBody UI; no API delete).
 */
export async function addClient(
  cfg: MindbodyConfig,
  log: Logger,
  input: AddClientInput,
): Promise<MindbodyClient> {
  const res = await authedFetch<MindbodyClient & { Client?: MindbodyClient }>(cfg, log, {
    method: "POST",
    path: "/client/addclient",
    body: input,
    // Consumer-mode AddClient on real sites does NOT accept Test=true.
    // (Throws `Test mode is not allowed for this endpoint.`)
    includeTestFlag: false,
    consumerMode: true,
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
  /** ClientService instance ID from GET /client/clientservices. */
  ClientServiceId?: number;
  /** If true, waitlist if class is full instead of erroring. */
  SendEmail?: boolean;
  Waitlist?: boolean;
  CrossRegionalBookingClientId?: string | number;
}

/**
 * Book a client into a class.
 *
 * Uses Consumer Mode (Api-Key only) — verified working against site 5748154
 * May 15. No staff token round-trip needed.
 *
 * Note: like AddClient, the Test parameter is rejected on real sites.
 * Caller is responsible for using test-tagged ClientIds during smoke runs.
 */
export async function addClientToClass(
  cfg: MindbodyConfig,
  log: Logger,
  input: AddClientToClassInput,
): Promise<unknown> {
  return authedFetch(cfg, log, {
    method: "POST",
    path: "/class/addclienttoclass",
    body: input,
    includeTestFlag: false,
    consumerMode: true,
  });
}

export interface PurchaseTrialServiceInput {
  ClientId: string | number;
  ServiceId: number;
  Notes?: string;
}

export interface PurchaseTrialServiceResult {
  saleId: number;
  serviceName: string;
}

/**
 * "Purchase" a $0 trial service for a client via the shopping-cart endpoint.
 *
 * Why this exists: AddClientToClass for a class tagged with a Program that
 * requires payment (e.g. RH Program 61 "Kid's Trials") returns
 * `ClassRequiresPayment` ("ClientID X has no available payments for ClassID Y")
 * UNLESS the client owns the matching service. AddClient creates the client
 * record but doesn't grant any services — they have to be checkout'd
 * separately. This helper runs the cart checkout with a `Comp` payment of $0,
 * which atomically grants the service to the client. The subsequent
 * AddClientToClass call then succeeds with that ServiceId as ClientServiceId.
 *
 * Verified May 22 against site 5748154: kid Client 100002142, service 100328
 * (RH Kid's Trial, $0), SaleId 2772 returned → AddClientToClass succeeded
 * with Visit Id 5824.
 *
 * Requires a staff-mode Bearer token — uses `staffFetch`-equivalent auth
 * via the `useStaffBearer` flag below. (Source Credentials → staff JWT.)
 * Consumer mode is rejected by /sale/checkoutshoppingcart with
 * `InvalidPermissionConfiguration`.
 */
export async function purchaseTrialService(
  cfg: MindbodyConfig,
  log: Logger,
  input: PurchaseTrialServiceInput,
): Promise<PurchaseTrialServiceResult> {
  const bearer = await issueSourceStaffToken(cfg, log);
  const body = {
    ClientId: String(input.ClientId),
    Test: false,
    InStore: true,
    Items: [
      {
        Item: { Type: "Service", Metadata: { Id: input.ServiceId } },
        DiscountAmount: 0,
        Quantity: 1,
      },
    ],
    Payments: [
      {
        Type: "Comp",
        Metadata: { Amount: 0, Notes: input.Notes ?? "Court 16 trial — Cedarwind staff confirm" },
      },
    ],
  };
  const started = Date.now();
  const res = await fetch(`${cfg.baseUrl}/sale/checkoutshoppingcart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": cfg.apiKey,
      SiteId: cfg.siteId,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  if (!res.ok) {
    log.error("mindbody.purchase-trial.fail", {
      clientId: input.ClientId,
      serviceId: input.ServiceId,
      status: res.status,
      ms,
      body: parsed,
    });
    throw new MindbodyError(`purchase trial service → ${res.status}`, res.status, parsed);
  }
  const cart = (parsed as { ShoppingCart?: { SaleId?: number; CartItems?: Array<{ Item?: { Name?: string } }> } })
    .ShoppingCart;
  const saleId = cart?.SaleId ?? 0;
  const serviceName = cart?.CartItems?.[0]?.Item?.Name ?? "trial service";
  log.info("mindbody.purchase-trial.ok", {
    clientId: input.ClientId,
    serviceId: input.ServiceId,
    saleId,
    serviceName,
    ms,
  });
  return { saleId, serviceName };
}

/**
 * Predicate: did MindbodyError originate from a duplicate AddClientToClass
 * call (client is already enrolled in that class)? Used by the staff confirm
 * route to treat the second-click case as soft-success rather than retrying.
 */
export function isAlreadyBookedError(err: unknown): boolean {
  if (!(err instanceof MindbodyError)) return false;
  const body = (err as unknown as { body?: { Error?: { Code?: string } } }).body;
  return body?.Error?.Code === "ClientIsAlreadyBooked";
}

export function isClassRequiresPaymentError(err: unknown): boolean {
  if (!(err instanceof MindbodyError)) return false;
  const body = (err as unknown as { body?: { Error?: { Code?: string } } }).body;
  return body?.Error?.Code === "ClassRequiresPayment";
}

export interface ClientService {
  Id?: number;
  /** Sale Service / pricing-option ID that produced this client-owned instance. */
  ProductId?: number;
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
  const res = await staffFetch<GetClientServicesResponse>(cfg, log, {
    path: "/client/clientservices",
    query: { ClientId: String(clientId), Limit: 50 },
  });
  return res.ClientServices ?? [];
}

export interface ClientVisit {
  Id?: number;
  ClassId?: number;
  ClassScheduleId?: number;
  ProductId?: number;
  ServiceId?: number;
  ServiceName?: string;
  StartDateTime?: string;
  AppointmentStatus?: string;
  Status?: string;
  LateCancelled?: boolean;
  [k: string]: unknown;
}

interface GetClientVisitsResponse {
  Visits?: ClientVisit[];
}

/** Read a client's class visits without changing enrollment state. */
export async function getClientVisits(
  cfg: MindbodyConfig,
  log: Logger,
  input: { clientId: string | number; startDate: string; endDate: string },
): Promise<ClientVisit[]> {
  const res = await staffFetch<GetClientVisitsResponse>(cfg, log, {
    path: "/client/clientvisits",
    query: {
      ClientId: String(input.clientId),
      StartDate: input.startDate,
      EndDate: input.endDate,
      Limit: 200,
    },
  });
  return res.Visits ?? [];
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

/**
 * Strict variant for diagnostic endpoints that expose client data or perform
 * direct Mindbody writes. These routes are disabled unless TEST_API_TOKEN is
 * explicitly configured; public booking routes continue to use the optional
 * caller-token behavior above.
 */
export function checkDiagnosticToken(
  req: Request,
): { ok: true } | { ok: false; status: number; reason: string } {
  if (!process.env.TEST_API_TOKEN) {
    return {
      ok: false,
      status: 503,
      reason: "Diagnostic endpoint disabled (TEST_API_TOKEN is not configured)",
    };
  }
  return checkCallerToken(req);
}
