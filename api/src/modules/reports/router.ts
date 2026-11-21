import { Role } from "@smart-waste/shared";
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import type { Db } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../lib/errors.js";
import { publicBaseUrl } from "../../lib/media-urls.js";
import type { ObjectStorage } from "../../lib/storage.js";
import { parseBody, parseParams, parseQuery } from "../../lib/validate.js";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth.js";
import { photoUpload, uploadedFiles } from "../../middleware/upload.js";
import type { PushService } from "../push/service.js";
import {
  assignReportSchema,
  createReportSchema,
  myReportsQuerySchema,
  reportIdParamsSchema,
  updatePrioritySchema,
  updateStatusSchema,
} from "./schemas.js";
import { ReportsService } from "./service.js";

/** At most 7 new reports in any 24 hours per account. A higher allowance is left for a later paid plan. Disabled in tests. */
const createReportRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 7,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
  handler: (_req, res) => {
    const error = ApiError.rateLimited("You can send up to 7 reports a day. Please wait and try again tomorrow");
    res.status(error.status).json(error.toBody());
  },
});

/**
 * /reports — citizens create and follow their own reports (FR-02 to FR-05).
 * Administrators and assigned field officers may open a report by id.
 */
export function reportsRouter(db: Db, storage: ObjectStorage, push: PushService): Router {
  const router = Router();
  const service = new ReportsService(db, storage, push);

  router.use(requireAuth(db));

  // POST /reports — multipart/form-data (fields + up to 3 "photos") or JSON without photos.
  router.post("/", createReportRateLimit, photoUpload("photos"), async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(createReportSchema, req.body);
    const { report, replayed } = await service.create(user, input, uploadedFiles(req), publicBaseUrl(req));
    if (replayed) res.setHeader("Idempotent-Replayed", "true");
    res.status(201).json(report);
  });

  // GET /reports/my?group=open&page=1&pageSize=20
  router.get("/my", async (req, res) => {
    const user = currentUser(req);
    const query = parseQuery(myReportsQuerySchema, req.query);
    res.json(await service.listMine(user, query));
  });

  // GET /reports/my/counts
  router.get("/my/counts", async (req, res) => {
    res.json(await service.countsMine(currentUser(req)));
  });

  // GET /reports/:id
  router.get("/:id", async (req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(reportIdParamsSchema, req.params);
    res.json(await service.getForViewer(user, id, publicBaseUrl(req)));
  });

  // PATCH /reports/:id/status — validate, reject, progress, resolve, close (not assign).
  router.patch("/:id/status", async (req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(reportIdParamsSchema, req.params);
    const input = parseBody(updateStatusSchema, req.body);
    res.json(await service.updateStatus(user, id, input, publicBaseUrl(req)));
  });

  // PATCH /reports/:id/priority — administrators only.
  router.patch("/:id/priority", requireRole(Role.ADMIN), async (req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(reportIdParamsSchema, req.params);
    const input = parseBody(updatePrioritySchema, req.body);
    res.json(await service.updatePriority(user, id, input, publicBaseUrl(req)));
  });

  // POST /reports/:id/assign — administrators only (T06).
  router.post("/:id/assign", requireRole(Role.ADMIN), async (req, res) => {
    const user = currentUser(req);
    const { id } = parseParams(reportIdParamsSchema, req.params);
    const input = parseBody(assignReportSchema, req.body);
    res.json(await service.assign(user, id, input, publicBaseUrl(req)));
  });

  return router;
}
