import crypto from "node:crypto";

export const TRIAL_E2E_SESSION_COOKIE = "c16_trial_e2e_session";
const MINDBODY_PUBLIC_API_BASE_URL = "https://api.mindbodyonline.com/public/v6";

export type TrialE2EPolicyReason =
  | "not_enabled"
  | "production_forbidden"
  | "vercel_preview_required"
  | "local_development_required"
  | "local_flag_missing"
  | "unsupported_backend"
  | "access_token_missing"
  | "signing_secret_missing"
  | "audience_missing"
  | "production_hubspot_token_present"
  | "sandbox_site_required"
  | "sandbox_base_url_required"
  | "sandbox_writes_not_enabled"
  | "real_site_write_gate_present"
  | "sandbox_store_missing"
  | "sandbox_store_not_isolated";

export type TrialE2EPolicyResult =
  | {
      allowed: true;
      backend: "fixture" | "mindbody_sandbox";
      accessToken: string;
      signingSecret: string;
      audience: string;
      redisUrl?: string;
      redisToken?: string;
    }
  | { allowed: false; reason: TrialE2EPolicyReason };

export interface TrialE2EPolicyInput {
  enabled?: string;
  backend?: string;
  accessToken?: string;
  signingSecret?: string;
  vercel?: string;
  vercelEnv?: string;
  nodeEnv?: string;
  localEnabled?: string;
  audience?: string;
  hubspotAccessToken?: string;
  mindbodySiteId?: string;
  mindbodyBaseUrl?: string;
  sandboxWritesEnabled?: string;
  realWritesEnabled?: string;
  redisUrl?: string;
  redisToken?: string;
  productionRedisUrl?: string;
  productionRedisToken?: string;
}

/** Pure evaluator so the production and preview boundaries have regression tests. */
export function evaluateTrialE2EPolicy(
  input: TrialE2EPolicyInput,
): TrialE2EPolicyResult {
  if (input.vercelEnv === "production") {
    return { allowed: false, reason: "production_forbidden" };
  }
  if (input.vercel === "1") {
    if (input.vercelEnv !== "preview") {
      return { allowed: false, reason: "vercel_preview_required" };
    }
  } else {
    if (input.nodeEnv !== "development") {
      return { allowed: false, reason: "local_development_required" };
    }
    if (input.localEnabled !== "true") {
      return { allowed: false, reason: "local_flag_missing" };
    }
  }
  if (input.enabled !== "true") return { allowed: false, reason: "not_enabled" };
  const backend = input.backend ?? "fixture";
  if (backend !== "fixture" && backend !== "mindbody_sandbox") {
    return { allowed: false, reason: "unsupported_backend" };
  }
  if (!input.accessToken || input.accessToken.length < 32) {
    return { allowed: false, reason: "access_token_missing" };
  }
  if (!input.signingSecret || input.signingSecret.length < 32) {
    return { allowed: false, reason: "signing_secret_missing" };
  }
  if (!input.audience || input.audience.length < 8) {
    return { allowed: false, reason: "audience_missing" };
  }
  if (input.hubspotAccessToken) {
    return { allowed: false, reason: "production_hubspot_token_present" };
  }
  if (backend === "mindbody_sandbox") {
    if (input.mindbodySiteId !== "-99") {
      return { allowed: false, reason: "sandbox_site_required" };
    }
    if (
      (input.mindbodyBaseUrl ?? MINDBODY_PUBLIC_API_BASE_URL) !==
      MINDBODY_PUBLIC_API_BASE_URL
    ) {
      return { allowed: false, reason: "sandbox_base_url_required" };
    }
    if (input.sandboxWritesEnabled !== "true") {
      return { allowed: false, reason: "sandbox_writes_not_enabled" };
    }
    if (input.realWritesEnabled === "true") {
      return { allowed: false, reason: "real_site_write_gate_present" };
    }
    if (!input.redisUrl?.trim() || !input.redisToken?.trim()) {
      return { allowed: false, reason: "sandbox_store_missing" };
    }
    const e2eRedisUrl = input.redisUrl.trim().replace(/\/+$/, "");
    const productionRedisUrl = input.productionRedisUrl?.trim().replace(/\/+$/, "");
    if (
      (productionRedisUrl && e2eRedisUrl === productionRedisUrl) ||
      (input.productionRedisToken && input.redisToken === input.productionRedisToken)
    ) {
      return { allowed: false, reason: "sandbox_store_not_isolated" };
    }
  }
  return {
    allowed: true,
    backend,
    accessToken: input.accessToken,
    signingSecret: input.signingSecret,
    audience: input.audience,
    ...(backend === "mindbody_sandbox"
      ? { redisUrl: input.redisUrl, redisToken: input.redisToken }
      : {}),
  };
}

