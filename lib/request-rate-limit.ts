/**
 * Best-effort per-instance signup throttling.
 *
 * This protects accidental retries and basic abuse without adding a network
 * dependency. Production should also enforce a distributed edge/WAF limit;
 * serverless instances do not share this in-memory store.
 */

type BucketStore = Map<string, number[]>;

const globalBuckets = globalThis as typeof globalThis & {
  __court16SignupRateBuckets?: BucketStore;
};

const buckets =
  globalBuckets.__court16SignupRateBuckets ??
  (globalBuckets.__court16SignupRateBuckets = new Map<string, number[]>());

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds?: number;
}

function consume(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const cutoff = now - windowMs;
  const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= limit) {
    const retryAt = recent[0] + windowMs;
    buckets.set(key, recent);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
    };
  }
  recent.push(now);
  buckets.set(key, recent);

  // Bound memory on long-lived instances. Oldest insertion order is good
  // enough because every active bucket also self-prunes above.
  if (buckets.size > 10_000) {
    const oldest = buckets.keys().next().value;
    if (typeof oldest === "string") buckets.delete(oldest);
  }
  return { ok: true };
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function consumeSignupRateLimit(
  req: Request,
  scope: "kid-trial" | "adult-intro",
  email: string,
): RateLimitResult {
  const now = Date.now();
  const normalizedEmail = email.trim().toLowerCase();
  const ipResult = consume(`${scope}:ip:${clientIp(req)}`, 10, 60 * 60 * 1000, now);
  if (!ipResult.ok) return ipResult;
  return consume(`${scope}:email:${normalizedEmail}`, 3, 60 * 60 * 1000, now);
}
