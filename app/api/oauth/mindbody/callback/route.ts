import { NextRequest, NextResponse } from "next/server";
import {
  decodeIdToken,
  exchangeCodeForToken,
  loadOAuthConfigFromEnv,
} from "@/lib/mindbody-oauth";
import { getOAuthSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/mindbody/callback
 *
 * MindBody Identity Service posts back the authorization code + id_token
 * via form_post (per response_mode=form_post in the authorize URL). We
 * verify state, exchange the code for tokens, decode the id_token claims,
 * store everything in the session, and redirect the parent back to the
 * page they came from (the wizard).
 */
export async function POST(request: NextRequest) {
  return handleCallback(request);
}

// Some MindBody flows send GET callbacks; support both.
export async function GET(request: NextRequest) {
  return handleCallback(request);
}

async function handleCallback(request: NextRequest) {
  const cfg = loadOAuthConfigFromEnv();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "OAuth not provisioned" },
      { status: 503 },
    );
  }

  // form_post sends body; GET fallback uses query
  let code: string | null = null;
  let state: string | null = null;
  let idToken: string | null = null;
  if (request.method === "POST") {
    const form = await request.formData();
    code = form.get("code") as string | null;
    state = form.get("state") as string | null;
    idToken = form.get("id_token") as string | null;
  } else {
    const { searchParams } = new URL(request.url);
    code = searchParams.get("code");
    state = searchParams.get("state");
    idToken = searchParams.get("id_token");
  }

  if (!code || !state) {
    return NextResponse.json(
      { ok: false, error: "Missing code or state from MindBody Identity Service" },
      { status: 400 },
    );
  }

  const session = await getOAuthSession();
  const expectedState = session.state;
  const expectedNonce = session.nonce;
  const next = (session as unknown as { next?: string }).next ?? "/trial";

  if (state !== expectedState) {
    return NextResponse.json(
      { ok: false, error: "state mismatch — possible CSRF" },
      { status: 400 },
    );
  }

  try {
    const tokenResp = await exchangeCodeForToken(cfg, code);
    let claims = null;
    if (idToken) {
      claims = decodeIdToken(idToken);
      if (claims?.nonce && claims.nonce !== expectedNonce) {
        return NextResponse.json(
          { ok: false, error: "nonce mismatch — possible token replay" },
          { status: 400 },
        );
      }
    }

    session.accessToken = tokenResp.access_token;
    session.refreshToken = tokenResp.refresh_token;
    session.expiresAt = Date.now() + tokenResp.expires_in * 1000;
    if (claims) {
      session.email = claims.email;
      session.givenName = claims.given_name;
      session.familyName = claims.family_name;
      session.mindbodyUserId = claims.sub;
    }
    // Clear the one-time CSRF artifacts
    session.state = undefined;
    session.nonce = undefined;
    await session.save();

    return NextResponse.redirect(new URL(next, request.url), 302);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "Token exchange failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
