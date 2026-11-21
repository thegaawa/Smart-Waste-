import { NavLink, Outlet } from "react-router";

import { useAuth } from "../lib/auth";
import { ThemeToggle } from "../lib/theme";

/** Sidebar + content area used by every signed-in page (Figure 4.4). */
export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">♻️</span>
          <div>
            <div>Smart-Waste</div>
            <div className="brand-sub">Lagos admin</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/users">Users</NavLink>
          <NavLink to="/categories">Categories</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div>
            <strong>{user?.name}</strong>
          </div>
          <div className="muted">{user?.email ?? user?.phone}</div>
          <ThemeToggle className="theme-toggle-block" />
          <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: "0.75rem" }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
