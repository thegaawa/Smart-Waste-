import { Role } from "@smart-waste/shared";
import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useAuth } from "@/lib/auth";
import {
  emitPushReceived,
  getDeviceRegistration,
  getRegisteredPushToken,
  readPushData,
  setRegisteredPushToken,
} from "@/lib/push";

const isNative = Platform.OS === "android" || Platform.OS === "ios";

/** Which report screen a notification opens depends on who is signed in. */
function reportHref(role: Role, reportId: string): Href | null {
  if (role === Role.CITIZEN) return { pathname: "/(citizen)/reports/[id]", params: { id: reportId } };
  if (role === Role.FIELD) return { pathname: "/(field)/reports/[id]", params: { id: reportId } };
  return null;
}

/**
 * Invisible component, mounted once the user is signed in:
 *  1. registers this phone's push token with the API (and again if it changes),
 *  2. tells open screens to refresh when a push arrives while the app is open,
 *  3. opens the related report when the user taps a notification — also when
 *     the tap is what launched the app.
 */
export function PushNotificationsManager() {
  const { status, user, authedRequest } = useAuth();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const userId = user?.id ?? null;
  const role = user?.role ?? null;

  // 1. Register the device for the signed-in user.
  useEffect(() => {
    if (!isNative || status !== "signedIn" || !userId) return;
    let cancelled = false;

    async function register(token?: string) {
      const availability = token
        ? ({ kind: "ready", registration: { token, platform: Platform.OS === "ios" ? "ios" : "android" } } as const)
        : await getDeviceRegistration();
      if (cancelled) return;
      if (availability.kind !== "ready") {
        if (availability.kind === "unavailable") console.warn(`Push notifications unavailable: ${availability.reason}`);
        return;
      }
      try {
        await authedRequest("/devices", { method: "PUT", body: availability.registration });
        if (!cancelled) setRegisteredPushToken(availability.registration.token);
      } catch (error) {
        // Not fatal: the app keeps working with in-app notifications; we try again next launch.
        console.warn("Could not register this phone for push notifications", error);
      }
    }

    void register();
    const subscription = Notifications.addPushTokenListener((token) => {
      const data = typeof token.data === "string" ? token.data : JSON.stringify(token.data);
      if (data && data !== getRegisteredPushToken()) void register(data);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [status, userId, authedRequest]);

  // 2. A push while the app is open: refresh badges and lists.
  useEffect(() => {
    if (!isNative) return;
    const subscription = Notifications.addNotificationReceivedListener(() => emitPushReceived());
    return () => subscription.remove();
  }, []);

  // 3. Tapping a notification opens its report (covers cold start too).
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
  const navigationReady = Boolean(navigationState?.key);

  useEffect(() => {
    if (!lastResponse || status !== "signedIn" || !role || !navigationReady) return;
    const key = `${lastResponse.notification.request.identifier}:${lastResponse.notification.date}`;
    if (handledResponse.current === key) return;
    handledResponse.current = key;

    const data = readPushData(lastResponse.notification.request.content);
    const href = data.reportId ? reportHref(role, data.reportId) : null;
    if (href) router.push(href);
    emitPushReceived();
  }, [lastResponse, status, role, navigationReady, router]);

  return null;
}
