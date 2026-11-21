import {
  REPORT_STATUS_LABELS,
  Role,
  type AdminStatsDto,
  type AuthUser,
  type HealthResponse,
  type Paginated,
  type ReportStatus,
} from "@smart-waste/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { apiRequest, describeError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Summary {
  citizens: number;
  fieldOfficers: number;
  admins: number;
}

/** Overview: account totals, report status counts, ageing open reports. */
export function DashboardPage() {
  const { user, authedRequest } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stats, setStats] = useState<AdminStatsDto | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const count = (role: Role) =>
      authedRequest<Paginated<AuthUser>>(`/admin/users?role=${role}&pageSize=1`, { signal: controller.signal }).then(
        (r) => r.total,
      );

    Promise.all([
      count(Role.CITIZEN),
      count(Role.FIELD),
      count(Role.ADMIN),
      authedRequest<AdminStatsDto>("/admin/stats", { signal: controller.signal }),
    ])
      .then(([citizens, fieldOfficers, admins, nextStats]) => {
        setSummary({ citizens, fieldOfficers, admins });
        setStats(nextStats);
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "AbortError")) setError(describeError(e));
      });

    apiRequest<HealthResponse>("/health", { signal: controller.signal })
      .then(setHealth)
      .catch(() => setHealth(null));

    return () => controller.abort();
  }, [authedRequest]);

  const statusOrder: ReportStatus[] = [
    "NEW",
    "VALIDATED",
    "ASSIGNED",
    "IN_PROGRESS",
    "RESOLVED",
    "CLOSED",
    "REJECTED",
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Welcome back, {user?.name}.</p>
        </div>
        <Link to="/reports" className="btn">
          Open report queue
        </Link>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="stats">
        <Stat label="Citizens" value={summary?.citizens} />
        <Stat label="Field officers" value={summary?.fieldOfficers} />
        <Stat label="Administrators" value={summary?.admins} />
        <Stat label="All reports" value={stats?.total} />
        <Stat label="Open &gt; 72h" value={stats?.ageingOpen} warn={!!stats && stats.ageingOpen > 0} />
        <div className="card">
          <div className="stat-value" style={{ color: health?.database === "up" ? undefined : "var(--danger)" }}>
            {health ? (health.database === "up" ? "Up" : "Down") : "…"}
          </div>
          <div className="stat-label">API {health ? `v${health.version}` : ""}</div>
        </div>
      </div>

      <h2 style={{ marginBottom: "0.75rem" }}>Reports by status</h2>
      <div className="stats">
        {statusOrder.map((status) => (
          <Link key={status} to={`/reports?status=${status}`} className="card card-link">
            <div className="stat-value">{stats ? stats.byStatus[status] : "…"}</div>
            <div className="stat-label">{REPORT_STATUS_LABELS[status]}</div>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: number | undefined; warn?: boolean }) {
  return (
    <div className="card">
      <div className="stat-value" style={warn ? { color: "var(--danger)" } : undefined}>
        {value === undefined ? "…" : value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
