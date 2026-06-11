// MindBody OAuth 2.0 / OIDC client.
//
// MindBody runs its identity server at signin.mindbodyonline.com (IdentityServer4).
// Flow: authorization_code + PKCE (S256).  After exchange we get an access_token
// that's accepted by the Public API v6 as a user token (in addition to the
// site-scoped Api-Key + SiteId headers).
//
// Scopes per task spec: subscriber:read class:read enrollment:read client:read
// client:write — plus openid email profile offline_access for OIDC + refresh.

import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://signin.mindbodyonline.com/connect/authorize";
const TOKEN_URL = "https://signin.mindbodyonline.com/connect/token";
const REVOKE_URL = "https://signin.mindbodyonline.com/connect/revocation";

const DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "subscriber:read",
  "class:read",
  "enrollment:read",
  "client:read",
  "client:write",
];

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  siteId: string;
  scopes: string[];
}

export function loadOAuthConfig(): OAuthConfig {
  const required = ["MINDBODY_CLIENT_ID", "MINDBODY_CLIENT_SECRET", "MINDBODY_REDIRECT_URI"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing OAuth env vars: ${missing.join(", ")}. See .env.example.`);
  }
  // OAuth flow targets a specific production site (e.g. Ridgehill 5748154) —
  // separate from MINDBODY_SITE_ID which may still point at the -99 sandbox
  // for legacy happy-path code.
  const siteId = process.env.MINDBODY_OAUTH_SITE_ID ?? process.env.MINDBODY_SITE_ID;
  if (!siteId) {
    throw new Error("Set MINDBODY_OAUTH_SITE_ID (preferred) or MINDBODY_SITE_ID for the OAuth target site");
  }
  return {
    clientId: process.env.MINDBODY_CLIENT_ID!,
    clientSecret: process.env.MINDBODY_CLIENT_SECRET!,
    redirectUri: process.env.MINDBODY_REDIRECT_URI!,
    siteId,
    scopes: DEFAULT_SCOPES,
  };
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildAuthorizeUrl(cfg: OAuthConfig, state: string, codeChallenge: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", cfg.scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  // MindBody-specific: scope the auth to a site so the user lands at the right club.
  u.searchParams.set("subscriberId", cfg.siteId);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: string;
  scope?: string;
  id_token?: string;
}

async function postForm(url: string, body: Record<string, string>, cfg: OAuthConfig): Promise<Response> {
  const params = new URLSearchParams(body);
  // Client credentials via Basic — IdentityServer accepts both header and body.
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
    cache: "no-store",
  });
}

export async function exchangeCode(cfg: OAuthConfig, code: string, codeVerifier: string): Promise<TokenResponse> {
  const res = await postForm(
    TOKEN_URL,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: codeVerifier,
      client_id: cfg.clientId,
    },
    cfg,
  );
  if (!res.ok) {
    throw new Error(`MindBody token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshTokens(cfg: OAuthConfig, refreshToken: string): Promise<TokenResponse> {
  const res = await postForm(
    TOKEN_URL,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: cfg.clientId,
    },
    cfg,
  );
  if (!res.ok) {
    throw new Error(`MindBody token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function revokeToken(cfg: OAuthConfig, token: string, hint: "access_token" | "refresh_token"): Promise<void> {
  // Best-effort; ignore failures so logout always succeeds locally.
  try {
    await postForm(REVOKE_URL, { token, token_type_hint: hint }, cfg);
  } catch {
    /* swallow */
  }
}

// Fetch the authenticated client's profile via Public API v6.
// The OAuth access_token is sent as a bearer; the site-scoped Api-Key + SiteId
// are still required headers per MindBody's v6 spec.
export interface MindbodyClientProfile {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  homeLocationId: number | null;
}

export async function fetchClientProfile(accessToken: string): Promise<MindbodyClientProfile> {
  const apiKey = process.env.MINDBODY_API_KEY;
  // Profile fetch must use the same site the OAuth token was issued against.
  const siteId = process.env.MINDBODY_OAUTH_SITE_ID ?? process.env.MINDBODY_SITE_ID;
  const baseUrl = process.env.MINDBODY_BASE_URL ?? "https://api.mindbodyonline.com/public/v6";
  if (!apiKey || !siteId) {
    throw new Error("MINDBODY_API_KEY and a site ID (MINDBODY_OAUTH_SITE_ID or MINDBODY_SITE_ID) must be set");
  }

  // With an OAuth user token, `GET /client/clients` (no IDs) returns the
  // current authenticated client.
  const res = await fetch(`${baseUrl}/client/clients?limit=1`, {
    headers: {
      "Api-Key": apiKey,
      SiteId: siteId,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Fetch client profile failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    Clients?: Array<{
      Id?: string;
      UniqueId?: number;
      FirstName?: string;
      LastName?: string;
      Email?: string;
      HomeLocation?: { Id?: number };
    }>;
  };
  const c = data.Clients?.[0];
  if (!c) throw new Error("MindBody returned no client for authenticated user");
  return {
    clientId: c.Id ?? String(c.UniqueId ?? ""),
    firstName: c.FirstName ?? "",
    lastName: c.LastName ?? "",
    email: c.Email ?? "",
    homeLocationId: c.HomeLocation?.Id ?? null,
  };
}
