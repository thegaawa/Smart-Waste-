import type { ReportDetailDto } from "@smart-waste/shared";
import { useMemo } from "react";

import { describeError, isApiRequestError } from "./api";
import { useAuth } from "./auth";
import { recordAttempt, removePending, savePending, type PendingReport, type PendingReportInput } from "./outbox";
import { buildReportFormData } from "./reports";
import type { UploadProgress } from "./upload";

export interface SendOptions {
  onProgress?: (progress: UploadProgress) => void;
}

/** True when the API said the data itself is wrong (400) — retrying unchanged would not help. */
export function isValidationFailure(error: unknown): boolean {
  return isApiRequestError(error) && error.status === 400;
}

/**
 * True when the report may or may not have reached the server: no network,
 * timeout, or a server-side failure. The report stays in the outbox.
 */
export function isUnconfirmedFailure(error: unknown): boolean {
  if (!isApiRequestError(error)) return true;
  return error.status === 0 || error.status >= 500;
}

/**
 * Sends reports the safe way (T09):
 *   1. save to the outbox on the phone,
 *   2. upload with the same idempotency key,
 *   3. remove from the outbox only when the server answers with the report.
 */
export function useSendReport() {
  const { authedUpload } = useAuth();

  return useMemo(() => {
    async function sendPending(entry: PendingReport, options: SendOptions = {}): Promise<ReportDetailDto> {
      const form = await buildReportFormData({
        categoryId: entry.categoryId,
        description: entry.description,
        location: entry.location,
        photos: entry.photos,
        idempotencyKey: entry.idempotencyKey,
      });
      try {
        const report = await authedUpload<ReportDetailDto>("/reports", form, {
          timeoutMs: 90_000,
          onProgress: options.onProgress,
        });
        await removePending(entry.id);
        return report;
      } catch (error) {
        await recordAttempt(entry.id, describeError(error));
        throw error;
      }
    }

    async function sendDraft(input: PendingReportInput, options: SendOptions = {}): Promise<ReportDetailDto> {
      const entry = await savePending(input);
      return sendPending(entry, options);
    }

    return { sendDraft, sendPending };
  }, [authedUpload]);
}
