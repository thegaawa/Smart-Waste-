/**
 * Local development database.
 *
 * Starts a real PostgreSQL 17 server from the binaries installed by the
 * `embedded-postgres` package. No Docker or Homebrew needed. Data is kept in
 * `apps/api/.pgdata` (git-ignored) so it survives restarts.
 *
 *   npm run db:start          (leave this terminal open)
 *
 * Connection string (also in .env.example):
 *   postgresql://smartwaste:smartwaste@localhost:5433/smartwaste
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PORT = Number(process.env["DEV_DB_PORT"] ?? 5433);
const USER = "smartwaste";
const PASSWORD = "smartwaste";
const DATABASES = ["smartwaste", "smartwaste_test"];
const DATA_DIR = path.join(apiRoot, ".pgdata");

async function ensureDatabases(pg: EmbeddedPostgres): Promise<void> {
  const client = pg.getPgClient("postgres");
  await client.connect();
  try {
    const existing = await client.query<{ datname: string }>("SELECT datname FROM pg_database");
    const names = new Set(existing.rows.map((row) => row.datname));
    for (const name of DATABASES) {
      if (!names.has(name)) {
        await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
        console.log(`[dev-db] created database "${name}"`);
      }
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    authMethod: "scram-sha-256",
    persistent: true,
    // UTF-8 storage (names and descriptions may contain non-ASCII characters);
    // "C" collation keeps sorting identical on every machine and in production.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: (message) => {
      const line = message.trim();
      if (line.length > 0) console.log(`[postgres] ${line}`);
    },
    onError: (error) => console.error("[postgres]", error),
  });

  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log(`[dev-db] first run: initialising data directory at ${DATA_DIR}`);
    await pg.initialise();
  }

  await pg.start();
  await ensureDatabases(pg);

  console.log("");
  console.log("[dev-db] PostgreSQL is running.");
  console.log(`[dev-db] DATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASES[0]}`);
  console.log("[dev-db] Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\n[dev-db] stopping PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[dev-db] failed to start:", error);
  process.exit(1);
});
