import {
  classifyIdentifier,
  Role,
  UserStatus,
  type AuthResponse,
  type AuthUser,
} from "@smart-waste/shared";

import type { Db } from "../../db.js";
import { env } from "../../env.js";
import type { User } from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../lib/tokens.js";
import type { LoginInput, RegisterInput } from "./schemas.js";

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

const INVALID_LOGIN = "The email/phone or password is incorrect";

export class AuthService {
  constructor(private readonly db: Db) {}

  /** Public sign-up. Always creates a CITIZEN account (FR-01). */
  async register(input: RegisterInput): Promise<AuthResponse> {
    const email = input.email ?? null;
    const phone = input.phone ?? null;

    const existing = await this.db.user.findFirst({
      where: {
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      select: { email: true, phone: true },
    });
    if (existing) {
      if (email && existing.email === email) {
        throw ApiError.conflict("An account with this email address already exists");
      }
      throw ApiError.conflict("An account with this phone number already exists");
    }

    const user = await this.db.user.create({
      data: {
        name: input.name,
        email,
        phone,
        passwordHash: await hashPassword(input.password),
        role: Role.CITIZEN,
      },
    });

    return this.issueTokens(user);
  }

  /** Sign in with email or phone plus password (test cases T01, T02). */
  async login(input: LoginInput): Promise<AuthResponse> {
    const identifier = classifyIdentifier(input.identifier);
    if (!identifier) {
      throw ApiError.unauthorized(INVALID_LOGIN);
    }

    const user = await this.db.user.findUnique({
      where: identifier.kind === "email" ? { email: identifier.value } : { phone: identifier.value },
    });
    if (!user) {
      throw ApiError.unauthorized(INVALID_LOGIN);
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      throw ApiError.unauthorized(INVALID_LOGIN);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw ApiError.forbidden("This account has been disabled. Please contact the administrator");
    }

    return this.issueTokens(user);
  }

  /** Exchange a valid refresh token for a new pair. The old token is revoked. */
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await this.db.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    const now = new Date();
    if (!stored || stored.revokedAt !== null || stored.expiresAt <= now) {
      throw ApiError.unauthorized("Your session has expired. Please sign in again");
    }
    if (stored.user.status !== UserStatus.ACTIVE) {
      throw ApiError.unauthorized("This account is not active. Please contact support");
    }

    await this.db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } });
    return this.issueTokens(stored.user);
  }

  /** Revoke a refresh token. Safe to call more than once. */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await this.db.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound("Account");
    return toAuthUser(user);
  }

  private async issueTokens(user: User): Promise<AuthResponse> {
    const { token, tokenHash } = generateRefreshToken();
    await this.db.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt: refreshTokenExpiry() },
    });

    return {
      accessToken: signAccessToken({ id: user.id, role: user.role }),
      accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: token,
      user: toAuthUser(user),
    };
  }
}
