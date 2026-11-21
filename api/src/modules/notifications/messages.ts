import { PRIORITY_LABELS, REPORT_STATUS_CITIZEN_MESSAGES, type Priority, type ReportStatus } from "@smart-waste/shared";

/**
 * Wording of in-app notifications (FR-08). Kept in one place so the API,
 * the tests and the project document all say the same thing.
 *
 * Examples:
 *   "SW-1042: Validated by admin"
 *   "SW-1042: Report not accepted — Duplicate of SW-1040"
 *   "New task SW-1042: Illegal dumping (High priority)"
 */

const NOTE_MAX_LENGTH = 200;

function withNote(message: string, note: string | null | undefined): string {
  const trimmed = note?.trim();
  if (!trimmed) return message;
  const short = trimmed.length > NOTE_MAX_LENGTH ? `${trimmed.slice(0, NOTE_MAX_LENGTH - 1)}…` : trimmed;
  return `${message} — ${short}`;
}

/** Sent to the citizen who reported the problem when its status changes. */
export function citizenStatusMessage(reference: string, status: ReportStatus, note?: string | null): string {
  return withNote(`${reference}: ${REPORT_STATUS_CITIZEN_MESSAGES[status]}`, note);
}

/** Sent to the field officer a report has just been assigned to. */
export function fieldNewTaskMessage(reference: string, categoryName: string, priority: Priority): string {
  return `New task ${reference}: ${categoryName} (${PRIORITY_LABELS[priority]} priority)`;
}

/** Sent to a field officer whose task was handed to someone else. */
export function fieldReassignedMessage(reference: string): string {
  return `${reference} was reassigned to another officer`;
}
