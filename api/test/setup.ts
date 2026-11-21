// Runs before each test file, before any application module is imported.
// Environment variables set here win over anything in `.env`.
import { inject } from "vitest";

process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] = inject("databaseUrl");
process.env["JWT_SECRET"] = "test-only-secret-that-is-at-least-32-characters-long";
process.env["ACCESS_TOKEN_TTL_SECONDS"] = "3600";
process.env["REFRESH_TOKEN_TTL_DAYS"] = "30";
process.env["BCRYPT_ROUNDS"] = "4"; // fast hashing in tests
process.env["CORS_ORIGINS"] = "*";
process.env["LOG_LEVEL"] = "silent";
