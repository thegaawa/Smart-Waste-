import { randomUUID } from "node:crypto";

import {
  ALL_REPORT_STATUSES,
  NEARBY_OPEN_REPORT_METRES,
  OPEN_REPORT_STATUSES,
  REPORT_REFERENCE_PREFIX,
  RESOLVED_REPORT_STATUSES,
  ReportStatus,
  Role,
  UserStatus,
  canTransition,
  type AllowedPhotoMimeType,
  type AdminStatsDto,
  type AssignmentDto,
  type MediaDto,
  type Paginated,
  type ReportCountsDto,
  type ReportDetailDto,
  type ReportReviewDto,
  type ReportSummaryDto,
  type StatusHistoryDto,
} from "@smart-waste/shared";

import type { Db } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../lib/errors.js";
import { sniffImage } from "../../lib/images.js";
import { mediaUrl } from "../../lib/media-urls.js";
import type { ObjectStorage } from "../../lib/storage.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import type { UploadedFile } from "../../middleware/upload.js";
import { citizenStatusMessage, fieldNewTaskMessage, fieldReassignedMessage } from "../notifications/messages.js";
import type { PushEvent, PushService } from "../push/service.js";
import type {
  AdminReportsQueryInput,
  AssignReportInput,
  CreateReportInput,
  MyReportsQueryInput,
  UpdatePriorityInput,
  UpdateStatusInput,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Query shapes and DTO mapping (shared with the admin and task modules later)
// ---------------------------------------------------------------------------

export const reportSummaryInclude = {
  category: { select: { id: true, name: true } },
  _count: { select: { media: true } },
  assignments: {
    orderBy: { assignedAt: "desc" },
    take: 1,
    include: { assignee: { select: { id: true, name: true } } },
  },
} satisfies Prisma.WasteReportInclude;

export const reportDetailInclude = {
  category: { select: { id: true, name: true } },
  media: { orderBy: { uploadedAt: "asc" } },
  history: {
    orderBy: { changedAt: "asc" },
    include: { changedBy: { select: { id: true, name: true, role: true } } },
  },
  assignments: {
    orderBy: { assignedAt: "desc" },
    take: 1,
    include: {
      assignee: { select: { id: true, name: true } },
      assignedBy: { select: { id: true, name: true } },
    },
  },
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.WasteReportInclude;

export type ReportSummaryRecord = Prisma.WasteReportGetPayload<{ include: typeof reportSummaryInclude }>;
export type ReportDetailRecord = Prisma.WasteReportGetPayload<{ include: typeof reportDetailInclude }>;

export function toReportSummary(
  report: ReportSummaryRecord,
  options: { includeAssignee?: boolean } = {},
): ReportSummaryDto {
  const latest = report.assignments[0];
  return {
    id: report.id,
    reference: report.reference,
    status: report.status,
    priority: report.priority,
    category: report.category,
    address: report.address,
    latitude: report.latitude,
    longitude: report.longitude,
    photoCount: report._count.media,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    ...(options.includeAssignee
      ? { assignee: latest && latest.status !== "REASSIGNED" ? latest.assignee : null }
      : {}),
  };
}

function toMediaDto(media: ReportDetailRecord["media"][number], baseUrl: string): MediaDto {
  return {
    id: media.id,
    url: mediaUrl(baseUrl, media.id),
    mediaType: media.mediaType,
    uploadedAt: media.uploadedAt.toISOString(),
  };
}

function toHistoryDto(entry: ReportDetailRecord["history"][number]): StatusHistoryDto {
  return {
    id: entry.id,
    oldStatus: entry.oldStatus,
    newStatus: entry.newStatus,
    note: entry.note,
    changedAt: entry.changedAt.toISOString(),
    changedBy: entry.changedBy,
  };
}

function toAssignmentDto(assignment: ReportDetailRecord["assignments"][number]): AssignmentDto {
  return {
    id: assignment.id,
    status: assignment.status,
    assignee: assignment.assignee,
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.assignedAt.toISOString(),
    dueAt: assignment.dueAt?.toISOString() ?? null,
    note: assignment.note,
  };
}

/**
 * Full report for one viewer. Administrators also see who reported it; field
 * officers and citizens do not (3.12: data is not exposed to roles that do
 * not need it).
 */
export function toReportDetail(report: ReportDetailRecord, baseUrl: string, viewerRole: Role): ReportDetailDto {
  const latestAssignment = report.assignments[0];
  const activeAssignment =
    latestAssignment && latestAssignment.status !== "REASSIGNED" ? latestAssignment : null;
  return {
    id: report.id,
    reference: report.reference,
    status: report.status,
    priority: report.priority,
    category: report.category,
    address: report.address,
    latitude: report.latitude,
    longitude: report.longitude,
    photoCount: report.media.length,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    description: report.description,
    media: report.media.map((media) => toMediaDto(media, baseUrl)),
    history: report.history.map(toHistoryDto),
    assignment: activeAssignment ? toAssignmentDto(activeAssignment) : null,
    validatedAt: report.validatedAt?.toISOString() ?? null,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    closedAt: report.closedAt?.toISOString() ?? null,
    ...(viewerRole === Role.ADMIN
      ? {
          citizen: report.user,
          assignee: activeAssignment ? activeAssignment.assignee : null,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface PreparedPhoto {
  id: string;
  key: string;
  buffer: Buffer;
  mimeType: AllowedPhotoMimeType;
  size: number;
}

export interface CreateReportResult {
  report: ReportDetailDto;
  /** True when the idempotency key matched an earlier submission (nothing new was stored). */
  replayed: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function timestampPatch(to: ReportStatus): Prisma.WasteReportUpdateInput {
  const now = new Date();
  switch (to) {
    case ReportStatus.VALIDATED:
      return { validatedAt: now };
    case ReportStatus.RESOLVED:
      return { resolvedAt: now };
    case ReportStatus.CLOSED:
      return { closedAt: now };
    case ReportStatus.IN_PROGRESS:
      // Reopening a resolved report clears the resolved stamp.
      return { resolvedAt: null };
    default:
      return {};
  }
}

export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly storage: ObjectStorage,
    /** When given, every notification written here is also pushed to the user's phone. */
    private readonly push?: PushService,
  ) {}

  /**
   * Creates a report (FR-02, FR-03, FR-04): validates the category, checks
   * every photo really is an image, stores the photos, then in one database
   * transaction takes the next reference number, inserts the report, its
   * media rows and the first status-history entry.
   *
   * Idempotency (Chapter 4.6): the same user sending the same
   * `idempotencyKey` again gets the original report back, even if the first
   * response was lost on a poor network.
   */
  async create(
    user: AuthenticatedUser,
    input: CreateReportInput,
    files: UploadedFile[],
    baseUrl: string,
  ): Promise<CreateReportResult> {
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(user.id, input.idempotencyKey);
      if (existing) return { report: toReportDetail(existing, baseUrl, user.role), replayed: true };
    }

    const category = await this.db.category.findUnique({ where: { id: input.categoryId } });
    if (!category || !category.active) {
      throw ApiError.validation([
        { field: "categoryId", message: "This category is not available. Please choose another" },
      ]);
    }

    const photos = preparePhotos(files);
    const stored: PreparedPhoto[] = [];

    try {
      for (const photo of photos) {
        await this.storage.put(photo.key, photo.buffer, photo.mimeType);
        stored.push(photo);
      }

      // One transaction, strictly one statement at a time on its connection:
      // reference number, report row, photo rows, first history entry.
      const reportId = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('report_reference_seq')`;
        const next = rows[0]?.nextval;
        if (next === undefined) throw new Error("report_reference_seq returned no value");
        const reference = `${REPORT_REFERENCE_PREFIX}-${next.toString()}`;

        const created = await tx.wasteReport.create({
          data: {
            reference,
            userId: user.id,
            categoryId: category.id,
            description: input.description,
            latitude: input.latitude,
            longitude: input.longitude,
            address: input.address ?? null,
            priority: category.defaultPriority,
            idempotencyKey: input.idempotencyKey ?? null,
          },
          select: { id: true },
        });

        if (photos.length > 0) {
          await tx.reportMedia.createMany({
            data: photos.map((photo) => ({
              id: photo.id,
              reportId: created.id,
              storageKey: photo.key,
              mimeType: photo.mimeType,
              sizeBytes: photo.size,
            })),
          });
        }

        await tx.statusHistory.create({
          data: { reportId: created.id, oldStatus: null, newStatus: ReportStatus.NEW, changedById: user.id },
        });

        return created.id;
      });

      const record = await this.db.wasteReport.findUniqueOrThrow({
        where: { id: reportId },
        include: reportDetailInclude,
      });
      return { report: toReportDetail(record, baseUrl, user.role), replayed: false };
    } catch (error) {
      // The database write failed: do not leave orphan files behind.
      await Promise.all(stored.map((photo) => this.storage.delete(photo.key).catch(() => undefined)));

      // Two identical submissions raced past the first check; return the winner.
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(user.id, input.idempotencyKey);
        if (existing) return { report: toReportDetail(existing, baseUrl, user.role), replayed: true };
      }
      throw error;
    }
  }

  private findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<ReportDetailRecord | null> {
    return this.db.wasteReport.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: reportDetailInclude,
    });
  }

  /** The signed-in user's own reports, newest first (FR-05). */
  async listMine(user: AuthenticatedUser, query: MyReportsQueryInput): Promise<Paginated<ReportSummaryDto>> {
    const statuses = query.status
      ? [query.status]
      : query.group === "open"
        ? OPEN_REPORT_STATUSES
        : query.group === "resolved"
          ? RESOLVED_REPORT_STATUSES
          : undefined;

    const where: Prisma.WasteReportWhereInput = {
      userId: user.id,
      ...(statuses ? { status: { in: [...statuses] } } : {}),
    };

    const [total, rows] = await Promise.all([
      this.db.wasteReport.count({ where }),
      this.db.wasteReport.findMany({
        where,
        include: reportSummaryInclude,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { items: rows.map((row) => toReportSummary(row)), page: query.page, pageSize: query.pageSize, total };
  }

  /** Open / resolved counts for the citizen home screen (Figure 4.2). */
  async countsMine(user: AuthenticatedUser): Promise<ReportCountsDto> {
    const groups = await this.db.wasteReport.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    });
    let open = 0;
    let resolved = 0;
    for (const group of groups) {
      if (OPEN_REPORT_STATUSES.includes(group.status)) open += group._count._all;
      else if (RESOLVED_REPORT_STATUSES.includes(group.status)) resolved += group._count._all;
    }
    return { open, resolved };
  }

  /**
   * One report, if the viewer may see it: the citizen who sent it, any
   * administrator, or a field officer it has been assigned to. Anyone else
   * gets 404, so report ids reveal nothing.
   */
  async getForViewer(user: AuthenticatedUser, id: string, baseUrl: string): Promise<ReportDetailDto> {
    const where: Prisma.WasteReportWhereInput =
      user.role === Role.ADMIN
        ? { id }
        : user.role === Role.FIELD
          ? { id, assignments: { some: { assigneeId: user.id } } }
          : { id, userId: user.id };

    const record = await this.db.wasteReport.findFirst({ where, include: reportDetailInclude });
    if (!record) throw ApiError.notFound("Report");
    const detail = toReportDetail(record, baseUrl, user.role);
    if (user.role !== Role.ADMIN) return detail;
    return { ...detail, review: await this.reviewForAdmin(record) };
  }

  /**
   * Two warnings for the administrator. Neither one stops validate or assign.
   * Nearby means another open report within NEARBY_OPEN_REPORT_METRES.
   * The rejected count is this citizen's other reports, not the one on screen.
   */
  private async reviewForAdmin(report: ReportDetailRecord): Promise<ReportReviewDto> {
    const latDelta = NEARBY_OPEN_REPORT_METRES / 111_320;
    const cosLat = Math.cos((report.latitude * Math.PI) / 180);
    const lngDelta = NEARBY_OPEN_REPORT_METRES / (111_320 * Math.max(Math.abs(cosLat), 0.2));

    const [candidates, rejectedReportCount] = await Promise.all([
      this.db.wasteReport.findMany({
        where: {
          id: { not: report.id },
          status: { in: [...OPEN_REPORT_STATUSES] },
          latitude: { gte: report.latitude - latDelta, lte: report.latitude + latDelta },
          longitude: { gte: report.longitude - lngDelta, lte: report.longitude + lngDelta },
        },
        select: { id: true, reference: true, latitude: true, longitude: true },
        take: 40,
      }),
      this.db.wasteReport.count({
        where: { userId: report.userId, status: ReportStatus.REJECTED, id: { not: report.id } },
      }),
    ]);

    const nearbyOpenReports = candidates
      .map((other) => ({
        id: other.id,
        reference: other.reference,
        distanceMetres: Math.round(distanceMetres(report.latitude, report.longitude, other.latitude, other.longitude)),
      }))
      .filter((other) => other.distanceMetres <= NEARBY_OPEN_REPORT_METRES)
      .sort((a, b) => a.distanceMetres - b.distanceMetres)
      .slice(0, 8);

    return { nearbyOpenReports, rejectedReportCount };
  }

  // -------------------------------------------------------------------------
  // Admin operations (FR-06, FR-09, Chapter 4.4)
  // -------------------------------------------------------------------------

  /** Every report for the admin queue, with filters and paging. */
  async listForAdmin(query: AdminReportsQueryInput): Promise<Paginated<ReportSummaryDto>> {
    const fromDate = query.from ? new Date(query.from) : undefined;
    const toDate = query.to ? new Date(query.to) : undefined;
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const where: Prisma.WasteReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId
        ? { assignments: { some: { assigneeId: query.assigneeId, status: { not: "REASSIGNED" } } } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { reference: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
              { address: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.db.wasteReport.count({ where }),
      this.db.wasteReport.findMany({
        where,
        include: reportSummaryInclude,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => toReportSummary(row, { includeAssignee: true })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Counts by status plus how many open reports are older than 72 hours. */
  async adminStats(): Promise<AdminStatsDto> {
    const ageingCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const [groups, ageingOpen] = await Promise.all([
      this.db.wasteReport.groupBy({ by: ["status"], _count: { _all: true } }),
      this.db.wasteReport.count({
        where: { status: { in: [...OPEN_REPORT_STATUSES] }, createdAt: { lt: ageingCutoff } },
      }),
    ]);

    const byStatus = Object.fromEntries(ALL_REPORT_STATUSES.map((status) => [status, 0])) as Record<
      ReportStatus,
      number
    >;
    let total = 0;
    for (const group of groups) {
      byStatus[group.status] = group._count._all;
      total += group._count._all;
    }
    return { byStatus, total, ageingOpen };
  }

  /**
   * Moves a report to a new status when the role is allowed (FR-06, FR-10).
   * ASSIGNED is refused here — use `assign` so the officer is stored too.
   * The citizen is notified in the same transaction (FR-08, T07, T10).
   */
  async updateStatus(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateStatusInput,
    baseUrl: string,
  ): Promise<ReportDetailDto> {
    const report = await this.db.wasteReport.findUnique({ where: { id } });
    if (!report) throw ApiError.notFound("Report");

    if (!canTransition(report.status, input.status, actor.role)) {
      throw ApiError.invalidTransition(
        `A ${actor.role.toLowerCase()} cannot move a report from ${report.status} to ${input.status}`,
      );
    }

    // Field officers may only act on a report currently assigned to them.
    if (actor.role === Role.FIELD) {
      const assignment = await this.db.assignment.findFirst({
        where: { reportId: id, assigneeId: actor.id, status: { in: ["PENDING", "ACKNOWLEDGED"] } },
      });
      if (!assignment) throw ApiError.forbidden("This report is not assigned to you");
    }

    const message = citizenStatusMessage(report.reference, input.status, input.note);

    await this.db.$transaction(async (tx) => {
      await tx.wasteReport.update({
        where: { id },
        data: { status: input.status, ...timestampPatch(input.status) },
      });
      await tx.statusHistory.create({
        data: {
          reportId: id,
          oldStatus: report.status,
          newStatus: input.status,
          changedById: actor.id,
          note: input.note ?? null,
        },
      });
      if (input.status === ReportStatus.RESOLVED) {
        await tx.assignment.updateMany({
          where: { reportId: id, status: { in: ["PENDING", "ACKNOWLEDGED"] } },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
      await tx.notification.create({
        data: { userId: report.userId, reportId: id, message },
      });
    });

    // Committed: now (and only now) alert the citizen's phone as well.
    this.push?.dispatch([{ userId: report.userId, body: message, reportId: id, reference: report.reference }]);

    return this.getForViewer(actor, id, baseUrl);
  }

  async updatePriority(
    actor: AuthenticatedUser,
    id: string,
    input: UpdatePriorityInput,
    baseUrl: string,
  ): Promise<ReportDetailDto> {
    if (actor.role !== Role.ADMIN) throw ApiError.forbidden();
    const report = await this.db.wasteReport.findUnique({ where: { id }, select: { id: true, priority: true } });
    if (!report) throw ApiError.notFound("Report");
    if (report.priority === input.priority) return this.getForViewer(actor, id, baseUrl);

    await this.db.wasteReport.update({ where: { id }, data: { priority: input.priority } });
    return this.getForViewer(actor, id, baseUrl);
  }

  /**
   * Assigns (or reassigns) a report to an active field officer (FR-06, T06).
   * From VALIDATED: creates the assignment and moves the status to ASSIGNED.
   * From ASSIGNED / IN_PROGRESS: marks the old assignment REASSIGNED and opens
   * a new PENDING one, resetting status to ASSIGNED for the new officer.
   */
  async assign(
    actor: AuthenticatedUser,
    id: string,
    input: AssignReportInput,
    baseUrl: string,
  ): Promise<ReportDetailDto> {
    if (actor.role !== Role.ADMIN) throw ApiError.forbidden();

    const report = await this.db.wasteReport.findUnique({
      where: { id },
      include: { category: { select: { name: true } } },
    });
    if (!report) throw ApiError.notFound("Report");

    const assignee = await this.db.user.findUnique({
      where: { id: input.assigneeId },
      select: { id: true, role: true, status: true, name: true },
    });
    if (!assignee || assignee.role !== Role.FIELD || assignee.status !== UserStatus.ACTIVE) {
      throw ApiError.validation([{ field: "assigneeId", message: "Choose an active field officer" }]);
    }

    const assignable: ReportStatus[] = [ReportStatus.VALIDATED, ReportStatus.ASSIGNED, ReportStatus.IN_PROGRESS];
    if (!assignable.includes(report.status)) {
      throw ApiError.invalidTransition(
        report.status === ReportStatus.NEW
          ? "Validate the report before assigning it"
          : `A report in status ${report.status} cannot be assigned`,
      );
    }

    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw ApiError.validation([{ field: "dueAt", message: "Enter a valid due date" }]);
    }

    const movingToAssigned = report.status !== ReportStatus.ASSIGNED;
    const note =
      input.note ??
      (report.status === ReportStatus.IN_PROGRESS || report.status === ReportStatus.ASSIGNED
        ? `Reassigned to ${assignee.name}`
        : null);

    // Officers who currently hold the task and are about to lose it.
    const previousHolders = await this.db.assignment.findMany({
      where: { reportId: id, status: { in: ["PENDING", "ACKNOWLEDGED"] }, assigneeId: { not: assignee.id } },
      select: { assigneeId: true },
      distinct: ["assigneeId"],
    });

    const notifications: PushEvent[] = [
      {
        userId: assignee.id,
        reportId: id,
        reference: report.reference,
        body: fieldNewTaskMessage(report.reference, report.category.name, report.priority),
      },
      ...previousHolders.map((holder) => ({
        userId: holder.assigneeId,
        reportId: id,
        reference: report.reference,
        body: fieldReassignedMessage(report.reference),
      })),
      ...(movingToAssigned
        ? [
            {
              userId: report.userId,
              reportId: id,
              reference: report.reference,
              body: citizenStatusMessage(report.reference, ReportStatus.ASSIGNED),
            },
          ]
        : []),
    ];

    await this.db.$transaction(async (tx) => {
      await tx.assignment.updateMany({
        where: { reportId: id, status: { in: ["PENDING", "ACKNOWLEDGED"] } },
        data: { status: "REASSIGNED" },
      });
      await tx.assignment.create({
        data: {
          reportId: id,
          assigneeId: assignee.id,
          assignedById: actor.id,
          note: input.note ?? null,
          dueAt,
        },
      });
      if (movingToAssigned) {
        await tx.wasteReport.update({ where: { id }, data: { status: ReportStatus.ASSIGNED } });
        await tx.statusHistory.create({
          data: {
            reportId: id,
            oldStatus: report.status,
            newStatus: ReportStatus.ASSIGNED,
            changedById: actor.id,
            note,
          },
        });
      } else if (input.note) {
        await tx.statusHistory.create({
          data: {
            reportId: id,
            oldStatus: ReportStatus.ASSIGNED,
            newStatus: ReportStatus.ASSIGNED,
            changedById: actor.id,
            note: input.note,
          },
        });
      }

      // FR-08: tell the new officer, anyone who lost the task, and the citizen.
      await tx.notification.createMany({
        data: notifications.map((event) => ({ userId: event.userId, reportId: id, message: event.body })),
      });
    });

    // Committed: the same messages go to the phones of everyone involved.
    this.push?.dispatch(notifications);

    return this.getForViewer(actor, id, baseUrl);
  }
}

/** Straight-line distance in metres. Accurate enough for a "near this spot" check. */
function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earth = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Checks each upload is a real image and gives it an id and storage key. */
function preparePhotos(files: UploadedFile[]): PreparedPhoto[] {
  const problems: { field: string; message: string }[] = [];
  const photos: PreparedPhoto[] = [];
  const now = new Date();
  const folder = `photos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  files.forEach((file, index) => {
    const info = sniffImage(file.buffer);
    if (!info) {
      problems.push({ field: "photos", message: `Photo ${index + 1} is not a JPEG, PNG or WebP image` });
      return;
    }
    const id = randomUUID();
    photos.push({
      id,
      key: `${folder}/${id}.${info.extension}`,
      buffer: file.buffer,
      mimeType: info.mimeType,
      size: file.size,
    });
  });

  if (problems.length > 0) throw ApiError.validation(problems);
  return photos;
}
