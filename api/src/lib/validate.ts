import type { FieldError } from "@smart-waste/shared";
import type { z } from "zod";

import { ApiError } from "./errors.js";

function toFieldErrors(error: z.ZodError, fallbackField: string): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : fallbackField,
    message: issue.message,
  }));
}

/**
 * Validate a request body. Throws a 400 `VALIDATION_ERROR` naming each bad
 * field so the client can point at it (test case T04).
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw ApiError.validation(toFieldErrors(result.error, "body"));
  }
  return result.data;
}

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query ?? {});
  if (!result.success) {
    throw ApiError.validation(toFieldErrors(result.error, "query"), "Some query parameters are invalid");
  }
  return result.data;
}

export function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const result = schema.safeParse(params ?? {});
  if (!result.success) {
    throw ApiError.validation(toFieldErrors(result.error, "params"), "The URL contains an invalid value");
  }
  return result.data;
}
