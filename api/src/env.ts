import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load `.env` when present. Existing environment variables always win, so the
// test runner and the hosting platform can override anything in the file.
loadDotenv({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "DATABASE_URL must be a postgresql:// URL"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Folder for report photos (local disk storage). Relative paths resolve from the working directory. */
  UPLOADS_DIR: z.string().trim().min(1).default("uploads"),
  /** Public address of this API, used in photo links. Derived from the request when unset. */
  PUBLIC_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.url("PUBLIC_URL must be a full URL such as https://api.example.com").optional(),
  ),
  /** How long a signed photo link stays valid. */
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).default(24 * 60 * 60),
  /**
   * Firebase service-account key for push notifications: either a path to the
   * JSON file or the JSON itself (hosting platforms often only allow env vars).
   * With neither set, push is disabled and notifications stay in-app only.
   */
  FIREBASE_SERVICE_ACCOUNT_FILE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  /**
   * Cloudflare R2 for report photos. When all four of account / keys / bucket
   * are set, the API stores photos in R2 instead of local disk.
   */
  R2_ACCOUNT_ID: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  R2_ACCESS_KEY_ID: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  R2_SECRET_ACCESS_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  R2_BUCKET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  /** Set to `eu` for European Union jurisdiction buckets. */
  R2_JURISDICTION: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["eu"]).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export const env: Env = loadEnv();

/** Origins allowed by CORS. `*` means any origin (development only). */
export function corsOrigins(value: string = env.CORS_ORIGINS): string[] | "*" {
  const trimmed = value.trim();
  if (trimmed === "*") return "*";
  return trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
