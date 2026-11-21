import {
  ALL_PRIORITIES,
  PRIORITY_LABELS,
  type CategoryDto,
  type Priority,
  type UpsertCategoryRequest,
} from "@smart-waste/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { describeError, isApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PriorityPill } from "../lib/report-display";

/** Category list and create / edit (Chapter 4.4). */
export function CategoriesPage() {
  const { authedRequest } = useAuth();
  const [items, setItems] = useState<CategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await authedRequest<CategoryDto[]>("/admin/categories"));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [authedRequest]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(category: CategoryDto) {
    setBusyId(category.id);
    try {
      await authedRequest(`/admin/categories/${category.id}`, {
        method: "PATCH",
        body: { active: !category.active },
      });
      setNotice(`${category.name} is now ${category.active ? "inactive" : "active"}.`);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Categories</h1>
          <p className="muted">These appear in the citizen report form. Inactive categories are hidden from new reports.</p>
        </div>
        <button type="button" className="btn" onClick={() => setShowCreate(true)}>
          + New category
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

      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Default priority</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items === null ? (
            <tr>
              <td colSpan={4} className="muted">
                Loading…
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No categories yet.
              </td>
            </tr>
          ) : (
            items.map((category) => (
              <tr key={category.id}>
                <td>
                  <strong>{category.name}</strong>
                  {category.description ? <div className="muted">{category.description}</div> : null}
                </td>
                <td>
                  <PriorityPill priority={category.defaultPriority} />
                </td>
                <td>
                  <span className={`pill ${category.active ? "" : "pill-disabled"}`}>
                    {category.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(category)}>
                    Edit
                  </button>{" "}
                  <button
                    type="button"
                    className={`btn ${category.active ? "btn-danger" : "btn-secondary"}`}
                    disabled={busyId === category.id}
                    onClick={() => void toggleActive(category)}
                  >
                    {category.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {showCreate ? (
        <CategoryDialog
          title="New category"
          onClose={() => setShowCreate(false)}
          onSave={async (body) => {
            const created = await authedRequest<CategoryDto>("/admin/categories", { method: "POST", body });
            setShowCreate(false);
            setNotice(`${created.name} was created.`);
            await load();
          }}
        />
      ) : null}

      {editing ? (
        <CategoryDialog
          title="Edit category"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await authedRequest(`/admin/categories/${editing.id}`, { method: "PATCH", body });
            setEditing(null);
            setNotice(`${body.name ?? editing.name} was updated.`);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function CategoryDialog({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial?: CategoryDto;
  onClose: () => void;
  onSave: (body: UpsertCategoryRequest) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [defaultPriority, setDefaultPriority] = useState<Priority>(initial?.defaultPriority ?? "MEDIUM");
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);
    if (name.trim().length < 2) {
      setFieldError("Enter a category name");
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        defaultPriority,
        active,
      });
    } catch (e) {
      if (isApiRequestError(e) && e.fieldMessage("name")) setFieldError(e.fieldMessage("name"));
      setError(describeError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="cat-name">Name</label>
            <input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldError} />
            {fieldError ? <span className="field-error">{fieldError}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="cat-desc">Description (optional)</label>
            <input id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cat-priority">Default priority</label>
            <select id="cat-priority" value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value as Priority)}>
              {ALL_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active in the report form
          </label>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
