import type { CategoryDto } from "@smart-waste/shared";
import { Router } from "express";

import type { Db } from "../../db.js";
import type { Category } from "../../generated/prisma/client.js";
import { requireAuth } from "../../middleware/auth.js";

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    defaultPriority: category.defaultPriority,
    active: category.active,
  };
}

/** GET /categories — active categories for the report form (any signed-in user). */
export function categoriesRouter(db: Db): Router {
  const router = Router();

  router.get("/", requireAuth(db), async (_req, res) => {
    const categories = await db.category.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    res.json(categories.map(toCategoryDto));
  });

  return router;
}
