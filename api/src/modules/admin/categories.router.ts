import { ALL_PRIORITIES, Role, type CategoryDto, type Priority } from "@smart-waste/shared";
import { Router } from "express";
import { z } from "zod";

import type { Db } from "../../db.js";
import type { Category } from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/errors.js";
import { parseBody, parseParams } from "../../lib/validate.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requiredString } from "../auth/schemas.js";
import { toCategoryDto } from "../categories/router.js";

const upsertSchema = z.object({
  name: requiredString("Name").trim().min(2, "Name must be at least 2 characters").max(80),
  description: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().max(300).optional(),
    ),
  defaultPriority: z.enum(ALL_PRIORITIES as [Priority, ...Priority[]]).default("MEDIUM"),
  active: z.boolean().default(true),
});

const patchSchema = upsertSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: "Nothing to update",
  path: ["body"],
});

const idParams = z.object({ id: z.uuid("Invalid category id") });

/**
 * /admin/categories — full category list and create/update (Chapter 4.4).
 * Public GET /categories stays read-only for the report form.
 */
export function adminCategoriesRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db), requireRole(Role.ADMIN));

  // GET /admin/categories — every category, including inactive.
  router.get("/", async (_req, res) => {
    const categories = await db.category.findMany({ orderBy: { name: "asc" } });
    const body: CategoryDto[] = categories.map(toCategoryDto);
    res.json(body);
  });

  // POST /admin/categories
  router.post("/", async (req, res) => {
    const input = parseBody(upsertSchema, req.body);
    const existing = await db.category.findUnique({ where: { name: input.name } });
    if (existing) throw ApiError.conflict("A category with this name already exists");

    const category = await db.category.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        defaultPriority: input.defaultPriority,
        active: input.active,
      },
    });
    res.status(201).json(toCategoryDto(category));
  });

  // PATCH /admin/categories/:id
  router.patch("/:id", async (req, res) => {
    const { id } = parseParams(idParams, req.params);
    const input = parseBody(patchSchema, req.body);

    const current = await db.category.findUnique({ where: { id } });
    if (!current) throw ApiError.notFound("Category");

    if (input.name && input.name !== current.name) {
      const clash = await db.category.findUnique({ where: { name: input.name } });
      if (clash) throw ApiError.conflict("A category with this name already exists");
    }

    const category = await db.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.defaultPriority !== undefined ? { defaultPriority: input.defaultPriority } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    res.json(toCategoryDto(category as Category));
  });

  return router;
}
