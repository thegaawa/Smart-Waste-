import type {
  MarkAllReadResponse,
  NotificationDto,
  NotificationsQuery,
  Paginated,
  UnreadCountDto,
} from "@smart-waste/shared";
import { useMemo } from "react";

import { useAuth } from "./auth";

function toQueryString(query: NotificationsQuery): string {
  const params = new URLSearchParams();
  if (query.unread !== undefined) params.set("unread", String(query.unread));
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** In-app notifications (FR-08) for citizens and field officers. */
export function useNotificationsApi() {
  const { authedRequest } = useAuth();

  return useMemo(
    () => ({
      list: (query: NotificationsQuery = {}) =>
        authedRequest<Paginated<NotificationDto>>(`/notifications${toQueryString(query)}`),
      unreadCount: () => authedRequest<UnreadCountDto>("/notifications/unread-count"),
      markRead: (id: string) =>
        authedRequest<NotificationDto>(`/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }),
      markAllRead: () => authedRequest<MarkAllReadResponse>("/notifications/read-all", { method: "POST" }),
    }),
    [authedRequest],
  );
}
