import { classifyIdentifier } from "@smart-waste/shared";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";

import { describeError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ThemeToggle } from "../lib/theme";

export function LoginPage() {
  const { status, signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "signedIn") return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: { identifier?: string; password?: string } = {};
    if (!identifier.trim()) errors.identifier = "Enter your email or phone number";
    else if (!classifyIdentifier(identifier)) errors.identifier = "Enter a valid email address or phone number";
    if (!password) errors.password = "Enter your password";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await signIn(identifier.trim(), password);
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="card login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">♻️</span>
          <div>
            <h1>Smart-Waste</h1>
            <p className="muted">Administrator dashboard</p>
          </div>
        </div>

        {formError ? (
          <div className="banner banner-error" role="alert">
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="identifier">Email or phone</label>
            <input
              id="identifier"
              name="identifier"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              aria-invalid={fieldErrors.identifier ? "true" : undefined}
            />
            {fieldErrors.identifier ? <span className="field-error">{fieldErrors.identifier}</span> : null}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldErrors.password ? "true" : undefined}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {fieldErrors.password ? <span className="field-error">{fieldErrors.password}</span> : null}
          </div>

          <button type="submit" className="btn btn-block" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
