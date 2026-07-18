import { createHash } from "node:crypto";

/**
 * Stable, non-plaintext key used to enforce one active Deal per parent email.
 * It is an identity key, not a password hash; HubSpot still stores the parent
 * email separately for staff and workflow communication.
 */
export function buildActiveParentKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Parent email is required for an active booking key.");
  return `v1:${createHash("sha256").update(normalized).digest("hex")}`;
}
