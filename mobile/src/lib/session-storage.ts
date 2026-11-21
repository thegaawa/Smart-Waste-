import type { AuthUser } from "@smart-waste/shared";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** What the app keeps between launches so the user stays signed in. */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const KEY = "smart-waste.session";

// SecureStore uses the Android Keystore / iOS Keychain. It does not exist on
// the web, where we fall back to localStorage for development previews only.
const webStorage = {
  get: (): string | null => (typeof localStorage === "undefined" ? null : localStorage.getItem(KEY)),
  set: (value: string): void => {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, value);
  },
  remove: (): void => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  },
};

export async function loadSession(): Promise<StoredSession | null> {
  const raw = Platform.OS === "web" ? webStorage.get() : await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string" &&
      parsed.user &&
      typeof parsed.user.id === "string"
    ) {
      return parsed as StoredSession;
    }
  } catch {
    // Corrupt value; treat as signed out.
  }
  await clearSession();
  return null;
}

export async function saveSession(session: StoredSession): Promise<void> {
  const raw = JSON.stringify(session);
  if (Platform.OS === "web") {
    webStorage.set(raw);
    return;
  }
  await SecureStore.setItemAsync(KEY, raw);
}

export async function clearSession(): Promise<void> {
  if (Platform.OS === "web") {
    webStorage.remove();
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
