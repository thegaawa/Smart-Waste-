import type { HealthResponse } from "@smart-waste/shared";
import { Router } from "express";

import type { Db } from "../../db.js";
import { API_VERSION } from "../../lib/version.js";

/** GET /health — liveness plus a real database round-trip. */
export function healthRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    let database: HealthResponse["database"] = "up";
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }

    const body: HealthResponse = {
      status: database === "up" ? "ok" : "degraded",
      service: "smart-waste-api",
      version: API_VERSION,
      time: new Date().toISOString(),
      database,
    };
    res.status(database === "up" ? 200 : 503).json(body);
  });

  return router;
}
