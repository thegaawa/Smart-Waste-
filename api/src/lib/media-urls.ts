import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

import { env } from "../env.js";

/**
 * Time-limited, signed photo links (Chapter 3.12: controlled access to media).
 *
 * A link looks like `/media/<id>?exp=<unix seconds>&sig=<hmac>`. Only the API
 * can produce a valid signature, so a photo can be opened by the app's image
 * component or the dashboard's <img> tag without an Authorization header, yet
 * cannot be guessed or shared indefinitely.
 */

// A key derived from the JWT secret, so signatures cannot be reused as tokens.
const signingKey = createHmac("sha256", env.JWT_SECRET).update("smart-waste:media-url:v1").digest();

function signature(mediaId: string, expiresAt: number): string {
  return createHmac("sha256", signingKey).update(`${mediaId}.${expiresAt}`).digest("base64url");
}

/** Relative signed path for a media item. `expiresAt` is unix seconds. */
export function signedMediaPath(mediaId: string, expiresAt: number): string {
  return `/media/${mediaId}?exp=${expiresAt}&sig=${signature(mediaId, expiresAt)}`;
}

export function verifyMediaSignature(
  mediaId: string,
  exp: unknown,
  sig: unknown,
  nowMs: number = Date.now(),
): boolean {
  if (typeof exp !== "string" || typeof sig !== "string") return false;
  if (!/^\d{1,12}$/.test(exp)) return false;
  const expiresAt = Number(exp);
  if (expiresAt * 1000 <= nowMs) return false;

  const expected = Buffer.from(signature(mediaId, expiresAt));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/**
 * Absolute base URL clients should use to reach this API: `PUBLIC_URL` when
 * configured, otherwise the host the request came in on (works for a phone on
 * the same Wi-Fi in development and behind the hosting platform's proxy).
 */
export function publicBaseUrl(req: Request): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  const host = req.get("host") ?? `localhost:${env.PORT}`;
  return `${req.protocol}://${host}`;
}

/** Absolute signed URL valid for MEDIA_URL_TTL_SECONDS from now. */
export function mediaUrl(baseUrl: string, mediaId: string, nowMs: number = Date.now()): string {
  const expiresAt = Math.floor(nowMs / 1000) + env.MEDIA_URL_TTL_SECONDS;
  return `${baseUrl}${signedMediaPath(mediaId, expiresAt)}`;
}
