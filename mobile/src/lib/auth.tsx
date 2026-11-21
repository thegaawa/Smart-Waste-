import type { AuthResponse, AuthUser, LoginRequest, RegisterRequest } from "@smart-waste/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { apiRequest, isApiRequestError, type RequestOptions } from "./api";
import { getRegisteredPushToken, setRegisteredPushToken } from "./push";
import { clearSession, loadSession, saveSession, type StoredSession } from "./session-storage";
import { uploadForm, type UploadOptions } from "./upload";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (input: LoginRequest) => Promise<AuthUser>;
  register: (input: RegisterRequest) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  /**
   * Call the API as the signed-in user. Refreshes the access token once if it
   * has expired; signs the user out if the refresh token is no longer valid.
   */
  authedRequest: <T>(path: string, options?: Omit<RequestOptions, "token">) => Promise<T>;
  /** Multipart upload (report photos) with progress, using the same token handling. */
  authedUpload: <T>(path: string, form: FormData, options?: Omit<UploadOptions, "token">) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<StoredSession | null>(null);
  // Keep the latest session in a ref so long-running requests use fresh tokens.
  const sessionRef = useRef<StoredSession | null>(null);
  const refreshInFlight = useRef<Promise<StoredSession | null> | null>(null);

  const applySession = useCallback(async (next: StoredSession | null) => {
    sessionRef.current = next;
    setSession(next);
    setStatus(next ? "signedIn" : "signedOut");
    if (next) await saveSession(next);
    else await clearSession();
  }, []);

  const fromAuthResponse = (res: AuthResponse): StoredSession => ({
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    user: res.user,
  });

  /** Exchange the refresh token for new tokens. Returns null (and signs out) if it fails. */
  const refreshTokens = useCallback(async (): Promise<StoredSession | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const current = sessionRef.current;
    if (!current) return null;

    refreshInFlight.current = (async () => {
      try {
        const res = await apiRequest<AuthResponse>("/auth/refresh", {
          method: "POST",
          body: { refreshToken: current.refreshToken },
        });
        const next = fromAuthResponse(res);
        await applySession(next);
        return next;
      } catch (error) {
        // A network problem should not log the user out; only a rejected token does.
        if (isApiRequestError(error) && error.status === 401) {
          await applySession(null);
        }
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    return refreshInFlight.current;
  }, [applySession]);

  // On launch: restore the saved session and make sure it is still valid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (cancelled) return;
      if (!stored) {
        await applySession(null);
        return;
      }
      sessionRef.current = stored;
      setSession(stored);
      try {
        const user = await apiRequest<AuthUser>("/auth/me", { token: stored.accessToken });
        if (!cancelled) await applySession({ ...stored, user });
      } catch (error) {
        if (cancelled) return;
        if (isApiRequestError(error) && error.status === 401) {
          await refreshTokens();
          if (!sessionRef.current) return;
          setStatus("signedIn");
        } else {
          // Offline: trust the saved session so the app still opens.
          setStatus("signedIn");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, refreshTokens]);

  const signIn = useCallback(
    async (input: LoginRequest) => {
      const res = await apiRequest<AuthResponse>("/auth/login", { method: "POST", body: input });
      await applySession(fromAuthResponse(res));
      return res.user;
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterRequest) => {
      const res = await apiRequest<AuthResponse>("/auth/register", { method: "POST", body: input });
      await applySession(fromAuthResponse(res));
      return res.user;
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    const pushToken = getRegisteredPushToken();
    setRegisteredPushToken(null);
    await applySession(null);
    if (current) {
      // Best effort: stop push notifications to this phone, then revoke the refresh token.
      if (pushToken) {
        apiRequest("/devices", { method: "DELETE", token: current.accessToken, body: { token: pushToken } }).catch(
          () => undefined,
        );
      }
      apiRequest("/auth/logout", { method: "POST", body: { refreshToken: current.refreshToken } }).catch(() => undefined);
    }
  }, [applySession]);

  /** Runs a call with the current access token; on 401 refreshes once and runs it again. */
  const withAuth = useCallback(
    async <T,>(run: (accessToken: string) => Promise<T>): Promise<T> => {
      const current = sessionRef.current;
      if (!current) throw new Error("You are signed out");
      try {
        return await run(current.accessToken);
      } catch (error) {
        if (!(isApiRequestError(error) && error.status === 401)) throw error;
        const refreshed = await refreshTokens();
        if (!refreshed) throw error;
        return run(refreshed.accessToken);
      }
    },
    [refreshTokens],
  );

  const authedRequest = useCallback(
    <T,>(path: string, options: Omit<RequestOptions, "token"> = {}): Promise<T> =>
      withAuth((token) => apiRequest<T>(path, { ...options, token })),
    [withAuth],
  );

  const authedUpload = useCallback(
    <T,>(path: string, form: FormData, options: Omit<UploadOptions, "token"> = {}): Promise<T> =>
      withAuth((token) => uploadForm<T>(path, form, { ...options, token })),
    [withAuth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, signIn, register, signOut, authedRequest, authedUpload }),
    [status, session, signIn, register, signOut, authedRequest, authedUpload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
