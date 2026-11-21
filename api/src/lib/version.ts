import { readFileSync } from "node:fs";

/** Version from apps/api/package.json (works from both src/ and dist/). */
export function readApiVersion(): string {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const API_VERSION: string = readApiVersion();
