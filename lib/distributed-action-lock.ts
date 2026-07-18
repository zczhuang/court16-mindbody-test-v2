import { createHash, randomUUID } from "node:crypto";

const DEFAULT_TTL_SECONDS = 15 * 60;
const REQUEST_TIMEOUT_MS = 5_000;
const RELEASE_SCRIPT =
  'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';

type LockFailureCode = "not_configured" | "unavailable" | "invalid_response";

export class DistributedActionLockError extends Error {
  readonly code: LockFailureCode;

  constructor(code: LockFailureCode, message: string) {
    super(message);
    this.name = "DistributedActionLockError";
    this.code = code;
  }
}

export interface DistributedActionLockHandle {
  /** Privacy-safe Redis key; the original email/correlation scope is never stored. */
  readonly key: string;
  release(): Promise<void>;
}

interface RedisRestConfig {
  url: string;
  token: string;
}

interface RedisRestResponse {
  result?: unknown;
  error?: unknown;
}

/** Deterministic, privacy-safe key for one logical mutation scope. */
export function distributedActionLockKey(scope: string): string {
  const normalized = scope.trim().toLowerCase();
  if (!normalized) {
    throw new DistributedActionLockError(
      "not_configured",
      "The distributed mutation lock scope is empty.",
    );
  }
  const digest = createHash("sha256")
    .update(`court16-action-lock:v1\0${normalized}`)
    .digest("hex");
  return `court16:action-lock:v1:${digest}`;
}

/**
 * Acquire a cross-instance lock with Redis SET NX EX.
 *
 * Returns null only when another owner currently holds the lock. Missing
 * configuration, transport errors, and ambiguous responses throw so callers
 * can fail closed before any HubSpot or Mindbody mutation.
 */
export async function acquireDistributedActionLock(
  scope: string,
  options: { ttlSeconds?: number; fetchImpl?: typeof fetch } = {},
): Promise<DistributedActionLockHandle | null> {
  const config = loadRedisRestConfig();
  const key = distributedActionLockKey(scope);
  const ownerToken = randomUUID();
  const ttlSeconds = normalizeTtl(options.ttlSeconds);
  const command = ["SET", key, ownerToken, "NX", "EX", String(ttlSeconds)];
  const response = await redisCommand(config, command, options.fetchImpl ?? fetch);

  if (response.result === null) return null;
  if (response.result !== "OK") {
    throw new DistributedActionLockError(
      "invalid_response",
      "The distributed lock service returned an ambiguous acquire result.",
    );
  }

  let released = false;
  return {
    key,
    async release() {
      if (released) return;
      released = true;
      const releaseResponse = await redisCommand(
        config,
        ["EVAL", RELEASE_SCRIPT, "1", key, ownerToken],
        options.fetchImpl ?? fetch,
      );
      if (releaseResponse.result !== 0 && releaseResponse.result !== 1) {
        throw new DistributedActionLockError(
          "invalid_response",
          "The distributed lock service returned an ambiguous release result.",
        );
      }
    },
  };
}

/**
 * Convenience wrapper for staff actions. Release errors are reported but do
 * not replace a completed action result; the lock also has a bounded TTL.
 */
export async function withDistributedActionLock<T>(
  scope: string,
  action: () => Promise<T>,
  options: {
    ttlSeconds?: number;
    fetchImpl?: typeof fetch;
    onReleaseError?: (error: unknown) => void;
  } = {},
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const handle = await acquireDistributedActionLock(scope, options);
  if (!handle) return { acquired: false };

  let actionFailed = false;
  let actionError: unknown;
  let value!: T;
  try {
    value = await action();
  } catch (error) {
    actionFailed = true;
    actionError = error;
  } finally {
    try {
      await handle.release();
    } catch (error) {
      try {
        options.onReleaseError?.(error);
      } catch {
        // Observability must not replace the already-completed action result.
      }
    }
  }

  if (actionFailed) throw actionError;
  return { acquired: true, value };
}

function loadRedisRestConfig(): RedisRestConfig {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    throw new DistributedActionLockError(
      "not_configured",
      "The distributed mutation lock is not configured.",
    );
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error();
  } catch {
    throw new DistributedActionLockError(
      "not_configured",
      "The distributed mutation lock URL is invalid.",
    );
  }
  return { url, token };
}

function normalizeTtl(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60 * 60) {
    throw new DistributedActionLockError(
      "not_configured",
      "The distributed mutation lock TTL is invalid.",
    );
  }
  return value;
}

async function redisCommand(
  config: RedisRestConfig,
  command: string[],
  fetchImpl: typeof fetch,
): Promise<RedisRestResponse> {
  let response: Response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DistributedActionLockError(
      "unavailable",
      "The distributed mutation lock could not be reached.",
    );
  }

  if (!response.ok) {
    throw new DistributedActionLockError(
      "unavailable",
      `The distributed mutation lock returned HTTP ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DistributedActionLockError(
      "invalid_response",
      "The distributed mutation lock returned invalid JSON.",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DistributedActionLockError(
      "invalid_response",
      "The distributed mutation lock returned an invalid response.",
    );
  }
  const parsed = body as RedisRestResponse;
  if (parsed.error !== undefined && parsed.error !== null) {
    throw new DistributedActionLockError(
      "unavailable",
      "The distributed mutation lock rejected the command.",
    );
  }
  if (!("result" in parsed)) {
    throw new DistributedActionLockError(
      "invalid_response",
      "The distributed mutation lock response omitted its result.",
    );
  }
  return parsed;
}
