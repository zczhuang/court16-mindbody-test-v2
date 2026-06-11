import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode,
  fetchClientProfile,
  loadOAuthConfig,
} from "@/lib/mindbody-oauth";
import { consumeOAuthPending, setSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return errorRedirect(req, `mindbody returned error: ${error}`);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return errorRedirect(req, "missing code or state");
  }

  const pending = await consumeOAuthPending();
  if (!pending) {
    return errorRedirect(req, "oauth session expired — please retry");
  }
  if (pending.state !== state) {
    return errorRedirect(req, "state mismatch");
  }

  const cfg = loadOAuthConfig();
  const tokens = await exchangeCode(cfg, code, pending.codeVerifier);
  if (!tokens.refresh_token) {
    // offline_access was requested; if MindBody declined it, the session
    // simply won't auto-refresh and will expire when access_token does.
    // We still proceed.
  }

  const profile = await fetchClientProfile(tokens.access_token);

  await setSession({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: Date.now() + tokens.expires_in * 1000,
    clientId: profile.clientId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    homeLocationId: profile.homeLocationId,
  });

  return NextResponse.redirect(new URL(pending.returnTo, req.url));
}

function errorRedirect(req: NextRequest, message: string) {
  const u = new URL("/redesign/", req.url);
  u.searchParams.set("auth_error", message);
  return NextResponse.redirect(u);
}
