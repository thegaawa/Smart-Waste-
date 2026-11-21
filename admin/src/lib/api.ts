import type { ApiErrorBody, ApiErrorCode, FieldError } from "@smart-waste/shared";

/** API base URL: `VITE_API_URL` at build time, else the local dev API. */
export const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "http://localhost:4000";

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

  fieldMessage(field: string): string | undefined {
    return this.details.find((d) => d.field === field)?.message;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

export function describeError(error: unknown): string {
  if (isApiRequestError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiRequestError(0, "NETWORK_ERROR", "Could not reach the API. Is the server running?");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data as Partial<ApiErrorBody> | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? `Request failed (${response.status})`,
      error?.details ?? [],
    );
  }

  return data as T;
}
