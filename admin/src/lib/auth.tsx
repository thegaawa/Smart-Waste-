import { Role, type AuthResponse, type AuthUser } from "@smart-waste/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { apiRequest, ApiRequestError, isApiRequestError, type RequestOptions } from "./api";

interface Session {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const STORAGE_KEY = "smart-waste-admin.session";

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (parsed.accessToken && parsed.refreshToken && parsed.user?.id) return parsed as Session;
  } catch {
    // ignore corrupt storage
  }
  localStorage.removeItem(STORAGE_KEY);
  return null;
}

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  authedRequest: <T>(path: string, options?: Omit<RequestOptions, "token">) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const refreshing = useRef<Promise<Session | null> | null>(null);

  const applySession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
    setStatus(next ? "signedIn" : "signedOut");
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshTokens = useCallback(async (): Promise<Session | null> => {
    if (refreshing.current) return refreshing.current;
    const current = sessionRef.current;
    if (!current) return null;
    refreshing.current = (async () => {
      try {
        const res = await apiRequest<AuthResponse>("/auth/refresh", {
          method: "POST",
          body: { refreshToken: current.refreshToken },
        });
        const next: Session = { accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user };
        applySession(next);
        return next;
      } catch (error) {
        if (isApiRequestError(error) && error.status === 401) applySession(null);
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [applySession]);

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      applySession(null);
      return;
    }
    sessionRef.current = stored;
    setSession(stored);
    let cancelled = false;
    apiRequest<AuthUser>("/auth/me", { token: stored.accessToken })
      .then((user) => {
        if (cancelled) return;
        if (user.role !== Role.ADMIN) applySession(null);
        else applySession({ ...stored, user });
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        if (isApiRequestError(error) && error.status === 401) {
          const refreshed = await refreshTokens();
          if (refreshed && refreshed.user.role !== Role.ADMIN) applySession(null);
        } else {
          setStatus("signedIn");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applySession, refreshTokens]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const res = await apiRequest<AuthResponse>("/auth/login", { method: "POST", body: { identifier, password } });
      if (res.user.role !== Role.ADMIN) {
        // Do not keep a session for non-admins; revoke the token we were just given.
        apiRequest("/auth/logout", { method: "POST", body: { refreshToken: res.refreshToken } }).catch(() => undefined);
        throw new ApiRequestError(
          403,
          "FORBIDDEN",
          "This dashboard is for administrators only. Citizens and field officers use the mobile app",
        );
      }
      applySession({ accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user });
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    applySession(null);
    if (current) {
      apiRequest("/auth/logout", { method: "POST", body: { refreshToken: current.refreshToken } }).catch(() => undefined);
    }
  }, [applySession]);

  const authedRequest = useCallback(
    async <T,>(path: string, options: Omit<RequestOptions, "token"> = {}): Promise<T> => {
      const current = sessionRef.current;
      if (!current) throw new ApiRequestError(401, "UNAUTHORIZED", "You are signed out");
      try {
        return await apiRequest<T>(path, { ...options, token: current.accessToken });
      } catch (error) {
        if (!(isApiRequestError(error) && error.status === 401)) throw error;
        const refreshed = await refreshTokens();
        if (!refreshed) throw error;
        return apiRequest<T>(path, { ...options, token: refreshed.accessToken });
      }
    },
    [refreshTokens],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, signIn, signOut, authedRequest }),
    [status, session, signIn, signOut, authedRequest],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
