/**
 * Starts a throwaway PostgreSQL server for the test run, applies the Prisma
 * migrations, and hands the connection URL to the test files. Everything is
 * deleted when the run ends.
 */
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not determine a free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export default async function globalSetup(project: TestProject): Promise<() => Promise<void>> {
  const port = await findFreePort();
  const databaseDir = mkdtempSync(path.join(tmpdir(), "smart-waste-test-pg-"));

  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "test",
    password: "test",
    authMethod: "scram-sha-256",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => undefined,
    onError: () => undefined,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("smartwaste_test");

  const databaseUrl = `postgresql://test:test@localhost:${port}/smartwaste_test`;

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  process.env["DATABASE_URL"] = databaseUrl;
  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await pg.stop();
  };
}
