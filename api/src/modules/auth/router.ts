import { Router } from "express";
import rateLimit from "express-rate-limit";

import type { Db } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../lib/errors.js";
import { parseBody } from "../../lib/validate.js";
import { currentUser, requireAuth } from "../../middleware/auth.js";
import { loginSchema, refreshSchema, registerSchema } from "./schemas.js";
import { AuthService } from "./service.js";

/**
 * Slows down password guessing: 20 attempts per 15 minutes per IP on the
 * sign-in and sign-up routes. Disabled in tests.
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: (_req, res) => {
    const error = ApiError.rateLimited();
    res.status(error.status).json(error.toBody());
  },
});

export function authRouter(db: Db): Router {
  const router = Router();
  const service = new AuthService(db);

  // POST /auth/register
  router.post("/register", authRateLimit, async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    const result = await service.register(input);
    res.status(201).json(result);
  });

  // POST /auth/login
  router.post("/login", authRateLimit, async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const result = await service.login(input);
    res.status(200).json(result);
  });

  // POST /auth/refresh
  router.post("/refresh", async (req, res) => {
    const input = parseBody(refreshSchema, req.body);
    const result = await service.refresh(input.refreshToken);
    res.status(200).json(result);
  });

  // POST /auth/logout
  router.post("/logout", async (req, res) => {
    const input = parseBody(refreshSchema, req.body);
    await service.logout(input.refreshToken);
    res.status(204).send();
  });

  // GET /auth/me
  router.get("/me", requireAuth(db), async (req, res) => {
    const user = currentUser(req);
    res.status(200).json(await service.me(user.id));
  });

  return router;
}
