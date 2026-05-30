import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  generatePkce,
  generateState,
  loadOAuthConfig,
} from "@/lib/mindbody-oauth";
import { setOAuthPending } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where members go when our own MindBody OAuth client isn't provisioned
// yet (pending Anthony authorizing the dev Api-Key against the production
// Site IDs — see .env.example). Court 16's existing hosted member login.
const FALLBACK_LOGIN_URL = "https://www.court16.com/login";

export async function GET(req: NextRequest) {
  // Where to send the user after a successful login. Default to redesign home.
  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "/redesign/";
  // Only allow same-origin paths.
  const safeReturnTo =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/redesign/";

  // loadOAuthConfig throws when MINDBODY_CLIENT_ID/SECRET/REDIRECT_URI are
  // unset. Rather than surfacing a 500 to anyone who clicks "Sign in",
  // fall back to Court 16's hosted login. Once the OAuth client is wired
  // up in Vercel env, this path runs the real PKCE authorize flow instead.
  let cfg;
  try {
    cfg = loadOAuthConfig();
  } catch {
    return NextResponse.redirect(FALLBACK_LOGIN_URL);
  }

  try {
    const state = generateState();
    const { verifier, challenge } = generatePkce();
    await setOAuthPending({ state, codeVerifier: verifier, returnTo: safeReturnTo });
    return NextResponse.redirect(buildAuthorizeUrl(cfg, state, challenge));
  } catch {
    // Any failure building the authorize URL or persisting session state
    // also degrades to the hosted login rather than crashing.
    return NextResponse.redirect(FALLBACK_LOGIN_URL);
  }
}
