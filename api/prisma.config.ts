// Prisma 7 configuration. The database URL lives here (not in schema.prisma).
// `.env` is loaded so `npx prisma migrate dev` works from the command line.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
