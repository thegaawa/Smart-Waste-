import type {
  CategoryDto,
  MyReportsQuery,
  Paginated,
  ReportCountsDto,
  ReportDetailDto,
  ReportSummaryDto,
} from "@smart-waste/shared";
import { useMemo } from "react";
import { Platform } from "react-native";

import { useAuth } from "./auth";

/** A photo chosen for a report, already resized and compressed on the phone. */
export interface DraftPhoto {
  uri: string;
  width: number;
  height: number;
  fileName: string;
  mimeType: "image/jpeg";
}

export interface DraftLocation {
  latitude: number;
  longitude: number;
  /** GPS accuracy radius in metres; null when the pin was placed by hand. */
  accuracyMeters: number | null;
  /** Street / area text from reverse geocoding, or typed by the user. */
  address: string | null;
  source: "gps" | "map";
}

export interface SubmitReportInput {
  categoryId: string;
  description: string;
  location: DraftLocation;
  photos: DraftPhoto[];
  idempotencyKey: string;
}

function toQueryString(query: MyReportsQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.group) params.set("group", query.group);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Builds the multipart body for POST /reports. On a phone, React Native's
 * fetch accepts `{ uri, name, type }` file descriptors; in a browser we need
 * real Blobs.
 */
export async function buildReportFormData(input: SubmitReportInput): Promise<FormData> {
  const form = new FormData();
  form.append("categoryId", input.categoryId);
  form.append("description", input.description.trim());
  form.append("latitude", input.location.latitude.toString());
  form.append("longitude", input.location.longitude.toString());
  if (input.location.address) form.append("address", input.location.address.trim());
  form.append("idempotencyKey", input.idempotencyKey);

  for (const photo of input.photos) {
    if (Platform.OS === "web") {
      const blob = await (await fetch(photo.uri)).blob();
      form.append("photos", blob, photo.fileName);
    } else {
      form.append("photos", { uri: photo.uri, name: photo.fileName, type: photo.mimeType } as unknown as Blob);
    }
  }
  return form;
}

/**
 * Report endpoints, bound to the signed-in user's session.
 * Sending a report lives in `send-report.ts` (outbox + upload with progress).
 */
export function useReportsApi() {
  const { authedRequest } = useAuth();

  return useMemo(
    () => ({
      categories: () => authedRequest<CategoryDto[]>("/categories"),
      myReports: (query: MyReportsQuery = {}) =>
        authedRequest<Paginated<ReportSummaryDto>>(`/reports/my${toQueryString(query)}`),
      myCounts: () => authedRequest<ReportCountsDto>("/reports/my/counts"),
      report: (id: string) => authedRequest<ReportDetailDto>(`/reports/${encodeURIComponent(id)}`),
    }),
    [authedRequest],
  );
}
