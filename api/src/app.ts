import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import type { Db } from "./db.js";
import { corsOrigins, env } from "./env.js";
import type { Logger } from "./lib/logger.js";
import { DisabledPushSender } from "./lib/push.js";
import type { ObjectStorage } from "./lib/storage.js";
import { API_VERSION } from "./lib/version.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { adminCategoriesRouter } from "./modules/admin/categories.router.js";
import { adminReportsRouter } from "./modules/admin/reports.router.js";
import { adminStatsRouter } from "./modules/admin/stats.router.js";
import { adminUsersRouter } from "./modules/admin/users.router.js";
import { authRouter } from "./modules/auth/router.js";
import { categoriesRouter } from "./modules/categories/router.js";
import { healthRouter } from "./modules/health/router.js";
import { mediaRouter } from "./modules/media/router.js";
import { notificationsRouter } from "./modules/notifications/router.js";
import { devicesRouter } from "./modules/push/router.js";
import { PushService } from "./modules/push/service.js";
import { reportsRouter } from "./modules/reports/router.js";
import { tasksRouter } from "./modules/tasks/router.js";

export interface AppDependencies {
  db: Db;
  logger: Logger;
  /** Where report photos are kept. */
  storage: ObjectStorage;
  /** Push delivery. Defaults to a disabled sender (in-app notifications only). */
  push?: PushService;
}

/**
 * Builds the Express application. Kept separate from `index.ts` so tests can
 * create an app against a test database without opening a network port.
 */
export function createApp({ db, logger, storage, push = new PushService(db, new DisabledPushSender(), logger) }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  // Hosting platforms (Render, Railway, Fly) sit behind one reverse proxy.
  app.set("trust proxy", 1);

  // Photos are embedded by the dashboard (another origin), so allow cross-origin loads.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: corsOrigins(),
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== "test",
      redact: ["req.headers.authorization"],
    }),
  );

  app.get("/", (_req, res) => {
    res.json({ service: "smart-waste-api", version: API_VERSION, health: "/health" });
  });

  app.use("/health", healthRouter(db));
  app.use("/auth", authRouter(db));
  app.use("/categories", categoriesRouter(db));
  app.use("/reports", reportsRouter(db, storage, push));
  app.use("/media", mediaRouter(db, storage));
  app.use("/tasks", tasksRouter(db));
  app.use("/notifications", notificationsRouter(db));
  app.use("/devices", devicesRouter(db, push));
  app.use("/admin/users", adminUsersRouter(db));
  app.use("/admin/reports", adminReportsRouter(db, storage));
  app.use("/admin/categories", adminCategoriesRouter(db));
  app.use("/admin/stats", adminStatsRouter(db, storage));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
