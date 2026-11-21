import {
  ALL_PRIORITIES,
  PRIORITY_LABELS,
  REJECTED_REPORTS_WARNING_COUNT,
  ReportStatus,
  Role,
  UserStatus,
  nextStatusesFor,
  type AuthUser,
  type Paginated,
  type Priority,
  type ReportDetailDto,
  type ReportReviewDto,
} from "@smart-waste/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router";

import { describeError, isApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PriorityPill, StatusPill, citizenMessage, formatDateTime } from "../lib/report-display";

/**
 * One report for an administrator: photo, map link, validate / reject,
 * priority, assign / reassign, close (FR-06, T06).
 */
export function ReportDetailPage() {
  const { id = "" } = useParams();
  const { authedRequest } = useAuth();
  const [report, setReport] = useState<ReportDetailDto | null>(null);
  const [fieldOfficers, setFieldOfficers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [rejectNote, setRejectNote] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [assignNote, setAssignNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  // Phones sometimes fill the first team in the list on their own. Ignore that
  // until the administrator actually opens the list.
  const teamPickerTouched = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, users] = await Promise.all([
        authedRequest<ReportDetailDto>(`/admin/reports/${id}`),
        authedRequest<Paginated<AuthUser>>(`/admin/users?role=${Role.FIELD}&status=${UserStatus.ACTIVE}&pageSize=100`),
      ]);
      setReport(detail);
      setFieldOfficers(users.items);
      setAssigneeId(detail.assignment?.assignee.id ?? "");
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [authedRequest, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const adminNext = useMemo(
    () => (report ? nextStatusesFor(report.status, Role.ADMIN).filter((s) => s !== ReportStatus.ASSIGNED) : []),
    [report],
  );

  const selectedTeam = fieldOfficers.some((officer) => officer.id === assigneeId);

  function markTeamPickerTouched() {
    teamPickerTouched.current = true;
  }

  function onTeamChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!teamPickerTouched.current) return;
    setAssigneeId(event.target.value);
  }

  async function run(action: () => Promise<ReportDetailDto>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await action();
      setReport(updated);
      setNotice(success);
      setRejectNote("");
      setAssignNote("");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!report && !error) {
    return <p className="muted">Loading report…</p>;
  }

  if (!report) {
    return (
      <>
        <div className="banner banner-error" role="alert">
          {error}
        </div>
        <Link to="/reports" className="btn btn-secondary">
          Back to reports
        </Link>
      </>
    );
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${report.latitude},${report.longitude}`;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="muted" style={{ marginBottom: "0.25rem" }}>
            <Link to="/reports">Reports</Link> / {report.reference}
          </p>
          <h1>{report.reference}</h1>
          <p className="muted">{report.category.name}</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <StatusPill status={report.status} />
          <PriorityPill priority={report.priority} />
        </div>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="banner banner-success" role="status">
          {notice}
        </div>
      ) : null}
      {report.review ? <ReviewWarnings review={report.review} /> : null}

      <div className="detail-grid">
        <div className="detail-main">
          {report.media.length > 0 ? (
            <div className="photo-row">
              {report.media.map((media) => (
                <a key={media.id} href={media.url} target="_blank" rel="noreferrer">
                  <img src={media.url} alt="Report evidence" className="report-photo" />
                </a>
              ))}
            </div>
          ) : null}

          <div className="card">
            <h2>Description</h2>
            <p style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>{report.description}</p>
          </div>

          <div className="card">
            <h2>Location</h2>
            <p>
              {report.address ?? "No street text"}
              <br />
              <span className="muted">
                {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
              </span>
            </p>
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
              Open in Google Maps
            </a>
          </div>

          <div className="card">
            <h2>Timeline</h2>
            <ol className="timeline">
              {report.history.map((entry) => (
                <li key={entry.id}>
                  <strong>{citizenMessage(entry.newStatus)}</strong>
                  <div className="muted">{formatDateTime(entry.changedAt)}</div>
                  {entry.changedBy ? (
                    <div className="muted">
                      by {entry.changedBy.name} ({entry.changedBy.role.toLowerCase()})
                    </div>
                  ) : null}
                  {entry.note ? <div>{entry.note}</div> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <aside className="detail-aside">
          <div className="card">
            <h2>Citizen</h2>
            <p style={{ marginBottom: "0.25rem" }}>
              <strong>{report.citizen?.name ?? "—"}</strong>
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              {report.citizen?.email ?? "—"}
              <br />
              {report.citizen?.phone ?? ""}
            </p>
          </div>

          <div className="card">
            <h2>Details</h2>
            <dl className="kv">
              <div>
                <dt>Sent</dt>
                <dd>{formatDateTime(report.createdAt)}</dd>
              </div>
              <div>
                <dt>Validated</dt>
                <dd>{report.validatedAt ? formatDateTime(report.validatedAt) : "—"}</dd>
              </div>
              <div>
                <dt>Resolved</dt>
                <dd>{report.resolvedAt ? formatDateTime(report.resolvedAt) : "—"}</dd>
              </div>
              <div>
                <dt>Closed</dt>
                <dd>{report.closedAt ? formatDateTime(report.closedAt) : "—"}</dd>
              </div>
              <div>
                <dt>Assignee</dt>
                <dd>{report.assignment?.assignee.name ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="card">
            <h2>Priority</h2>
            <select
              value={report.priority}
              disabled={busy}
              onChange={(e) => {
                const priority = e.target.value as Priority;
                void run(
                  () => authedRequest<ReportDetailDto>(`/reports/${report.id}/priority`, { method: "PATCH", body: { priority } }),
                  `Priority set to ${PRIORITY_LABELS[priority]}.`,
                );
              }}
              aria-label="Priority"
            >
              {ALL_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {adminNext.includes(ReportStatus.VALIDATED) ? (
            <div className="card">
              <h2>Validate</h2>
              <p className="muted">Confirm this is a real waste problem before assigning a field officer.</p>
              <button
                type="button"
                className="btn btn-block"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/status`, {
                        method: "PATCH",
                        body: { status: ReportStatus.VALIDATED },
                      }),
                    "Report validated.",
                  )
                }
              >
                Validate report
              </button>
            </div>
          ) : null}

          {adminNext.includes(ReportStatus.REJECTED) ? (
            <div className="card">
              <h2>Reject</h2>
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/status`, {
                        method: "PATCH",
                        body: { status: ReportStatus.REJECTED, note: rejectNote.trim() },
                      }),
                    "Report rejected.",
                  );
                }}
              >
                <div className="field">
                  <label htmlFor="reject-note">Reason</label>
                  <input
                    id="reject-note"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Why this report is not accepted"
                    required
                    minLength={3}
                  />
                </div>
                <button type="submit" className="btn btn-danger btn-block" disabled={busy || rejectNote.trim().length < 3}>
                  Reject report
                </button>
              </form>
            </div>
          ) : null}

          {report.status === ReportStatus.VALIDATED ||
          report.status === ReportStatus.ASSIGNED ||
          report.status === ReportStatus.IN_PROGRESS ? (
            <div className="card">
              <h2>{report.assignment ? "Reassign" : "Assign"}</h2>
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  if (busy || !selectedTeam) return;
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/assign`, {
                        method: "POST",
                        body: {
                          assigneeId,
                          ...(assignNote.trim() ? { note: assignNote.trim() } : {}),
                          ...(dueAt ? { dueAt } : {}),
                        },
                      }),
                    report.assignment ? "Report reassigned." : "Report assigned to the field team.",
                  );
                }}
              >
                <div className="field">
                  <label htmlFor="assignee">Field team</label>
                  <select
                    id="assignee"
                    value={assigneeId}
                    onPointerDown={markTeamPickerTouched}
                    onKeyDown={markTeamPickerTouched}
                    onChange={onTeamChange}
                    autoComplete="off"
                    required
                  >
                    <option value="">Select a field team</option>
                    {fieldOfficers.map((officer) => (
                      <option key={officer.id} value={officer.id}>
                        {officer.name}
                      </option>
                    ))}
                  </select>
                  {fieldOfficers.length === 0 ? (
                    <span className="field-error">
                      No active field officers. Create one on the <Link to="/users">Users</Link> page.
                    </span>
                  ) : !selectedTeam ? (
                    <span className="muted">Select a field team before you can assign.</span>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="due">Due date (optional)</label>
                  <input id="due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="assign-note">Note (optional)</label>
                  <input id="assign-note" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-block" disabled={busy || !selectedTeam}>
                  {report.assignment ? "Reassign" : "Assign"}
                </button>
              </form>
            </div>
          ) : null}

          {adminNext.includes(ReportStatus.CLOSED) ? (
            <div className="card">
              <h2>Close</h2>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/status`, {
                        method: "PATCH",
                        body: { status: ReportStatus.CLOSED },
                      }),
                    "Report closed.",
                  )
                }
              >
                Close report
              </button>
            </div>
          ) : null}

          {adminNext.includes(ReportStatus.IN_PROGRESS) && report.status === ReportStatus.RESOLVED ? (
            <div className="card">
              <h2>Reopen</h2>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/status`, {
                        method: "PATCH",
                        body: { status: ReportStatus.IN_PROGRESS, note: "Reopened by administrator" },
                      }),
                    "Report reopened.",
                  )
                }
              >
                Reopen as in progress
              </button>
            </div>
          ) : null}

          {adminNext.includes(ReportStatus.IN_PROGRESS) && report.status === ReportStatus.ASSIGNED ? (
            <div className="card">
              <h2>Start work</h2>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/status`, {
                        method: "PATCH",
                        body: { status: ReportStatus.IN_PROGRESS },
                      }).catch((e) => {
                        // Surface field-level messages if any.
                        if (isApiRequestError(e)) throw e;
                        throw e;
                      }),
                    "Marked in progress.",
                  )
                }
              >
                Mark in progress
              </button>
            </div>
          ) : null}

          {adminNext.includes(ReportStatus.RESOLVED) ? (
            <div className="card">
              <h2>Resolve</h2>
              <button
                type="button"
                className="btn btn-block"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      authedRequest<ReportDetailDto>(`/reports/${report.id}/status`, {
                        method: "PATCH",
                        body: { status: ReportStatus.RESOLVED },
                      }),
                    "Report marked resolved.",
                  )
                }
              >
                Mark resolved
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function ReviewWarnings({ review }: { review: ReportReviewDto }) {
  const nearby = review.nearbyOpenReports;
  const showRejected = review.rejectedReportCount >= REJECTED_REPORTS_WARNING_COUNT;
  if (nearby.length === 0 && !showRejected) return null;
  const closest = nearby[0];

  return (
    <div className="banner banner-warning" role="status">
      {nearby.length === 1 && closest ? (
        <p>
          Another open report is already near this spot: <Link to={`/reports/${closest.id}`}>{closest.reference}</Link>
          {closest.distanceMetres === 0 ? " (the same spot)" : `, about ${closest.distanceMetres} m away`}.
        </p>
      ) : null}
      {nearby.length > 1 ? (
        <p>
          {nearby.length} open reports are already near this spot:{" "}
          {nearby.map((other, index) => (
            <span key={other.id}>
              {index > 0 ? ", " : null}
              <Link to={`/reports/${other.id}`}>
                {other.reference} ({other.distanceMetres === 0 ? "same spot" : `${other.distanceMetres} m`})
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
      {showRejected ? <p>This person has had {review.rejectedReportCount} other reports rejected.</p> : null}
    </div>
  );
}
