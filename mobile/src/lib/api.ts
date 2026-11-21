import type { ApiErrorBody, ApiErrorCode, FieldError } from "@smart-waste/shared";
import Constants from "expo-constants";

/**
 * Base URL of the Smart-Waste API.
 *
 * 1. `EXPO_PUBLIC_API_URL` when set (production builds, or a custom dev setup).
 * 2. Otherwise, in development, the same computer that runs the Expo dev
 *    server, on port 4000. This makes a phone on the same Wi-Fi work with no
 *    configuration.
 */
export function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host) return `http://${host}:4000`;
  }
  return "http://localhost:4000";
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Thrown for any non-2xx response, carrying the API's error code and field details. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "NETWORK_ERROR";
  readonly details: FieldError[];

  constructor(status: number, code: ApiErrorCode | "NETWORK_ERROR", message: string, details: FieldError[] = []) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Message for a specific field, if the server reported one. */
  fieldMessage(field: string): string | undefined {
    return this.details.find((d) => d.field === field)?.message;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

/** Turns any thrown value into a sentence the user can read. */
export function describeError(error: unknown): string {
  if (isApiRequestError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** A plain object is sent as JSON; a `FormData` is sent as multipart (photo uploads). */
  body?: unknown;
  token?: string | null;
  /** Milliseconds before giving up (default 15 s, generous for slow networks). */
  timeoutMs?: number;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, timeoutMs = 15_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const multipart = isFormData(body);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        // For multipart, fetch sets Content-Type itself (it must include the boundary).
        ...(body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: multipart ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiRequestError(
      0,
      "NETWORK_ERROR",
      aborted
        ? "The connection timed out. Check your network and try again"
        : "Could not reach the server. Check your internet connection and try again",
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorBody = data as Partial<ApiErrorBody> | null;
    const error = errorBody?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? `Request failed (${response.status})`,
      error?.details ?? [],
    );
  }

  return data as T;
}
