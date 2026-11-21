import type { NotificationDto } from "@smart-waste/shared";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/report-ui";
import { CenteredLoader, ErrorBanner, LinkButton, PrimaryButton } from "@/components/ui";
import { describeError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { useNotificationsApi } from "@/lib/notifications";
import { usePushRefresh } from "@/lib/push";
import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";

const PAGE_SIZE = 50;

/**
 * Notifications screen body (FR-08), shared by citizens and field officers.
 * Tapping a row marks it read and opens the related report; the caller says
 * which report screen that is for its role.
 */
export function NotificationsList({ hrefForReport }: { hrefForReport: (reportId: string) => Href }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useNotificationsApi();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await api.list({ pageSize: PAGE_SIZE });
      setItems(page.items);
    } catch (err) {
      setError(describeError(err));
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  usePushRefresh(load);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function markAllRead() {
    setClearing(true);
    try {
      await api.markAllRead();
      setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? current);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setClearing(false);
    }
  }

  function open(item: NotificationDto) {
    if (!item.read) {
      setItems((current) => current?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? current);
      api.markRead(item.id).catch(() => undefined);
    }
    if (item.report) router.push(hrefForReport(item.report.id));
  }

  if (items === null && error === null) return <CenteredLoader />;

  const unread = items?.filter((item) => !item.read).length ?? 0;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
      data={items ?? []}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View>
          <ErrorBanner message={error} />
          {error ? <PrimaryButton title="Try again" variant="secondary" onPress={() => void load()} /> : null}
          {unread > 0 ? (
            <View style={styles.toolbar}>
              <Text style={styles.toolbarText}>{unread} unread</Text>
              <LinkButton title={clearing ? "Marking…" : "Mark all as read"} onPress={() => void markAllRead()} />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          <EmptyState
            title="No notifications yet"
            message="You will be told here when the status of a report changes."
          />
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !item.read }}
          onPress={() => open(item)}
          style={({ pressed }) => [styles.row, !item.read && styles.rowUnread, pressed && { opacity: 0.85 }]}
        >
          <View style={[styles.dot, item.read && styles.dotRead]} />
          <View style={styles.rowBody}>
            <Text style={[styles.message, !item.read && styles.messageUnread]}>{item.message}</Text>
            <Text style={styles.when}>
              {formatShortDateTime(item.createdAt)}
              {item.report ? " · Tap to open" : ""}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md, flexGrow: 1 },
    toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
    toolbarText: { color: colors.muted, fontSize: 14 },
    row: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    rowUnread: { borderColor: colors.primary },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
    dotRead: { backgroundColor: colors.border },
    rowBody: { flex: 1 },
    message: { fontSize: 15, color: colors.text, lineHeight: 21 },
    messageUnread: { fontWeight: "600" },
    when: { fontSize: 13, color: colors.muted, marginTop: 4 },
  });
}
