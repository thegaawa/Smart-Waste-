import { UserStatus, type Role } from "@smart-waste/shared";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { Db } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

/** The signed-in user, attached to `req.user` by `requireAuth`. */
export interface AuthenticatedUser {
  id: string;
  name: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Verifies the access token and loads the account. The database lookup makes
 * sure a disabled account or a changed role takes effect immediately.
 */
export function requireAuth(db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token) {
      next(ApiError.unauthorized());
      return;
    }

    const claims = verifyAccessToken(token);
    if (!claims) {
      next(ApiError.unauthorized("Your session is invalid or has expired. Please sign in again"));
      return;
    }

    const user = await db.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, name: true, role: true, status: true },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      next(ApiError.unauthorized("This account is not active. Please contact support"));
      return;
    }

    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  };
}

/** Allows only the listed roles. Use after `requireAuth`. */
export function requireRole(...roles: readonly Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

/** Returns the signed-in user or throws; for use inside handlers after `requireAuth`. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}
