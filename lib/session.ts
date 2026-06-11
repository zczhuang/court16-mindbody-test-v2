// Encrypted, self-contained cookie sessions.
//
// AES-256-GCM with a key derived from SESSION_SECRET via SHA-256.
// Format: base64url(iv || ciphertext || tag).  Cookie is httpOnly + Secure
// in production, SameSite=Lax so the OAuth callback redirect from MindBody
// can read it.

import { cookies } from "next/headers";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "c16_mb_session";
const STATE_COOKIE_BASE = "c16_mb_oauth";

export interface MindbodySession {
  // OAuth tokens
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch — when accessToken expires
  // Profile (subset)
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  homeLocationId: number | null;
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 chars (run `openssl rand -hex 32`)");
  }
  return createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64url");
}

function decrypt(token: string): string | null {
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 12 + 16) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const enc = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

export async function setSession(s: MindbodySession): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encrypt(JSON.stringify(s)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 30 days — refresh token lifetime; access token gets rotated within.
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSession(): Promise<MindbodySession | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const json = decrypt(raw);
  if (!json) return null;
  try {
    return JSON.parse(json) as MindbodySession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// Short-lived cookie for OAuth state + PKCE verifier.  Cleared on callback.
export interface OAuthPending {
  state: string;
  codeVerifier: string;
  returnTo: string;
}

export async function setOAuthPending(p: OAuthPending): Promise<void> {
  const jar = await cookies();
  jar.set(`${STATE_COOKIE_BASE}_pending`, encrypt(JSON.stringify(p)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes to complete the round-trip
  });
}

export async function consumeOAuthPending(): Promise<OAuthPending | null> {
  const jar = await cookies();
  const name = `${STATE_COOKIE_BASE}_pending`;
  const raw = jar.get(name)?.value;
  if (!raw) return null;
  jar.delete(name);
  const json = decrypt(raw);
  if (!json) return null;
  try {
    return JSON.parse(json) as OAuthPending;
  } catch {
    return null;
  }
}
