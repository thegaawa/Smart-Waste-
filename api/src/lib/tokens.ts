import { isRole, type Role } from "@smart-waste/shared";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

import { env } from "../env.js";

const ISSUER = "smart-waste-api";
const ALGORITHM = "HS256";

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  role: Role;
}

/** Short-lived JWT sent as `Authorization: Bearer <token>`. */
export function signAccessToken(user: { id: string; role: Role }): string {
  return jwt.sign({ role: user.role, typ: "access" }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: user.id,
    issuer: ISSUER,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Returns the claims when the token is valid and unexpired, otherwise null. */
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM], issuer: ISSUER });
    if (typeof decoded !== "object" || decoded === null) return null;
    const { sub, role, typ } = decoded as { sub?: unknown; role?: unknown; typ?: unknown };
    if (typ !== "access" || typeof sub !== "string" || !isRole(role)) return null;
    return { sub, role };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are long random strings. Only a SHA-256 hash is stored, so a
 * database leak does not expose usable tokens.
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
