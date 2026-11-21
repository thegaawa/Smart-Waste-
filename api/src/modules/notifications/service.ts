import type { MarkAllReadResponse, NotificationDto, Paginated, UnreadCountDto } from "@smart-waste/shared";

import type { Db } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import type { NotificationsQueryInput } from "./schemas.js";

const notificationInclude = {
  report: { select: { id: true, reference: true } },
} satisfies Prisma.NotificationInclude;

type NotificationRecord = Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>;

function toNotificationDto(row: NotificationRecord): NotificationDto {
  return {
    id: row.id,
    message: row.message,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
    report: row.report,
  };
}

/**
 * In-app notifications (FR-08). Rows are written by the reports service in
 * the same transaction as the status or assignment change, so a change and
 * its notification can never disagree. This service only reads and marks them.
 */
export class NotificationsService {
  constructor(private readonly db: Db) {}

  /** The signed-in user's notifications, newest first. */
  async listMine(user: AuthenticatedUser, query: NotificationsQueryInput): Promise<Paginated<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      ...(query.unread === undefined ? {} : { read: !query.unread }),
    };
    const [total, rows] = await Promise.all([
      this.db.notification.count({ where }),
      this.db.notification.findMany({
        where,
        include: notificationInclude,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toNotificationDto), page: query.page, pageSize: query.pageSize, total };
  }

  async unreadCount(user: AuthenticatedUser): Promise<UnreadCountDto> {
    const unread = await this.db.notification.count({ where: { userId: user.id, read: false } });
    return { unread };
  }

  /** Marks one of the user's own notifications as read. Anyone else's id gives 404. */
  async markRead(user: AuthenticatedUser, id: string): Promise<NotificationDto> {
    const existing = await this.db.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, read: true } });
    if (!existing) throw ApiError.notFound("Notification");
    const row = await this.db.notification.update({
      where: { id },
      data: existing.read ? {} : { read: true },
      include: notificationInclude,
    });
    return toNotificationDto(row);
  }

  async markAllRead(user: AuthenticatedUser): Promise<MarkAllReadResponse> {
    const result = await this.db.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }
}
