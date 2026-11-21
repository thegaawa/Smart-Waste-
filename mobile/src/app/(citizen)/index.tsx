import type { ReportCountsDto, ReportSummaryDto } from "@smart-waste/shared";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationBell } from "@/components/NotificationBell";
import { EmptyState, ReportListItem, SectionTitle } from "@/components/report-ui";
import { Card, ErrorBanner, LinkButton, PrimaryButton, Spacer, Subtitle, Title } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useNotificationsApi } from "@/lib/notifications";
import { useOutbox } from "@/lib/outbox";
import { usePushRefresh } from "@/lib/push";
import { useReportsApi } from "@/lib/reports";
import { radius, spacing, ThemeToggle, useTheme, type ThemeColors } from "@/lib/theme";

const RECENT_COUNT = 3;

/** Citizen home (Figure 4.2): live counts, the report button and the latest reports. */
export default function CitizenHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, signOut } = useAuth();
  const api = useReportsApi();
  const notificationsApi = useNotificationsApi();
  const outbox = useOutbox();

  const [counts, setCounts] = useState<ReportCountsDto | null>(null);
  const [recent, setRecent] = useState<ReportSummaryDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextCounts, page, unreadCount] = await Promise.all([
        api.myCounts(),
        api.myReports({ pageSize: RECENT_COUNT }),
        notificationsApi.unreadCount(),
      ]);
      setCounts(nextCounts);
      setRecent(page.items);
      setTotal(page.total);
      setUnread(unreadCount.unread);
    } catch (err) {
      setError(describeError(err));
    }
  }, [api, notificationsApi]);

  // Reload every time this screen comes back into view (after sending a report, for example).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // A status update pushed while this screen is open refreshes the counts and the bell.
  usePushRefresh(load);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const loading = recent === null && error === null;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <NotificationBell unread={unread} onPress={() => router.push("/(citizen)/notifications")} />
          ),
        }}
      />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>Citizen</Text>
          <Title>Hello, {firstName(user?.name)}</Title>
          <Subtitle>Report a waste problem near you and follow it until it is resolved.</Subtitle>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="Open" value={counts ? String(counts.open) : "–"} />
          <StatCard label="Resolved" value={counts ? String(counts.resolved) : "–"} />
        </View>

        <Spacer />
        <PrimaryButton title="Report a waste problem" onPress={() => router.push("/report/new")} />

        {outbox && outbox.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(citizen)/outbox")}
            style={({ pressed }) => [styles.outboxCard, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.outboxText}>
              <Text style={styles.outboxTitle}>
                {outbox.length === 1 ? "1 report not sent yet" : `${outbox.length} reports not sent yet`}
              </Text>
              <Text style={styles.outboxHint}>Saved on this phone. Tap to retry when you have a connection.</Text>
            </View>
            <Text style={styles.outboxChevron}>›</Text>
          </Pressable>
        ) : null}

        <SectionTitle
          right={total > RECENT_COUNT ? <LinkButton title="See all" onPress={() => router.push("/reports")} /> : undefined}
        >
          My reports
        </SectionTitle>

        <ErrorBanner message={error} />
        {error ? <PrimaryButton title="Try again" variant="secondary" onPress={() => void load()} /> : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : recent && recent.length > 0 ? (
          recent.map((report) => (
            <ReportListItem
              key={report.id}
              report={report}
              onPress={() => router.push({ pathname: "/reports/[id]", params: { id: report.id } })}
            />
          ))
        ) : !error ? (
          <Card>
            <EmptyState
              title="No reports yet"
              message="When you send a report it appears here with its reference number and status."
            />
          </Card>
        ) : null}

        <View style={styles.footer}>
          <ThemeToggle />
          <Spacer size={spacing.sm} />
          <PrimaryButton title="Sign out" onPress={() => void signOut()} variant="secondary" />
        </View>
      </ScrollView>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Card style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function firstName(name: string | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "there";
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({

  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, flexGrow: 1 },
  hero: { marginBottom: spacing.xs },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.primaryDark,
    marginBottom: spacing.xs,
  },
  statsRow: { flexDirection: "row", gap: spacing.md },
  stat: { flex: 1, alignItems: "flex-start" },
  statValue: { fontSize: 32, fontWeight: "800", color: colors.primaryDark, letterSpacing: -0.5 },
  statLabel: { fontSize: 14, color: colors.muted, marginTop: spacing.xs, fontWeight: "500" },
  loader: { marginVertical: spacing.lg },
  footer: { marginTop: "auto", paddingTop: spacing.xl },
  outboxCard: {
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "#F5D9A0",
  },
  outboxText: { flex: 1 },
  outboxTitle: { color: colors.warning, fontWeight: "700", fontSize: 15 },
  outboxHint: { color: colors.text, fontSize: 13, marginTop: 2 },
  outboxChevron: { color: colors.warning, fontSize: 24, fontWeight: "700" },
});}
