import { AssignmentStatus, type TaskCountsDto, type TaskDto } from "@smart-waste/shared";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationBell } from "@/components/NotificationBell";
import { Chip, EmptyState, PriorityChip, SectionTitle, StatusChip } from "@/components/report-ui";
import { Card, ErrorBanner, PrimaryButton, Subtitle, Title } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCoordinates, formatShortDateTime } from "@/lib/format";
import { useNotificationsApi } from "@/lib/notifications";
import { usePushRefresh } from "@/lib/push";
import { useTasksApi } from "@/lib/tasks";
import { radius, spacing, ThemeToggle, useTheme, type ThemeColors } from "@/lib/theme";

type Group = "active" | "completed";

/** Field officer home (Figure 4.6): assigned tasks, most urgent first (FR-07). */
export default function FieldHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, signOut } = useAuth();
  const tasksApi = useTasksApi();
  const notificationsApi = useNotificationsApi();

  const [group, setGroup] = useState<Group>("active");
  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const [counts, setCounts] = useState<TaskCountsDto | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [page, nextCounts, unreadCount] = await Promise.all([
        tasksApi.myTasks({ group, pageSize: 50 }),
        tasksApi.myCounts(),
        notificationsApi.unreadCount(),
      ]);
      setTasks(page.items);
      setCounts(nextCounts);
      setUnread(unreadCount.unread);
    } catch (err) {
      setError(describeError(err));
    }
  }, [group, notificationsApi, tasksApi]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // A new task or update pushed while this screen is open shows up without a manual refresh.
  usePushRefresh(load);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function changeGroup(next: Group) {
    if (next === group) return;
    setTasks(null);
    setGroup(next);
  }

  const loading = tasks === null && error === null;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => <NotificationBell unread={unread} onPress={() => router.push("/(field)/notifications")} />,
        }}
      />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>Field officer</Text>
          <Title>Hello, {firstName(user?.name)}</Title>
          <Subtitle>Tasks assigned to you, most urgent first. Tap a task to see the location and update it.</Subtitle>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="Active" value={counts ? String(counts.active) : "–"} />
          <StatCard label="Completed" value={counts ? String(counts.completed) : "–"} />
        </View>

        <SectionTitle>{group === "active" ? "Active tasks" : "Completed tasks"}</SectionTitle>
        <View style={styles.filters}>
          <Chip label="Active" selected={group === "active"} onPress={() => changeGroup("active")} />
          <Chip label="Completed" selected={group === "completed"} onPress={() => changeGroup("completed")} />
        </View>

        <ErrorBanner message={error} />
        {error ? <PrimaryButton title="Try again" variant="secondary" onPress={() => void load()} /> : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : tasks && tasks.length > 0 ? (
          tasks.map((task) => (
            <TaskListItem
              key={task.assignmentId}
              task={task}
              onPress={() => router.push({ pathname: "/(field)/reports/[id]", params: { id: task.report.id } })}
            />
          ))
        ) : !error ? (
          <Card>
            <EmptyState
              title={group === "active" ? "No active tasks" : "No completed tasks yet"}
              message={
                group === "active"
                  ? "When an administrator assigns a report to you it appears here."
                  : "Tasks you mark as resolved move here."
              }
            />
          </Card>
        ) : null}

        <View style={styles.footer}>
          <ThemeToggle />
          <View style={{ height: spacing.sm }} />
          <PrimaryButton title="Sign out" onPress={() => void signOut()} variant="secondary" />
        </View>
      </ScrollView>
    </>
  );
}

const ASSIGNMENT_LABELS: Record<AssignmentStatus, string> = {
  PENDING: "New task",
  ACKNOWLEDGED: "Acknowledged",
  COMPLETED: "Completed",
  REASSIGNED: "Reassigned",
};

function TaskListItem({ task, onPress }: { task: TaskDto; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { report } = task;
  const where = report.address ?? formatCoordinates(report.latitude, report.longitude);
  const overdue =
    task.dueAt !== null && task.assignmentStatus !== AssignmentStatus.COMPLETED && new Date(task.dueAt).getTime() < Date.now();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.primarySoft }]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowReference}>{report.reference}</Text>
        <StatusChip status={report.status} />
      </View>
      <Text style={styles.rowCategory}>{report.category.name}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {where}
      </Text>
      <View style={styles.rowChips}>
        <PriorityChip priority={report.priority} />
        <View style={[styles.assignmentChip, task.assignmentStatus === AssignmentStatus.PENDING && styles.assignmentChipNew]}>
          <Text style={[styles.assignmentChipText, task.assignmentStatus === AssignmentStatus.PENDING && styles.assignmentChipTextNew]}>
            {ASSIGNMENT_LABELS[task.assignmentStatus]}
          </Text>
        </View>
      </View>
      <Text style={styles.rowMeta}>
        Assigned {formatShortDateTime(task.assignedAt)}
        {task.dueAt ? ` · Due ${formatShortDateTime(task.dueAt)}` : ""}
      </Text>
      {overdue ? <Text style={styles.overdue}>Past due date</Text> : null}
    </Pressable>
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
  filters: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  loader: { marginVertical: spacing.lg },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 2,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  rowReference: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  rowCategory: { fontSize: 15, color: colors.text, fontWeight: "500" },
  rowMeta: { fontSize: 13, color: colors.muted },
  rowChips: { flexDirection: "row", gap: spacing.sm, marginVertical: 4 },
  assignmentChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#E5E7EB" },
  assignmentChipNew: { backgroundColor: colors.infoSoft },
  assignmentChipText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  assignmentChipTextNew: { color: colors.info },
  overdue: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  footer: { marginTop: "auto", paddingTop: spacing.xl },
});}
