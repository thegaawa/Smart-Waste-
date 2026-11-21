import { Role } from "@smart-waste/shared";
import { Router } from "express";

import type { Db } from "../../db.js";
import type { ObjectStorage } from "../../lib/storage.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { ReportsService } from "../reports/service.js";

/** GET /admin/stats — status totals and ageing open reports (Chapter 4.4). */
export function adminStatsRouter(db: Db, storage: ObjectStorage): Router {
  const router = Router();
  const service = new ReportsService(db, storage);

  router.get("/", requireAuth(db), requireRole(Role.ADMIN), async (_req, res) => {
    res.json(await service.adminStats());
  });

  return router;
}
