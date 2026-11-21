import { AssignmentStatus, type AcknowledgeTaskResponse, type Paginated, type TaskCountsDto, type TaskDto } from "@smart-waste/shared";

import type { Db } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import { reportDetailInclude, toReportDetail } from "../reports/service.js";
import type { MyTasksQueryInput } from "./schemas.js";

const ACTIVE_ASSIGNMENT_STATUSES = [AssignmentStatus.PENDING, AssignmentStatus.ACKNOWLEDGED] as const;

const taskInclude = {
  report: { include: reportDetailInclude },
  assignedBy: { select: { id: true, name: true } },
} satisfies Prisma.AssignmentInclude;

type TaskRecord = Prisma.AssignmentGetPayload<{ include: typeof taskInclude }>;

function toTaskDto(row: TaskRecord, baseUrl: string, viewer: AuthenticatedUser): TaskDto {
  return {
    assignmentId: row.id,
    assignmentStatus: row.status,
    assignedAt: row.assignedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    note: row.note,
    assignedBy: row.assignedBy,
    report: toReportDetail(row.report, baseUrl, viewer.role),
  };
}

/**
 * A field officer's tasks (FR-07, Figure 4.6). A task is one assignment.
 * Progress on the report itself (IN_PROGRESS, RESOLVED) goes through
 * PATCH /reports/:id/status, which already checks the officer owns the task.
 */
export class TasksService {
  constructor(private readonly db: Db) {}

  async listMine(user: AuthenticatedUser, query: MyTasksQueryInput, baseUrl: string): Promise<Paginated<TaskDto>> {
    const where: Prisma.AssignmentWhereInput = {
      assigneeId: user.id,
      status: query.group === "active" ? { in: [...ACTIVE_ASSIGNMENT_STATUSES] } : AssignmentStatus.COMPLETED,
    };
    // Active: most urgent first, then oldest first. Completed: most recent first.
    const orderBy: Prisma.AssignmentOrderByWithRelationInput[] =
      query.group === "active"
        ? [{ report: { priority: "desc" } }, { assignedAt: "asc" }]
        : [{ completedAt: "desc" }];

    const [total, rows] = await Promise.all([
      this.db.assignment.count({ where }),
      this.db.assignment.findMany({
        where,
        include: taskInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map((row) => toTaskDto(row, baseUrl, user)), page: query.page, pageSize: query.pageSize, total };
  }

  async countsMine(user: AuthenticatedUser): Promise<TaskCountsDto> {
    const [active, completed] = await Promise.all([
      this.db.assignment.count({ where: { assigneeId: user.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } }),
      this.db.assignment.count({ where: { assigneeId: user.id, status: AssignmentStatus.COMPLETED } }),
    ]);
    return { active, completed };
  }

  /** One of the officer's own tasks, in any state. Someone else's id gives 404. */
  async getMine(user: AuthenticatedUser, assignmentId: string, baseUrl: string): Promise<TaskDto> {
    const row = await this.db.assignment.findFirst({
      where: { id: assignmentId, assigneeId: user.id },
      include: taskInclude,
    });
    if (!row) throw ApiError.notFound("Task");
    return toTaskDto(row, baseUrl, user);
  }

  /**
   * "Acknowledge" (Figure 4.6): the officer confirms they have seen the task.
   * PENDING -> ACKNOWLEDGED. Already acknowledged is fine (same answer);
   * a completed or reassigned task cannot be acknowledged.
   */
  async acknowledge(user: AuthenticatedUser, assignmentId: string): Promise<AcknowledgeTaskResponse> {
    const row = await this.db.assignment.findFirst({
      where: { id: assignmentId, assigneeId: user.id },
      select: { id: true, status: true, acknowledgedAt: true },
    });
    if (!row) throw ApiError.notFound("Task");

    if (row.status === AssignmentStatus.ACKNOWLEDGED) {
      return { assignmentId: row.id, assignmentStatus: row.status, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null };
    }
    if (row.status !== AssignmentStatus.PENDING) {
      throw ApiError.conflict(
        row.status === AssignmentStatus.COMPLETED ? "This task is already completed" : "This task was reassigned to another officer",
      );
    }

    const updated = await this.db.assignment.update({
      where: { id: row.id },
      data: { status: AssignmentStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
      select: { id: true, status: true, acknowledgedAt: true },
    });
    return {
      assignmentId: updated.id,
      assignmentStatus: updated.status,
      acknowledgedAt: updated.acknowledgedAt?.toISOString() ?? null,
    };
  }
}
