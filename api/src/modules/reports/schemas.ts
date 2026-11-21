import {
  ALL_PRIORITIES,
  ALL_REPORT_STATUSES,
  REPORT_ADDRESS_MAX_LENGTH,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_DESCRIPTION_MIN_LENGTH,
  ReportStatus,
  type Priority,
  type ReportStatus as ReportStatusType,
} from "@smart-waste/shared";
import { z } from "zod";

import { requiredString } from "../auth/schemas.js";

/** Empty strings (an unfilled multipart field) count as "not sent". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Accepts a number, or a numeric string (multipart form fields arrive as text). */
function numberField(label: string, min: number, max: number) {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    },
    z
      .number({
        error: (issue) => (issue.input === undefined ? `${label} is required` : `${label} must be a number`),
      })
      .min(min, `${label} must be between ${min} and ${max}`)
      .max(max, `${label} must be between ${min} and ${max}`),
  );
}

/** POST /reports (FR-02, FR-03). Photos travel as files, not in this schema. */
export const createReportSchema = z.object({
  categoryId: requiredString("Category")
    .trim()
    .min(1, "Category is required")
    .pipe(z.uuid("Choose a valid category")),
  description: requiredString("Description")
    .trim()
    .min(REPORT_DESCRIPTION_MIN_LENGTH, `Describe the problem in at least ${REPORT_DESCRIPTION_MIN_LENGTH} characters`)
    .max(REPORT_DESCRIPTION_MAX_LENGTH, `Description must be at most ${REPORT_DESCRIPTION_MAX_LENGTH} characters`),
  latitude: numberField("Latitude", -90, 90),
  longitude: numberField("Longitude", -180, 180),
  address: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(REPORT_ADDRESS_MAX_LENGTH, `Address must be at most ${REPORT_ADDRESS_MAX_LENGTH} characters`).optional(),
  ),
  idempotencyKey: z.preprocess(
    emptyToUndefined,
    z.string().trim().pipe(z.uuid("Idempotency key must be a UUID")).optional(),
  ),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

/** GET /reports/my?status=NEW | ?group=open&page=1&pageSize=20 */
export const myReportsQuerySchema = z.object({
  status: z.enum(ALL_REPORT_STATUSES as [ReportStatusType, ...ReportStatusType[]]).optional(),
  group: z.enum(["open", "resolved"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type MyReportsQueryInput = z.infer<typeof myReportsQuerySchema>;

export const reportIdParamsSchema = z.object({ id: z.uuid("Invalid report id") });

/** Empty date strings count as unset. */
const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date")
    .optional(),
);

/** GET /admin/reports — FR-09 filters. */
export const adminReportsQuerySchema = z.object({
  status: z.enum(ALL_REPORT_STATUSES as [ReportStatusType, ...ReportStatusType[]]).optional(),
  categoryId: z.uuid("Invalid category id").optional(),
  priority: z.enum(ALL_PRIORITIES as [Priority, ...Priority[]]).optional(),
  assigneeId: z.uuid("Invalid assignee id").optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminReportsQueryInput = z.infer<typeof adminReportsQuerySchema>;

/**
 * PATCH /reports/:id/status. ASSIGNED is not allowed here — use POST .../assign
 * so the officer is recorded at the same time.
 */
export const updateStatusSchema = z
  .object({
    status: z.enum([
      ReportStatus.VALIDATED,
      ReportStatus.REJECTED,
      ReportStatus.IN_PROGRESS,
      ReportStatus.RESOLVED,
      ReportStatus.CLOSED,
    ] as [ReportStatusType, ...ReportStatusType[]]),
    note: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  })
  .superRefine((data, ctx) => {
    if (data.status === ReportStatus.REJECTED && (!data.note || data.note.length < 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Add a short reason when rejecting a report",
      });
    }
  });

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const updatePrioritySchema = z.object({
  priority: z.enum(ALL_PRIORITIES as [Priority, ...Priority[]]),
});

export type UpdatePriorityInput = z.infer<typeof updatePrioritySchema>;

export const assignReportSchema = z.object({
  assigneeId: requiredString("Field officer").trim().pipe(z.uuid("Choose a valid field officer")),
  dueAt: optionalDate,
  note: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
});

export type AssignReportInput = z.infer<typeof assignReportSchema>;
