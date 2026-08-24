import { NextResponse } from "next/server";
import { makeTrialE2EFixtureClass } from "@/lib/trial-e2e/fixtures";
import {
  getTrialE2EPolicy,
  isTrialE2ERequestAuthorized,
  isTrialE2ERequestHostAllowed,
} from "@/lib/trial-e2e/policy";
import { getTrialE2ESandboxFixtureClass } from "@/lib/trial-e2e/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

export async function GET(req: Request) {
  const policy = getTrialE2EPolicy();
  if (!policy.allowed || !isTrialE2ERequestHostAllowed(req)) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (!isTrialE2ERequestAuthorized(req, policy)) {
    return NextResponse.json(
      { ok: false, error: "Test session expired" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const fixtureClass =
      policy.backend === "mindbody_sandbox"
        ? await getTrialE2ESandboxFixtureClass()
        : makeTrialE2EFixtureClass();
    return NextResponse.json(
      { ok: true, class: fixtureClass },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "The protected test class is unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
