import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { createPushSender } from "./lib/push.js";
import { createStorage } from "./lib/storage.js";
import { API_VERSION } from "./lib/version.js";
import { PushService } from "./modules/push/service.js";

const storage = createStorage(env);
const push = new PushService(prisma, createPushSender(env, logger), logger);
const app = createApp({ db: prisma, logger, storage, push });

// 0.0.0.0 so a phone on the same Wi-Fi can reach the API during development.
const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      version: API_VERSION,
      storage: storage.kind,
      push: push.enabled,
    },
    `Smart-Waste API listening on http://0.0.0.0:${env.PORT}`,
  );
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close(() => {
    // Let push messages that are already on their way finish before closing the database.
    push
      .settle()
      .then(() => prisma.$disconnect())
      .catch((error: unknown) => logger.error({ err: error }, "Error during shutdown"))
      .finally(() => process.exit(0));
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
