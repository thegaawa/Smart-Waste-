import { Role } from "./roles.js";

/**
 * Report life cycle (Chapter 3.7, 3.8 and 4.4 of the project document).
 *
 *   NEW -> VALIDATED -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED
 *   NEW / VALIDATED -> REJECTED
 *
 * The API is the only place that changes a status. Every change writes a
 * StatusHistory row and a Notification (FR-08, FR-10).
 */
export const ReportStatus = {
  NEW: "NEW",
  VALIDATED: "VALIDATED",
  REJECTED: "REJECTED",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
} as const;

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const ALL_REPORT_STATUSES: readonly ReportStatus[] = [
  ReportStatus.NEW,
  ReportStatus.VALIDATED,
  ReportStatus.REJECTED,
  ReportStatus.ASSIGNED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.RESOLVED,
  ReportStatus.CLOSED,
];

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (ALL_REPORT_STATUSES as readonly string[]).includes(value);
}

/** Short labels for status chips (matches the Figure 4.5 / 4.7 mock-ups). */
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  NEW: "New",
  VALIDATED: "Validated",
  REJECTED: "Rejected",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

/** Timeline / notification wording shown to the citizen for each status. */
export const REPORT_STATUS_CITIZEN_MESSAGES: Record<ReportStatus, string> = {
  NEW: "Report received",
  VALIDATED: "Validated by admin",
  REJECTED: "Report not accepted",
  ASSIGNED: "Assigned to field team",
  IN_PROGRESS: "Collection in progress",
  RESOLVED: "Report resolved",
  CLOSED: "Report closed",
};

/** Open reports closer than this are pointed out on the admin report page. */
export const NEARBY_OPEN_REPORT_METRES = 100;

/** The admin is warned once a citizen has at least this many other rejected reports. */
export const REJECTED_REPORTS_WARNING_COUNT = 3;

/** Statuses that count as "open" on the citizen dashboard (Figure 4.2). */
export const OPEN_REPORT_STATUSES: readonly ReportStatus[] = [
  ReportStatus.NEW,
  ReportStatus.VALIDATED,
  ReportStatus.ASSIGNED,
  ReportStatus.IN_PROGRESS,
];

/** Statuses that count as "resolved" on the citizen dashboard. */
export const RESOLVED_REPORT_STATUSES: readonly ReportStatus[] = [
  ReportStatus.RESOLVED,
  ReportStatus.CLOSED,
];

export const TERMINAL_REPORT_STATUSES: readonly ReportStatus[] = [
  ReportStatus.CLOSED,
  ReportStatus.REJECTED,
];

export function isTerminalStatus(status: ReportStatus): boolean {
  return TERMINAL_REPORT_STATUSES.includes(status);
}

/**
 * Allowed status changes and the roles that may make them.
 *
 * Notes:
 * - VALIDATED -> ASSIGNED only happens through the assign endpoint (admin).
 * - FIELD may only act on a report that is currently assigned to them; that
 *   ownership check is done in the API service, not in this table.
 * - RESOLVED -> IN_PROGRESS lets an admin reopen a report that was not fixed.
 */
export const REPORT_TRANSITIONS: Readonly<
  Record<ReportStatus, Readonly<Partial<Record<ReportStatus, readonly Role[]>>>>
> = {
  NEW: { VALIDATED: [Role.ADMIN], REJECTED: [Role.ADMIN] },
  VALIDATED: { ASSIGNED: [Role.ADMIN], REJECTED: [Role.ADMIN] },
  ASSIGNED: { IN_PROGRESS: [Role.FIELD, Role.ADMIN] },
  IN_PROGRESS: { RESOLVED: [Role.FIELD, Role.ADMIN] },
  RESOLVED: { CLOSED: [Role.ADMIN], IN_PROGRESS: [Role.ADMIN] },
  CLOSED: {},
  REJECTED: {},
};

/** True when `role` may move a report from `from` to `to`. */
export function canTransition(from: ReportStatus, to: ReportStatus, role: Role): boolean {
  const allowedRoles = REPORT_TRANSITIONS[from][to];
  return allowedRoles !== undefined && allowedRoles.includes(role);
}

/** Statuses that `role` may move a report to from `from`. */
export function nextStatusesFor(from: ReportStatus, role: Role): ReportStatus[] {
  const targets = REPORT_TRANSITIONS[from];
  return (Object.keys(targets) as ReportStatus[]).filter((to) => canTransition(from, to, role));
}

/** Report priority (WasteReports.priority in Table 3.3). */
export const Priority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;

export type Priority = (typeof Priority)[keyof typeof Priority];

export const ALL_PRIORITIES: readonly Priority[] = [Priority.LOW, Priority.MEDIUM, Priority.HIGH];

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (ALL_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Assignment status (Assignments.status in Table 3.3).
 * The field officer's "Acknowledge" button updates this, not the report status.
 */
export const AssignmentStatus = {
  PENDING: "PENDING",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  COMPLETED: "COMPLETED",
  REASSIGNED: "REASSIGNED",
} as const;

export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

/** Human-readable reference numbers look like SW-1042 (FR-04, Figure 4.5). */
export const REPORT_REFERENCE_PREFIX = "SW";
export const REPORT_REFERENCE_PATTERN = /^SW-\d{4,}$/;

export function isReportReference(value: string): boolean {
  return REPORT_REFERENCE_PATTERN.test(value);
}

/**
 * Limits for a new report (FR-02). The app compresses photos to roughly
 * 300 KB before upload; the API enforces the hard cap.
 */
export const REPORT_DESCRIPTION_MIN_LENGTH = 5;
export const REPORT_DESCRIPTION_MAX_LENGTH = 1000;
export const REPORT_ADDRESS_MAX_LENGTH = 200;
export const MAX_REPORT_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];
