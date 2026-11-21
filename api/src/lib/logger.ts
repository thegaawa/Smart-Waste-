import { pino, type Logger } from "pino";

import { env } from "../env.js";

export type { Logger };

export function createLogger(): Logger {
  if (env.NODE_ENV === "test") {
    return pino({ level: "silent" });
  }
  if (env.NODE_ENV === "development") {
    return pino({
      level: env.LOG_LEVEL,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
    });
  }
  return pino({ level: env.LOG_LEVEL });
}

export const logger: Logger = createLogger();
