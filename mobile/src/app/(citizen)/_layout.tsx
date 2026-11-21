import { Stack } from "expo-router";

import { ReportDraftProvider } from "@/lib/report-draft";
import { useTheme } from "@/lib/theme";

export default function CitizenLayout() {
  const { colors } = useTheme();
  return (
    <ReportDraftProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "800", color: colors.text },
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Smart-Waste" }} />
        <Stack.Screen name="report/new" options={{ title: "New report" }} />
        <Stack.Screen name="report/location" options={{ title: "Confirm location" }} />
        <Stack.Screen name="reports/index" options={{ title: "My reports" }} />
        <Stack.Screen name="reports/[id]" options={{ title: "Report" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="outbox" options={{ title: "Not sent yet" }} />
      </Stack>
    </ReportDraftProvider>
  );
}
