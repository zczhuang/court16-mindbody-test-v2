// Single-use HMAC-SHA256 tokens embedded in staff/admin URLs.
//
// Why not JOSE / jsonwebtoken package: Node has crypto built in, these are
// internal tokens (we sign + verify in the same process), and adding a
// dependency for 40 lines of code is Cedarwind-memo bait.
//
// Single-use guarantee is enforced by the HubSpot booking record's `status`
// field — not by a separate token store. The token's `action` + the
// correlation ID let the endpoint look up the booking, check whether the
// action has already been applied (e.g. `status = confirmed` for a
// confirm-action token), and 410 if it has.

import crypto from "node:crypto";

export type StaffAction = "confirm" | "reassign" | "retry";

export interface TokenPayload {
  correlationId: string;
  action: StaffAction;
  exp: number; // unix seconds
}

function getSecret(): string {
  const s = process.env.STAFF_CONFIRM_SIGNING_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "STAFF_CONFIRM_SIGNING_SECRET must be set (>=32 chars). Generate with: openssl rand -hex 32",
    );
  }
  return s;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function signToken(
  params: { correlationId: string; action: StaffAction; ttlHours?: number },
): string {
  const ttl = params.ttlHours ?? 24;
  const payload: TokenPayload = {
    correlationId: params.correlationId,
    action: params.action,
    exp: Math.floor(Date.now() / 1000) + ttl * 3600,
  };
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = base64urlEncode(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export class InvalidTokenError extends Error {
  reason: "malformed" | "bad_signature" | "expired";
  constructor(reason: "malformed" | "bad_signature" | "expired") {
    super(`invalid token: ${reason}`);
    this.name = "InvalidTokenError";
    this.reason = reason;
  }
}

export function verifyToken(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) throw new InvalidTokenError("malformed");
  const [body, sig] = parts;

  const expected = base64urlEncode(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  // timing-safe compare on equal-length buffers only
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new InvalidTokenError("bad_signature");
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf8"));
  } catch {
    throw new InvalidTokenError("malformed");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    throw new InvalidTokenError("expired");
  }
  return payload;
}

/** Build a fully-qualified URL for a staff action. Used by the trial route to stamp URLs into the HubSpot booking record. */
export function buildStaffUrl(
  params: { action: StaffAction; correlationId: string; baseUrl: string; ttlHours?: number },
): string {
  const token = signToken({
    correlationId: params.correlationId,
    action: params.action,
    ttlHours: params.ttlHours,
  });
  const path = params.action === "retry" ? "/api/admin/retry" : `/api/staff/${params.action}`;
  return `${params.baseUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}
