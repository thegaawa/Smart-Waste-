import { ALL_ROLES, Role, UserStatus, type AuthUser, type Paginated } from "@smart-waste/shared";
import { Router } from "express";
import { z } from "zod";

import type { Db } from "../../db.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { parseBody, parseParams, parseQuery } from "../../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth.js";
import { emailSchema, nameSchema, passwordSchema, phoneSchema } from "../auth/schemas.js";
import { toAuthUser } from "../auth/service.js";

const createUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    role: z.enum(ALL_ROLES as [Role, ...Role[]]),
  })
  .superRefine((data, ctx) => {
    if (!data.email && !data.phone) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter an email address or a phone number" });
    }
  });

const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: z.enum(ALL_ROLES as [Role, ...Role[]]).optional(),
    status: z.enum([UserStatus.ACTIVE, UserStatus.DISABLED]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update", path: ["body"] });

const listQuerySchema = z.object({
  role: z.enum(ALL_ROLES as [Role, ...Role[]]).optional(),
  status: z.enum([UserStatus.ACTIVE, UserStatus.DISABLED]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamsSchema = z.object({ id: z.uuid("Invalid user id") });

/**
 * /admin/users — administrators manage citizen and field accounts (Chapter 4.4).
 * Field officers and other administrators can only be created here, never
 * through public registration.
 */
export function adminUsersRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db), requireRole(Role.ADMIN));

  // GET /admin/users?role=FIELD&status=ACTIVE&q=ade&page=1&pageSize=20
  router.get("/", async (req, res) => {
    const query = parseQuery(listQuerySchema, req.query);
    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" as const } },
              { email: { contains: query.q, mode: "insensitive" as const } },
              { phone: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: [{ role: "asc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const body: Paginated<AuthUser> = {
      items: users.map(toAuthUser),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
    res.json(body);
  });

  // POST /admin/users
  router.post("/", async (req, res) => {
    const input = parseBody(createUserSchema, req.body);
    const email = input.email ?? null;
    const phone = input.phone ?? null;

    const existing = await db.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
      select: { id: true },
    });
    if (existing) {
      throw ApiError.conflict("An account with this email address or phone number already exists");
    }

    const user = await db.user.create({
      data: {
        name: input.name,
        email,
        phone,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      },
    });
    res.status(201).json(toAuthUser(user));
  });

  // GET /admin/users/:id
  router.get("/:id", async (req, res) => {
    const { id } = parseParams(idParamsSchema, req.params);
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw ApiError.notFound("User");
    res.json(toAuthUser(user));
  });

  // PATCH /admin/users/:id — rename, change role, or enable/disable.
  router.patch("/:id", async (req, res) => {
    const { id } = parseParams(idParamsSchema, req.params);
    const input = parseBody(updateUserSchema, req.body);
    const admin = currentUser(req);

    if (id === admin.id && (input.status === UserStatus.DISABLED || (input.role && input.role !== Role.ADMIN))) {
      throw ApiError.conflict("You cannot disable or demote your own administrator account");
    }

    const existing = await db.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw ApiError.notFound("User");

    const user = await db.user.update({ where: { id }, data: input });

    // Disabling an account ends all of its sessions immediately.
    if (input.status === UserStatus.DISABLED) {
      await db.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    res.json(toAuthUser(user));
  });

  return router;
}
