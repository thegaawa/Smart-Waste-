import type {
  AcknowledgeTaskResponse,
  MyTasksQuery,
  Paginated,
  ReportDetailDto,
  TaskCountsDto,
  TaskDto,
  UpdateReportStatusRequest,
} from "@smart-waste/shared";
import { useMemo } from "react";

import { useAuth } from "./auth";

function toQueryString(query: MyTasksQuery): string {
  const params = new URLSearchParams();
  if (query.group) params.set("group", query.group);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Field-officer endpoints (FR-07), bound to the signed-in officer's session. */
export function useTasksApi() {
  const { authedRequest } = useAuth();

  return useMemo(
    () => ({
      myTasks: (query: MyTasksQuery = {}) => authedRequest<Paginated<TaskDto>>(`/tasks/my${toQueryString(query)}`),
      myCounts: () => authedRequest<TaskCountsDto>("/tasks/my/counts"),
      /** A report the officer is (or was) assigned to. */
      report: (reportId: string) => authedRequest<ReportDetailDto>(`/reports/${encodeURIComponent(reportId)}`),
      acknowledge: (assignmentId: string) =>
        authedRequest<AcknowledgeTaskResponse>(`/tasks/${encodeURIComponent(assignmentId)}/acknowledge`, {
          method: "POST",
        }),
      /** ASSIGNED -> IN_PROGRESS -> RESOLVED, with an optional operational note. */
      updateStatus: (reportId: string, body: UpdateReportStatusRequest) =>
        authedRequest<ReportDetailDto>(`/reports/${encodeURIComponent(reportId)}/status`, { method: "PATCH", body }),
    }),
    [authedRequest],
  );
}
