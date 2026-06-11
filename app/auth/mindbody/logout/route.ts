import { NextRequest, NextResponse } from "next/server";
import { loadOAuthConfig, revokeToken } from "@/lib/mindbody-oauth";
import { clearSession, getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const session = await getSession();
  if (session) {
    try {
      const cfg = loadOAuthConfig();
      if (session.refreshToken) {
        await revokeToken(cfg, session.refreshToken, "refresh_token");
      }
      await revokeToken(cfg, session.accessToken, "access_token");
    } catch {
      // Best-effort revoke; never block local logout on remote failure.
    }
  }
  await clearSession();
  return NextResponse.redirect(new URL("/redesign/", req.url));
}

export const GET = handle;
export const POST = handle;
