import {
  ALL_ROLES,
  isLikelyEmail,
  isValidPhone,
  Role,
  ROLE_LABELS,
  UserStatus,
  type AuthUser,
  type CreateUserRequest,
  type Paginated,
} from "@smart-waste/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { describeError, isApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";

const PAGE_SIZE = 20;

/** Account management: list, filter, create staff accounts, enable/disable (Chapter 4.4). */
export function UsersPage() {
  const { user: me, authedRequest } = useAuth();
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AuthUser> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (roleFilter) params.set("role", roleFilter);
      if (query.trim()) params.set("q", query.trim());
      try {
        const result = await authedRequest<Paginated<AuthUser>>(`/admin/users?${params.toString()}`, { signal });
        setData(result);
        setError(null);
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) setError(describeError(e));
      }
    },
    [authedRequest, page, roleFilter, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function toggleStatus(target: AuthUser) {
    const next = target.status === UserStatus.ACTIVE ? UserStatus.DISABLED : UserStatus.ACTIVE;
    const verb = next === UserStatus.DISABLED ? "disable" : "enable";
    if (!window.confirm(`Are you sure you want to ${verb} ${target.name}?`)) return;
    setBusyId(target.id);
    try {
      await authedRequest(`/admin/users/${target.id}`, { method: "PATCH", body: { status: next } });
      setNotice(`${target.name} has been ${verb}d.`);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">Citizens register themselves in the app. Field officers and administrators are created here.</p>
        </div>
        <button type="button" className="btn" onClick={() => setShowCreate(true)}>
          + New staff account
        </button>
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

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name, email or phone"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          aria-label="Search users"
        />
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as Role | "");
            setPage(1);
          }}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {ALL_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {data === null ? (
            <tr>
              <td colSpan={6} className="muted">
                Loading…
              </td>
            </tr>
          ) : data.items.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                No users match.
              </td>
            </tr>
          ) : (
            data.items.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  {u.id === me?.id ? <span className="muted"> (you)</span> : null}
                </td>
                <td>
                  <div>{u.email ?? "—"}</div>
                  <div className="muted">{u.phone ?? ""}</div>
                </td>
                <td>
                  <span className={`pill pill-${u.role.toLowerCase()}`}>{ROLE_LABELS[u.role]}</span>
                </td>
                <td>
                  <span className={`pill ${u.status === UserStatus.DISABLED ? "pill-disabled" : ""}`}>
                    {u.status === UserStatus.ACTIVE ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td style={{ textAlign: "right" }}>
                  {u.id !== me?.id ? (
                    <button
                      type="button"
                      className={`btn ${u.status === UserStatus.ACTIVE ? "btn-danger" : "btn-secondary"}`}
                      disabled={busyId === u.id}
                      onClick={() => void toggleStatus(u)}
                    >
                      {u.status === UserStatus.ACTIVE ? "Disable" : "Enable"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="pager">
        <span>
          {data ? `${data.total} user${data.total === 1 ? "" : "s"}` : ""} · Page {page} of {totalPages}
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

      {showCreate ? (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            setNotice(`${created.name} was created as ${ROLE_LABELS[created.role].toLowerCase()}.`);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

type CreateErrors = Partial<Record<keyof CreateUserRequest | "confirm", string>>;

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (user: AuthUser) => void }) {
  const { authedRequest } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "", role: Role.FIELD as Role });
  const [errors, setErrors] = useState<CreateErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const next: CreateErrors = {};
    if (form.name.trim().length < 2) next.name = "Enter the person's full name";
    const hasEmail = form.email.trim().length > 0;
    const hasPhone = form.phone.trim().length > 0;
    if (!hasEmail && !hasPhone) next.email = "Enter an email address or a phone number";
    if (hasEmail && !isLikelyEmail(form.email)) next.email = "Enter a valid email address";
    if (hasPhone && !isValidPhone(form.phone)) next.phone = "Enter a valid phone number, e.g. 0803 123 4567";
    if (form.password.length < 8) next.password = "Password must be at least 8 characters";
    if (form.confirm !== form.password) next.confirm = "Passwords do not match";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const body: CreateUserRequest = {
        name: form.name.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        password: form.password,
        role: form.role,
      };
      const created = await authedRequest<AuthUser>("/admin/users", { method: "POST", body });
      onCreated(created);
    } catch (e) {
      if (isApiRequestError(e) && e.details.length > 0) {
        setErrors({
          name: e.fieldMessage("name"),
          email: e.fieldMessage("email"),
          phone: e.fieldMessage("phone"),
          password: e.fieldMessage("password"),
          role: e.fieldMessage("role"),
        });
      }
      setFormError(describeError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="create-user-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="create-user-title">New staff account</h2>
        <p className="muted">Share the password with the person securely; they can use it in the mobile app or this dashboard.</p>

        {formError ? (
          <div className="banner banner-error" role="alert">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <Field id="cu-name" label="Full name" error={errors.name}>
            <input id="cu-name" value={form.name} onChange={(e) => update("name", e.target.value)} aria-invalid={!!errors.name} />
          </Field>
          <div className="grid-2">
            <Field id="cu-email" label="Email" error={errors.email}>
              <input id="cu-email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} aria-invalid={!!errors.email} />
            </Field>
            <Field id="cu-phone" label="Phone" error={errors.phone}>
              <input id="cu-phone" placeholder="0803 123 4567" value={form.phone} onChange={(e) => update("phone", e.target.value)} aria-invalid={!!errors.phone} />
            </Field>
          </div>
          <Field id="cu-role" label="Role" error={errors.role}>
            <select id="cu-role" value={form.role} onChange={(e) => update("role", e.target.value as Role)}>
              <option value={Role.FIELD}>{ROLE_LABELS.FIELD}</option>
              <option value={Role.ADMIN}>{ROLE_LABELS.ADMIN}</option>
              <option value={Role.CITIZEN}>{ROLE_LABELS.CITIZEN}</option>
            </select>
          </Field>
          <div className="grid-2">
            <Field id="cu-password" label="Password" error={errors.password}>
              <input id="cu-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => update("password", e.target.value)} aria-invalid={!!errors.password} />
            </Field>
            <Field id="cu-confirm" label="Confirm password" error={errors.confirm}>
              <input id="cu-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => update("confirm", e.target.value)} aria-invalid={!!errors.confirm} />
            </Field>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
