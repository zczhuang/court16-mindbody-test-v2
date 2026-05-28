import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Temporary: report which auth env vars Vercel is exposing. No secret values. */
export async function GET() {
  const want = [
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_OIDC_TOKEN",
    "GCP_PROJECT_ID",
    "GCP_REGION",
    "GCP_WORKLOAD_IDENTITY_PROVIDER",
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "CHATBOT_GEMINI_MODEL",
  ];
  const out: Record<string, string | null> = {};
  for (const k of want) {
    const v = process.env[k];
    out[k] = v === undefined ? null : `len=${v.length}`;
  }
  return NextResponse.json(out);
}
