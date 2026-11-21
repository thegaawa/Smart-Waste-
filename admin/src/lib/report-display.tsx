import {
  PRIORITY_LABELS,
  REPORT_STATUS_CITIZEN_MESSAGES,
  REPORT_STATUS_LABELS,
  type Priority,
  type ReportStatus,
} from "@smart-waste/shared";

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StatusPill({ status }: { status: ReportStatus }) {
  return <span className={`pill pill-status-${status.toLowerCase()}`}>{REPORT_STATUS_LABELS[status]}</span>;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  return <span className={`pill pill-priority-${priority.toLowerCase()}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function citizenMessage(status: ReportStatus): string {
  return REPORT_STATUS_CITIZEN_MESSAGES[status];
}
