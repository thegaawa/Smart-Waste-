import {
  ALL_PRIORITIES,
  ALL_REPORT_STATUSES,
  PRIORITY_LABELS,
  REPORT_STATUS_LABELS,
  isReportStatus,
  type CategoryDto,
  type Paginated,
  type Priority,
  type ReportStatus,
  type ReportSummaryDto,
} from "@smart-waste/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { describeError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, StatusPill, PriorityPill } from "../lib/report-display";

const PAGE_SIZE = 20;

/** Admin report queue (Figure 4.4 / FR-09). */
export function ReportsPage() {
  const { authedRequest } = useAuth();
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [status, setStatus] = useState<ReportStatus | "">(
    initialStatus && isReportStatus(initialStatus) ? initialStatus : "",
  );
  const [priority, setPriority] = useState<Priority | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [data, setData] = useState<Paginated<ReportSummaryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    authedRequest<CategoryDto[]>("/admin/categories", { signal: controller.signal })
      .then(setCategories)
      .catch(() => undefined);
    return () => controller.abort();
  }, [authedRequest]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);
      if (categoryId) params.set("categoryId", categoryId);
      if (query.trim()) params.set("q", query.trim());
      try {
        const result = await authedRequest<Paginated<ReportSummaryDto>>(`/admin/reports?${params}`, { signal });
        setData(result);
        setError(null);
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) setError(describeError(e));
      }
    },
    [authedRequest, page, status, priority, categoryId, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">Validate, prioritise and assign every waste report from the community.</p>
        </div>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search reference, description or address"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          aria-label="Search reports"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ReportStatus | "");
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {ALL_REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value as Priority | "");
            setPage(1);
          }}
          aria-label="Filter by priority"
        >
          <option value="">All priorities</option>
          {ALL_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {!c.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Category</th>
            <th>Location</th>
            <th>Assignee</th>
            <th>Sent</th>
          </tr>
        </thead>
        <tbody>
          {data === null ? (
            <tr>
              <td colSpan={7} className="muted">
                Loading…
              </td>
            </tr>
          ) : data.items.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                No reports match.
              </td>
            </tr>
          ) : (
            data.items.map((report) => (
              <tr key={report.id}>
                <td>
                  <Link to={`/reports/${report.id}`}>
                    <strong>{report.reference}</strong>
                  </Link>
                  {report.photoCount > 0 ? (
                    <div className="muted">
                      {report.photoCount} photo{report.photoCount === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </td>
                <td>
                  <StatusPill status={report.status} />
                </td>
                <td>
                  <PriorityPill priority={report.priority} />
                </td>
                <td>{report.category.name}</td>
                <td>
                  <div>{report.address ?? `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`}</div>
                </td>
                <td>{report.assignee?.name ?? "—"}</td>
                <td className="muted">{formatDateTime(report.createdAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pager">
        <span>
          {data ? `${data.total} report${data.total === 1 ? "" : "s"}` : ""} · Page {page} of {totalPages}
        </span>
        <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
