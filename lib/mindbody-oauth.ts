/**
 * MindBody Identity Service OAuth (OpenID Connect hybrid flow, Stage J).
 *
 * Pattern from mindbody/PartnerOAuthWebApp sample. The end-state UX:
 * parent clicks "Sign in with Mindbody" → redirected to MindBody's
 * universal Identity sign-up/sign-in → returned to our app with an
 * authorization code + id_token → we exchange for an access_token
 * that we then forward when calling AddClient. This skips MindBody's
 * "Link your account" auto-email entirely — the Client is associated
 * with the user's universal Account at creation time.
 *
 * Prereq (not in code): MindBody API Support provisions an OAuth client
 * for our redirect_uri. Lead time 1-2 business days. Without those
 * credentials, the routes that call into this file return 503 with a
 * "OAuth not provisioned yet" message.
 */

import { randomBytes } from "crypto";

const MINDBODY_IDENTITY_BASE = "https://signin.mindbodyonline.com";
const AUTHORIZE_PATH = "/connect/authorize";
const TOKEN_PATH = "/connect/token";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  subscriberId: string; // MindBody-assigned per-partner identifier
  redirectUri: string;
}

export function loadOAuthConfigFromEnv(): OAuthConfig | null {
  const clientId = process.env.MINDBODY_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MINDBODY_OAUTH_CLIENT_SECRET;
  const subscriberId = process.env.MINDBODY_OAUTH_SUBSCRIBER_ID;
  const redirectUri = process.env.MINDBODY_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !subscriberId || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, subscriberId, redirectUri };
}

// ─── Authorize URL ─────────────────────────────────────────────────────────────

// Allowed scopes on the OAuth client (per developers.mindbodyonline.com →
// API Credentials → Court16-oauth client, verified May 25 by Stuart):
//   email · openid · profile · Mindbody.Api.Public.v6 · Platform.*
// `offline_access` is NOT in the allowed list — requesting it returns
// `invalid_scope`. Skip refresh tokens; access_token's 1h lifetime is
// plenty for the ~5-min wizard session. Future bookings re-trigger OAuth.
const REQUIRED_SCOPES = [
  "email",
  "profile",
  "openid",
  "Mindbody.Api.Public.v6",
].join(" ");

export interface AuthorizeUrlOptions {
  /** Random per-request value to mitigate CSRF. Store in session, verify on callback. */
  state: string;
  /** Random per-request value to mitigate token replay. Store in session, verify against id_token claim. */
  nonce: string;
  /** Pre-fill the parent's email to skip them re-typing (we collected it on /trial step 1). */
  loginHint?: string;
}

export function buildAuthorizeUrl(cfg: OAuthConfig, opts: AuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code id_token",
    scope: REQUIRED_SCOPES,
    redirect_uri: cfg.redirectUri,
    state: opts.state,
    nonce: opts.nonce,
    subscriberId: cfg.subscriberId,
    response_mode: "form_post",
  });
  if (opts.loginHint) {
    params.set("login_hint", opts.loginHint);
  }
  return `${MINDBODY_IDENTITY_BASE}${AUTHORIZE_PATH}?${params.toString()}`;
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

// ─── Token exchange ────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string; // "Bearer"
  expires_in: number; // seconds
  scope?: string;
}

export class OAuthTokenError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "OAuthTokenError";
    this.status = status;
    this.body = body;
  }
}

export async function exchangeCodeForToken(
  cfg: OAuthConfig,
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(`${MINDBODY_IDENTITY_BASE}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave */
  }
  if (!res.ok) {
    throw new OAuthTokenError(
      `Token exchange failed: ${res.status}`,
      res.status,
      parsed,
    );
  }
  return parsed as TokenResponse;
}

export async function refreshAccessToken(
  cfg: OAuthConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(`${MINDBODY_IDENTITY_BASE}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave */
  }
  if (!res.ok) {
    throw new OAuthTokenError(
      `Refresh failed: ${res.status}`,
      res.status,
      parsed,
    );
  }
  return parsed as TokenResponse;
}

// ─── ID token decoder (claims extraction, no signature verification yet) ───────
// TODO: add JWKS-based id_token signature verification before production.
// For now we trust the token because it came from a verified-host TLS exchange
// against signin.mindbodyonline.com.

export interface IdTokenClaims {
  sub?: string; // MindBody universal user ID
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  nonce?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export function decodeIdToken(idToken: string): IdTokenClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as IdTokenClaims;
  } catch {
    return null;
  }
}
