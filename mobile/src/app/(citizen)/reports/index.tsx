import type { MyReportsQuery, ReportSummaryDto } from "@smart-waste/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, useMemo } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, EmptyState, ReportListItem } from "@/components/report-ui";
import { ErrorBanner, PrimaryButton } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useReportsApi } from "@/lib/reports";
import { spacing, useTheme, type ThemeColors } from "@/lib/theme";

type Filter = "all" | "open" | "resolved";
const PAGE_SIZE = 20;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
];

/** Every report the citizen has sent, newest first, with paging (FR-05, Figure 4.5). */
export default function MyReportsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useReportsApi();

  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<ReportSummaryDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (nextFilter: Filter, nextPage: number, append: boolean) => {
      setError(null);
      const query: MyReportsQuery = { page: nextPage, pageSize: PAGE_SIZE };
      if (nextFilter !== "all") query.group = nextFilter;
      try {
        const result = await api.myReports(query);
        setItems((current) => (append && current ? [...current, ...result.items] : result.items));
        setTotal(result.total);
        setPage(result.page);
      } catch (err) {
        setError(describeError(err));
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      void load(filter, 1, false);
    }, [load, filter]),
  );

  async function refresh() {
    setRefreshing(true);
    await load(filter, 1, false);
    setRefreshing(false);
  }

  async function loadMore() {
    if (loadingMore || !items || items.length >= total) return;
    setLoadingMore(true);
    await load(filter, page + 1, true);
    setLoadingMore(false);
  }

  function changeFilter(next: Filter) {
    if (next === filter) return;
    setFilter(next);
    setItems(null);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        {FILTERS.map((option) => (
          <Chip key={option.key} label={option.label} selected={filter === option.key} onPress={() => changeFilter(option.key)} />
        ))}
      </View>

      <FlatList
        data={items ?? []}
        keyExtractor={(report) => report.id}
        renderItem={({ item }) => (
          <ReportListItem report={item} onPress={() => router.push({ pathname: "/reports/[id]", params: { id: item.id } })} />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          error ? (
            <View>
              <ErrorBanner message={error} />
              <PrimaryButton title="Try again" variant="secondary" onPress={() => void load(filter, 1, false)} />
            </View>
          ) : items ? (
            <Text style={styles.count}>
              {total} report{total === 1 ? "" : "s"}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          items === null && !error ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : items && items.length === 0 ? (
            <EmptyState
              title={filter === "all" ? "No reports yet" : `No ${filter} reports`}
              message={
                filter === "all"
                  ? "Reports you send appear here with their reference number and status."
                  : "Change the filter above to see your other reports."
              }
            />
          ) : null
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  filters: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, flexGrow: 1 },
  count: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm },
  loader: { marginVertical: spacing.lg },
});
}

