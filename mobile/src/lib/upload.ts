import type { ApiErrorBody } from "@smart-waste/shared";

import { API_BASE_URL, ApiRequestError } from "./api";

export interface UploadProgress {
  /** Bytes sent so far. */
  sent: number;
  /** Total bytes to send. */
  total: number;
  /** 0..1 */
  fraction: number;
}

export interface UploadOptions {
  token?: string | null;
  /** Milliseconds before giving up. Photos on mobile data need a generous limit. */
  timeoutMs?: number;
  onProgress?: (progress: UploadProgress) => void;
}

export const NETWORK_FAILURE_MESSAGE =
  "Could not reach the server. Your report is saved on this phone as “Not sent yet”. Retry when you have a better connection";
export const TIMEOUT_MESSAGE =
  "The connection timed out before the server confirmed your report. It is saved on this phone as “Not sent yet”. Retry when you have a better connection";

/**
 * Sends multipart form data with a real upload progress bar.
 *
 * `fetch` cannot report upload progress, so this uses XMLHttpRequest, which
 * React Native and browsers both support. Errors are the same
 * `ApiRequestError` the rest of the app already understands.
 *
 * Important for T09: a network error or timeout means "not confirmed", never
 * "failed for sure" — the request may have reached the server after all. The
 * caller keeps the report locally and retries with the same idempotency key,
 * so the server never stores it twice.
 */
export function uploadForm<T>(path: string, form: FormData, options: UploadOptions = {}): Promise<T> {
  const { token, timeoutMs = 90_000, onProgress } = options;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Accept", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Content-Type is set by the runtime, including the multipart boundary.

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress({ sent: event.loaded, total: event.total, fraction: Math.min(1, event.loaded / event.total) });
        }
      };
    }

    xhr.onload = () => {
      const text = xhr.responseText ?? "";
      let data: unknown = null;
      if (text.length > 0) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      const errorBody = data as Partial<ApiErrorBody> | null;
      const error = errorBody?.error;
      reject(
        new ApiRequestError(
          xhr.status,
          error?.code ?? "INTERNAL_ERROR",
          error?.message ?? `Request failed (${xhr.status})`,
          error?.details ?? [],
        ),
      );
    };
    xhr.onerror = () => reject(new ApiRequestError(0, "NETWORK_ERROR", NETWORK_FAILURE_MESSAGE));
    xhr.ontimeout = () => reject(new ApiRequestError(0, "NETWORK_ERROR", TIMEOUT_MESSAGE));
    xhr.onabort = () => reject(new ApiRequestError(0, "NETWORK_ERROR", "Sending was cancelled"));

    try {
      xhr.send(form);
    } catch {
      reject(new ApiRequestError(0, "NETWORK_ERROR", NETWORK_FAILURE_MESSAGE));
    }
  });
}
