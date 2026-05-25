import { NextResponse } from "next/server";
import { getOAuthSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/mindbody/session
 *
 * Probe whether the current visitor has a valid OAuth session.
 * Returns { signedIn, email?, givenName?, familyName? } — never the token itself.
 */
export async function GET() {
  try {
    const session = await getOAuthSession();
    if (!session.accessToken || (session.expiresAt && session.expiresAt < Date.now())) {
      return NextResponse.json({ signedIn: false });
    }
    return NextResponse.json({
      signedIn: true,
      email: session.email,
      givenName: session.givenName,
      familyName: session.familyName,
    });
  } catch {
    // SESSION_SECRET not set or other env issue
    return NextResponse.json({ signedIn: false, reason: "session-not-configured" });
  }
}
