import { Role } from "@smart-waste/shared";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PushNotificationsManager } from "@/components/PushNotificationsManager";
import { CenteredLoader } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { configureNotificationHandling } from "@/lib/push";
import { ThemeProvider, useTheme } from "@/lib/theme";

// Keep the native splash screen up until we know whether the user is signed in.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Show push notifications as banners even while the app is open.
configureNotificationHandling();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedStatusBar />
            <RootNavigator />
            <PushNotificationsManager />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}

/**
 * One screen group per role. `Stack.Protected` removes the groups the current
 * user may not see, so a citizen can never navigate into field-officer screens
 * and a signed-out user always lands on sign-in.
 */
function RootNavigator() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== "loading") SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  if (status === "loading") return <CenteredLoader />;

  const role = user?.role ?? null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={role === Role.CITIZEN}>
        <Stack.Screen name="(citizen)" />
      </Stack.Protected>
      <Stack.Protected guard={role === Role.FIELD}>
        <Stack.Screen name="(field)" />
      </Stack.Protected>
      <Stack.Protected guard={role === Role.ADMIN}>
        <Stack.Screen name="(admin)" />
      </Stack.Protected>
    </Stack>
  );
}
