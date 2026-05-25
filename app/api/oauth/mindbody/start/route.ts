import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  generateNonce,
  generateState,
  loadOAuthConfigFromEnv,
} from "@/lib/mindbody-oauth";
import { getOAuthSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/mindbody/start?email=parent@example.com&next=/trial
 *
 * Begins the MindBody Identity Service OAuth flow. Generates state +
 * nonce, stores them in the session cookie, then 302s to MindBody's
 * authorize endpoint with the parent's email pre-filled (so they
 * don't re-type on MindBody's signup page).
 */
export async function GET(request: NextRequest) {
  const cfg = loadOAuthConfigFromEnv();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: "MindBody OAuth not provisioned yet",
        detail:
          "Set MINDBODY_OAUTH_CLIENT_ID, MINDBODY_OAUTH_CLIENT_SECRET, MINDBODY_OAUTH_SUBSCRIBER_ID, MINDBODY_OAUTH_REDIRECT_URI. Provisioning requested from MindBody API Support; lead time 1-2 business days.",
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email") ?? undefined;
  const next = searchParams.get("next") ?? "/trial";

  const state = generateState();
  const nonce = generateNonce();

  const session = await getOAuthSession();
  session.state = state;
  session.nonce = nonce;
  // Remember where to send them after callback
  (session as unknown as { next?: string }).next = next;
  await session.save();

  const authorizeUrl = buildAuthorizeUrl(cfg, { state, nonce, loginHint: email });
  return NextResponse.redirect(authorizeUrl, 302);
}
