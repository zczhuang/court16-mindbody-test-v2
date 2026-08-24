export type MindbodyWriteGuardReason =
  | "production_sandbox_forbidden"
  | "real_writes_disabled"
  | "site_not_allowlisted";

export type MindbodyWriteGuardResult =
  | { allowed: true; target: "sandbox" | "real_site" }
  | { allowed: false; reason: MindbodyWriteGuardReason };

interface EvaluateMindbodyWriteGuardInput {
  siteId: string | number;
  vercelEnv?: string;
  realWritesEnabled?: string;
  allowedSiteIds?: string;
}

function parseSiteAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/**
 * Application-level safety boundary for irreversible Mindbody writes.
 * Mindbody's Test flag is endpoint-specific and cannot provide this guarantee.
 */
export function evaluateMindbodyWriteGuard({
  siteId,
  vercelEnv,
  realWritesEnabled,
  allowedSiteIds,
}: EvaluateMindbodyWriteGuardInput): MindbodyWriteGuardResult {
  const normalizedSiteId = String(siteId).trim();

  if (normalizedSiteId === "-99") {
    if (vercelEnv === "production") {
      return { allowed: false, reason: "production_sandbox_forbidden" };
    }
    return { allowed: true, target: "sandbox" };
  }

  if (realWritesEnabled !== "true") {
    return { allowed: false, reason: "real_writes_disabled" };
  }
  if (!parseSiteAllowlist(allowedSiteIds).has(normalizedSiteId)) {
    return { allowed: false, reason: "site_not_allowlisted" };
  }
  return { allowed: true, target: "real_site" };
}

export function getMindbodyWriteGuard(siteId: string | number): MindbodyWriteGuardResult {
  return evaluateMindbodyWriteGuard({
    siteId,
    vercelEnv: process.env.VERCEL_ENV,
    realWritesEnabled: process.env.MINDBODY_REAL_WRITES_ENABLED,
    allowedSiteIds: process.env.MINDBODY_REAL_WRITE_SITE_IDS,
  });
}

export class MindbodyWriteBlockedError extends Error {
  readonly code = "mindbody_write_blocked";
  readonly operation: string;
  readonly siteId: string;
  readonly reason: MindbodyWriteGuardReason;

  constructor(
    operation: string,
    siteId: string,
    reason: MindbodyWriteGuardReason,
  ) {
    super(`Mindbody ${operation} blocked for Site ${siteId}: ${reason}`);
    this.name = "MindbodyWriteBlockedError";
    this.operation = operation;
    this.siteId = siteId;
    this.reason = reason;
  }
}

export function assertMindbodyWriteAllowed(
  siteId: string | number,
  operation: string,
): void {
  const guard = getMindbodyWriteGuard(siteId);
  if (!guard.allowed) {
    throw new MindbodyWriteBlockedError(operation, String(siteId), guard.reason);
  }
}
