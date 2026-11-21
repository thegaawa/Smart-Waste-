import { Role } from "@smart-waste/shared";
import { Router } from "express";

import type { Db } from "../../db.js";
import { publicBaseUrl } from "../../lib/media-urls.js";
import { parseParams, parseQuery } from "../../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth.js";
import { myTasksQuerySchema, taskIdParamsSchema } from "./schemas.js";
import { TasksService } from "./service.js";

/** /tasks — field officers only (FR-07). Administrators use the dashboard. */
export function tasksRouter(db: Db): Router {
  const router = Router();
  const service = new TasksService(db);

  router.use(requireAuth(db), requireRole(Role.FIELD));

  // GET /tasks/my?group=active|completed&page=1&pageSize=20
  router.get("/my", async (req, res) => {
    const query = parseQuery(myTasksQuerySchema, req.query);
    res.json(await service.listMine(currentUser(req), query, publicBaseUrl(req)));
  });

  // GET /tasks/my/counts
  router.get("/my/counts", async (req, res) => {
    res.json(await service.countsMine(currentUser(req)));
  });

  // GET /tasks/:id
  router.get("/:id", async (req, res) => {
    const { id } = parseParams(taskIdParamsSchema, req.params);
    res.json(await service.getMine(currentUser(req), id, publicBaseUrl(req)));
  });

  // POST /tasks/:id/acknowledge
  router.post("/:id/acknowledge", async (req, res) => {
    const { id } = parseParams(taskIdParamsSchema, req.params);
    res.json(await service.acknowledge(currentUser(req), id));
  });

  return router;
}
