import { z } from "zod";

/** GET /notifications?unread=true&page=1&pageSize=20 */
export const notificationsQuerySchema = z.object({
  unread: z
    .preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean().optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type NotificationsQueryInput = z.infer<typeof notificationsQuerySchema>;

export const notificationIdParamsSchema = z.object({ id: z.uuid("Invalid notification id") });