export function getTrialE2EPolicy(): TrialE2EPolicyResult {
  return evaluateTrialE2EPolicy({
    enabled: process.env.TRIAL_E2E_ENABLED,
    backend: process.env.TRIAL_E2E_BACKEND,
    accessToken: process.env.TRIAL_E2E_ACCESS_TOKEN,
    signingSecret: process.env.TRIAL_E2E_SIGNING_SECRET,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    localEnabled: process.env.TRIAL_E2E_LOCAL_ENABLED,
    audience: process.env.TRIAL_E2E_AUDIENCE,
    hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    mindbodySiteId: process.env.MINDBODY_SITE_ID,
    mindbodyBaseUrl: process.env.MINDBODY_BASE_URL,
    sandboxWritesEnabled: process.env.TRIAL_E2E_MINDBODY_WRITES_ENABLED,
    realWritesEnabled: process.env.MINDBODY_REAL_WRITES_ENABLED,
    redisUrl: process.env.E2E_UPSTASH_REDIS_REST_URL,
    redisToken: process.env.E2E_UPSTASH_REDIS_REST_TOKEN,
    productionRedisUrl: process.env.UPSTASH_REDIS_REST_URL,
    productionRedisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

function base64urlEncode(value: Buffer): string {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signSessionBody(body: string, signingSecret: string): string {
  return base64urlEncode(
    crypto.createHmac("sha256", signingSecret).update(`session:${body}`).digest(),
  );
}

export function accessTokenMatches(candidate: unknown, expected: string): boolean {
  return typeof candidate === "string" && safeEqual(candidate, expected);
}

export function createTrialE2ESessionToken(
  policy: Extract<TrialE2EPolicyResult, { allowed: true }>,
  now = new Date(),
): string {
  const payload = {
    v: 1,
    purpose: "trial_e2e_session",
    aud: policy.audience,
    backend: policy.backend,
    accessKeyHash: crypto.createHash("sha256").update(policy.accessToken).digest("hex"),
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 8 * 60 * 60,
  };
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${signSessionBody(body, policy.signingSecret)}`;
}

export function verifyTrialE2ESessionToken(
  token: string | undefined,
  policy: Extract<TrialE2EPolicyResult, { allowed: true }>,
  now = new Date(),
): boolean {
  if (!token) return false;
  const [body, signature, ...extra] = token.split(".");
  if (!body || !signature || extra.length > 0) return false;
  if (!safeEqual(signature, signSessionBody(body, policy.signingSecret))) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      v?: unknown;
      purpose?: unknown;
      aud?: unknown;
      backend?: unknown;
      accessKeyHash?: unknown;
      iat?: unknown;
      exp?: unknown;
    };
    const expectedAccessKeyHash = crypto
      .createHash("sha256")
      .update(policy.accessToken)
      .digest("hex");
    return (
      payload.v === 1 &&
      payload.purpose === "trial_e2e_session" &&
      payload.aud === policy.audience &&
      payload.backend === policy.backend &&
      payload.accessKeyHash === expectedAccessKeyHash &&
      typeof payload.iat === "number" &&
      payload.iat <= Math.floor(now.getTime() / 1000) + 300 &&
      typeof payload.exp === "number" &&
      payload.exp * 1000 >= now.getTime()
    );
  } catch {
    return false;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

export function isTrialE2ERequestAuthorized(
  req: Request,
  policy: Extract<TrialE2EPolicyResult, { allowed: true }>,
): boolean {
  return verifyTrialE2ESessionToken(
    readCookie(req, TRIAL_E2E_SESSION_COOKIE),
    policy,
  );
}

export function isTrialE2ESameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    const forwardedProtocol = req.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const requestProtocol = forwardedProtocol || new URL(req.url).protocol.slice(0, -1);
    return originUrl.host === host && originUrl.protocol === `${requestProtocol}:`;
  } catch {
    return false;
  }
}

export function isTrialE2ERequestSecure(req: Request): boolean {
  const forwardedProtocol = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return forwardedProtocol
    ? forwardedProtocol === "https"
    : new URL(req.url).protocol === "https:";
}

export function isTrialE2EHostAllowed(
  host: string | null,
  vercel = process.env.VERCEL,
): boolean {
  if (vercel === "1") return true;
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isTrialE2ERequestHostAllowed(req: Request): boolean {
  return isTrialE2EHostAllowed(req.headers.get("host"));
}

const accessAttempts = new Map<string, number[]>();

export function consumeTrialE2EAccessRateLimit(req: Request): {
  ok: boolean;
  retryAfterSeconds?: number;
} {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const key = crypto.createHash("sha256").update(`e2e-access:${ip}`).digest("hex");
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const recent = (accessAttempts.get(key) ?? []).filter((value) => value > now - windowMs);
  if (recent.length >= 5) {
    accessAttempts.set(key, recent);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)),
    };
  }
  recent.push(now);
  accessAttempts.set(key, recent);
  if (accessAttempts.size > 2000) {
    const oldest = accessAttempts.keys().next().value;
    if (typeof oldest === "string") accessAttempts.delete(oldest);
  }
  return { ok: true };
}

export function getTrialE2EPublicDescriptor(
  backend: "fixture" | "mindbody_sandbox",
) {
  return {
    backend,
    crmTarget: "signed deterministic test ledger",
    mindbodyTarget:
      backend === "mindbody_sandbox"
        ? "Mindbody public sandbox · Site -99 only"
        : "deterministic test adapter",
    staffAction: "direct in-browser test action",
    notifications: {
      court16HubspotAdapterInvoked: false,
      court16StaffNotifierInvoked: false,
      court16AdminNotifierInvoked: false,
    },
  } as const;
}
