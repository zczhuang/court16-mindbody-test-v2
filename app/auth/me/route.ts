import { NextResponse } from "next/server";
import { loadOAuthConfig, refreshTokens } from "@/lib/mindbody-oauth";
import { clearSession, getSession, setSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Refresh the access token if it expires within this window.
const REFRESH_SKEW_MS = 60 * 1000;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Auto-refresh if access token is about to expire.
  if (session.refreshToken && session.expiresAt - Date.now() < REFRESH_SKEW_MS) {
    try {
      const cfg = loadOAuthConfig();
      const tokens = await refreshTokens(cfg, session.refreshToken);
      await setSession({
        ...session,
        accessToken: tokens.access_token,
        // MindBody may rotate the refresh token; keep the old one if absent.
        refreshToken: tokens.refresh_token ?? session.refreshToken,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });
      session.accessToken = tokens.access_token;
      session.expiresAt = Date.now() + tokens.expires_in * 1000;
    } catch {
      // Refresh failed (revoked, expired, etc.) — drop the session.
      await clearSession();
      return NextResponse.json({ authenticated: false, reason: "refresh_failed" }, { status: 401 });
    }
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      clientId: session.clientId,
      firstName: session.firstName,
      lastName: session.lastName,
      email: session.email,
      homeLocationId: session.homeLocationId,
    },
  });
}
