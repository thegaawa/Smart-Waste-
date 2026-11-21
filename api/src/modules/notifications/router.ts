import { Router } from "express";

import type { Db } from "../../db.js";
import { parseParams, parseQuery } from "../../lib/validate.js";
import { currentUser, requireAuth } from "../../middleware/auth.js";
import { notificationIdParamsSchema, notificationsQuerySchema } from "./schemas.js";
import { NotificationsService } from "./service.js";

/** /notifications — every signed-in user reads and clears their own (FR-08). */
export function notificationsRouter(db: Db): Router {
  const router = Router();
  const service = new NotificationsService(db);

  router.use(requireAuth(db));

  // GET /notifications?unread=true&page=1&pageSize=20
  router.get("/", async (req, res) => {
    const query = parseQuery(notificationsQuerySchema, req.query);
    res.json(await service.listMine(currentUser(req), query));
  });

  // GET /notifications/unread-count — for the bell badge.
  router.get("/unread-count", async (req, res) => {
    res.json(await service.unreadCount(currentUser(req)));
  });

  // POST /notifications/read-all
  router.post("/read-all", async (req, res) => {
    res.json(await service.markAllRead(currentUser(req)));
  });

  // PATCH /notifications/:id/read
  router.patch("/:id/read", async (req, res) => {
    const { id } = parseParams(notificationIdParamsSchema, req.params);
    res.json(await service.markRead(currentUser(req), id));
  });

  return router;
}
