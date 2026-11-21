import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "./env.js";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = createPrismaClient(env.DATABASE_URL);
