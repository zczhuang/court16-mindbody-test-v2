/**
 * Iron-session OAuth session store.
 *
 * Holds the access_token + refresh_token + id_token claims after a
 * successful MindBody OAuth roundtrip. Encrypted via SESSION_SECRET
 * and stored as an HttpOnly cookie.
 */

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface OAuthSessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  email?: string;
  givenName?: string;
  familyName?: string;
  mindbodyUserId?: string; // sub claim
  state?: string;
  nonce?: string;
  /** Set after a successful booking so we know the form was completed. */
  completedCorrelationId?: string;
}

const COOKIE_NAME = "court16_oauth_session";

function getSessionOptions() {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET env var must be set and >= 32 chars");
  }
  return {
    cookieName: COOKIE_NAME,
    password,
    cookieOptions: {
      httpOnly: true,
      // CRITICAL: MindBody's OAuth callback uses response_mode=form_post,
      // which is a CROSS-SITE POST back to our /api/oauth/mindbody/callback.
      // Modern browsers do NOT send SameSite=Lax cookies on cross-site POSTs
      // (only on top-level GET navigations) — that's how SameSite=Lax was
      // tightened post-2020. So the state cookie set during /start never
      // arrives at the callback, and we fail with "state mismatch — possible
      // CSRF" (caught May 25 by Stuart's first OAuth round-trip test).
      //
      // Fix: SameSite=None permits the cross-site POST. Required-pair with
      // Secure=true (modern browsers reject SameSite=None without Secure).
      // Cookie is still HttpOnly + iron-session encrypted so XSS can't read
      // it; cross-site CSRF protection is provided by the OAuth `state`
      // parameter itself (which is the whole point of this cookie carrying
      // the state).
      sameSite: "none" as const,
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  };
}

export async function getOAuthSession() {
  const cookieStore = await cookies();
  return getIronSession<OAuthSessionData>(cookieStore, getSessionOptions());
}
