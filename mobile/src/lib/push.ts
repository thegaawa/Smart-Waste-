import { PUSH_ANDROID_CHANNEL_ID, type PushMessageData, type RegisterDeviceRequest } from "@smart-waste/shared";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { colors } from "./theme";

/**
 * Push notifications (Chapter 4.3.5). The phone registers its Firebase Cloud
 * Messaging token with the API; the API sends the same text as the in-app
 * notification, so the phone buzzes even when the app is closed.
 *
 * Everything here is best effort: without Firebase set up (no
 * google-services.json in the build), or when the user refuses the
 * permission, the app simply works with in-app notifications only.
 */

const isNative = Platform.OS === "android" || Platform.OS === "ios";

/** Pushes that arrive while the app is open are shown as a banner as well. */
export function configureNotificationHandling(): void {
  if (!isNative) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Android groups notifications into channels; this one is what the API targets. */
async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL_ID, {
    name: "Report updates",
    description: "Status changes on your waste reports and new tasks",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.primary,
    sound: "default",
  });
}

export type PushAvailability =
  | { kind: "ready"; registration: RegisterDeviceRequest }
  | { kind: "denied" }
  | { kind: "unavailable"; reason: string };

/**
 * Asks for permission (Android 13+ shows a system prompt) and reads the
 * device token. "unavailable" means this build has no Firebase configuration
 * or the phone has no Google services — not an error the user can fix.
 */
export async function getDeviceRegistration(): Promise<PushAvailability> {
  if (!isNative) return { kind: "unavailable", reason: "Push notifications only work on a phone" };
  try {
    await ensureNotificationChannel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return { kind: "denied" };

    const token = await Notifications.getDevicePushTokenAsync();
    const data = typeof token.data === "string" ? token.data : JSON.stringify(token.data);
    if (!data) return { kind: "unavailable", reason: "The phone returned an empty push token" };
    return {
      kind: "ready",
      registration: {
        token: data,
        platform: Platform.OS === "ios" ? "ios" : "android",
        ...(Constants.expoConfig?.version ? { appVersion: Constants.expoConfig.version } : {}),
      },
    };
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Token most recently registered with the API on this phone (used to unregister on sign out). */
let registeredToken: string | null = null;

export function getRegisteredPushToken(): string | null {
  return registeredToken;
}

export function setRegisteredPushToken(token: string | null): void {
  registeredToken = token;
}

/** The `data` we attach on the server, read back from a received or tapped notification. */
export function readPushData(content: Notifications.NotificationContent): PushMessageData {
  const raw = (content.data ?? {}) as Record<string, unknown>;
  // Android delivers the data map as-is; some paths wrap it as a JSON string.
  const source =
    typeof raw["dataString"] === "string" ? (safeParse(raw["dataString"]) ?? raw) : raw;
  return {
    ...(typeof source["reportId"] === "string" ? { reportId: source["reportId"] } : {}),
    ...(typeof source["reference"] === "string" ? { reference: source["reference"] } : {}),
  };
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Something new arrived" signal, so open screens refresh their counts and lists.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function emitPushReceived(): void {
  for (const listener of listeners) listener();
}

/** Runs `onReceived` whenever a push arrives while the app is open. */
export function usePushRefresh(onReceived: () => void): void {
  useEffect(() => {
    listeners.add(onReceived);
    return () => {
      listeners.delete(onReceived);
    };
  }, [onReceived]);
}
