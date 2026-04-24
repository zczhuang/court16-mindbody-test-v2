import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — sanity check. Also reports whether env vars are present. */
export async function GET() {
  const envCheck = {
    MINDBODY_API_KEY: Boolean(process.env.MINDBODY_API_KEY),
    MINDBODY_SITE_ID: Boolean(process.env.MINDBODY_SITE_ID),
    MINDBODY_STAFF_USERNAME: Boolean(process.env.MINDBODY_STAFF_USERNAME),
    MINDBODY_STAFF_PASSWORD: Boolean(process.env.MINDBODY_STAFF_PASSWORD),
    MINDBODY_BASE_URL: process.env.MINDBODY_BASE_URL ?? "(default)",
    MINDBODY_WRITE_MODE: process.env.MINDBODY_WRITE_MODE ?? "(default: test)",
    TEST_API_TOKEN: Boolean(process.env.TEST_API_TOKEN),
  };
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), env: envCheck });
}
