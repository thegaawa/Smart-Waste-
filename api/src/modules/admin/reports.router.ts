import { Role } from "@smart-waste/shared";
import { Router } from "express";

import type { Db } from "../../db.js";
import { publicBaseUrl } from "../../lib/media-urls.js";
import type { ObjectStorage } from "../../lib/storage.js";
import { parseParams, parseQuery } from "../../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth.js";
import { adminReportsQuerySchema, reportIdParamsSchema } from "../reports/schemas.js";
import { ReportsService } from "../reports/service.js";

/**
 * /admin/reports — the administrator queue (FR-06, FR-09).
 * Detail and actions live under /reports/:id so citizens and field officers
 * share the same detail shape; this route mirrors detail for convenience.
 */
export function adminReportsRouter(db: Db, storage: ObjectStorage): Router {
  const router = Router();
  const service = new ReportsService(db, storage);

  router.use(requireAuth(db), requireRole(Role.ADMIN));

  // GET /admin/reports?status=NEW&categoryId=…&q=Ikeja&page=1
  router.get("/", async (req, res) => {
    const query = parseQuery(adminReportsQuerySchema, req.query);
    res.json(await service.listForAdmin(query));
  });

  // GET /admin/reports/:id
  router.get("/:id", async (req, res) => {
    const { id } = parseParams(reportIdParamsSchema, req.params);
    res.json(await service.getForViewer(currentUser(req), id, publicBaseUrl(req)));
  });

  return router;
}
