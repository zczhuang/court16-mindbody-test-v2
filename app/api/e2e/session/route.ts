import { NextResponse } from "next/server";
import {
  TRIAL_E2E_SESSION_COOKIE,
  accessTokenMatches,
  consumeTrialE2EAccessRateLimit,
  createTrialE2ESessionToken,
  getTrialE2EPolicy,
  getTrialE2EPublicDescriptor,
  isTrialE2ERequestAuthorized,
  isTrialE2ERequestHostAllowed,
  isTrialE2ERequestSecure,
  isTrialE2ESameOriginRequest,
} from "@/lib/trial-e2e/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

function unavailable() {
  return NextResponse.json(
    { ok: false, error: "Not found" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: Request) {
  const policy = getTrialE2EPolicy();
  if (!policy.allowed || !isTrialE2ERequestHostAllowed(req)) return unavailable();

  return NextResponse.json(
    {
      ok: true,
      authenticated: isTrialE2ERequestAuthorized(req, policy),
      descriptor: getTrialE2EPublicDescriptor(policy.backend),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: Request) {
  const policy = getTrialE2EPolicy();
  if (!policy.allowed || !isTrialE2ERequestHostAllowed(req)) return unavailable();
  if (!isTrialE2ESameOriginRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "Cross-origin request refused" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const rateLimit = consumeTrialE2EAccessRateLimit(req);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many access attempts" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds ?? 60),
        },
      },
    );
  }

  let accessToken: unknown;
  try {
    ({ accessToken } = (await req.json()) as { accessToken?: unknown });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!accessTokenMatches(accessToken, policy.accessToken)) {
    return NextResponse.json(
      { ok: false, error: "Invalid test access key" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const response = NextResponse.json(
    {
      ok: true,
      authenticated: true,
      descriptor: getTrialE2EPublicDescriptor(policy.backend),
    },
    { headers: NO_STORE_HEADERS },
  );
  response.cookies.set({
    name: TRIAL_E2E_SESSION_COOKIE,
    value: createTrialE2ESessionToken(policy),
    httpOnly: true,
    sameSite: "strict",
    secure: isTrialE2ERequestSecure(req),
    path: "/api/e2e",
    maxAge: 8 * 60 * 60,
  });
  return response;
}

export async function DELETE(req: Request) {
  const policy = getTrialE2EPolicy();
  if (!policy.allowed || !isTrialE2ERequestHostAllowed(req)) return unavailable();
  if (!isTrialE2ESameOriginRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "Cross-origin request refused" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const response = NextResponse.json(
    { ok: true, authenticated: false },
    { headers: NO_STORE_HEADERS },
  );
  response.cookies.set({
    name: TRIAL_E2E_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: isTrialE2ERequestSecure(req),
    path: "/api/e2e",
    maxAge: 0,
  });
  return response;
}
