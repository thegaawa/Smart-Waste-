import { z } from "zod";

/** GET /tasks/my?group=active&page=1&pageSize=20 */
export const myTasksQuerySchema = z.object({
  group: z.enum(["active", "completed"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type MyTasksQueryInput = z.infer<typeof myTasksQuerySchema>;

export const taskIdParamsSchema = z.object({ id: z.uuid("Invalid task id") });
